import {
  downloadFileToCacheDir,
  getHFHubCachePath,
  getRepoFolderName,
} from '@huggingface/hub'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, relative } from 'path'
import {
  CONFIG,
  DEFAULT_VOICE_FILE,
  TOKENIZER,
  VOICE_DIRS,
  VOICE_EXTENSION,
  WEIGHTS,
} from './modelFiles'
import type { PhononQuant } from './protocol'

/**
 * Phonon models and voices downloaded from the Hugging Face Hub.
 *
 * Files land in the cache the Hugging Face libraries share
 * (`~/.cache/huggingface/hub`, or `HF_HUB_CACHE`), so a model downloaded
 * by Python is not downloaded again. A model is looked up once per load to
 * learn the commit its revision points at, and loads from the cache when the
 * Hub cannot be reached.
 */

export interface HubOptions {
  /** Hugging Face token, needed by the gated 40M models. */
  accessToken?: string
  /** Hugging Face cache folder. */
  cacheDir?: string
}

/**
 * The Hugging Face token: `HF_TOKEN`, else the one `hf auth login` saved, as
 * the Python libraries look it up.
 */
export function getHubToken(): string | undefined {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN
  const home = process.env.HF_HOME ?? join(homedir(), '.cache', 'huggingface')
  try {
    return readFileSync(join(home, 'token'), 'utf-8').trim() || undefined
  } catch {
    return undefined
  }
}

const HUB = 'https://huggingface.co'
const COMMIT_HASH = /^[0-9a-f]{40}$/

/** The voice catalog, pinned so a voice name always means the same voice. */
export const VOICES_REPO = 'gradium/phonon-voices'
const VOICES_REVISION = '0ee17205f254b5abc43b266c8a0f215565c352f7'

interface Revision {
  sha: string
  files: string[]
  gated: boolean
}

/** The repo and revision of `hf://owner/name[@revision]`, nothing for a path. */
export function parseHubModel(
  source: string
): { repo: string; revision: string } | undefined {
  if (!source.startsWith('hf://')) return
  const match = /^hf:\/\/([\w.-]+\/[\w.-]+)(?:@(\S+))?$/.exec(source)
  if (!match) {
    throw new Error(
      `Phonon model must be "hf://owner/name" or "hf://owner/name@revision", ` +
        `got "${source}"`
    )
  }
  return { repo: match[1], revision: match[2] ?? 'main' }
}

/**
 * Downloads the files of a model the given precision needs, and returns the
 * folder of the cache holding them.
 */
export async function downloadHubModel(
  source: string,
  quant: PhononQuant,
  options: HubOptions
): Promise<string> {
  const { repo, revision } = parseHubModel(source)!
  const cacheDir = options.cacheDir ?? getHFHubCachePath()
  const storage = join(
    cacheDir,
    getRepoFolderName({ name: repo, type: 'model' })
  )
  const { sha, files, gated } = await lookUpRevision(
    repo,
    revision,
    storage,
    options.accessToken
  )

  const weights = WEIGHTS[quant].find((name) => files.includes(name))
  const voices = files.filter(
    (file) =>
      file === DEFAULT_VOICE_FILE ||
      (VOICE_DIRS.some((dir) => file.startsWith(`${dir}/`)) &&
        file.endsWith(VOICE_EXTENSION))
  )
  const wanted = [CONFIG, TOKENIZER, ...(weights ? [weights] : []), ...voices]

  try {
    for (const path of wanted.filter((path) => files.includes(path))) {
      await downloadFileToCacheDir({
        repo,
        path,
        revision: sha,
        cacheDir,
        accessToken: options.accessToken,
      })
    }
  } catch (error) {
    if (!gated) throw error
    throw new Error(
      `Phonon model ${repo} is gated: accept its terms on ${HUB}/${repo}, ` +
        'then set HF_TOKEN or the hfToken option to a token of that account ' +
        `(${error instanceof Error ? error.message : error})`
    )
  }

  return join(storage, 'snapshots', sha)
}

/** Downloads a voice of the catalog and returns its path in the cache. */
export function downloadCatalogVoice(
  id: string,
  options: HubOptions
): Promise<string> {
  return downloadFileToCacheDir({
    repo: VOICES_REPO,
    path: `voices/${id}${VOICE_EXTENSION}`,
    revision: VOICES_REVISION,
    cacheDir: options.cacheDir,
    accessToken: options.accessToken,
  })
}

/**
 * The commit a revision points at and the files of the repo there, from the
 * Hub or, when it cannot be reached, from what the cache kept of it.
 */
async function lookUpRevision(
  repo: string,
  revision: string,
  storage: string,
  accessToken?: string
): Promise<Revision> {
  let response: Response | undefined
  try {
    response = await fetch(
      `${HUB}/api/models/${repo}/revision/${encodeURIComponent(revision)}`,
      {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      }
    )
  } catch {
    // Offline, the cache answers below
  }

  if (response?.ok) {
    const info = (await response.json()) as {
      sha: string
      siblings?: { rfilename: string }[]
      gated?: string | boolean
    }
    const { sha } = info
    // Lets a branch be found again offline, as the Python libraries do
    if (!COMMIT_HASH.test(revision)) {
      const ref = join(storage, 'refs', revision)
      await mkdir(dirname(ref), { recursive: true })
      await writeFile(ref, sha)
    }
    return {
      sha,
      files: (info.siblings ?? []).map((sibling) => sibling.rfilename),
      gated: Boolean(info.gated),
    }
  }

  if (response && (response.status === 401 || response.status === 404)) {
    throw new Error(
      `Phonon model ${repo}@${revision} not found on Hugging Face, ` +
        'or private to an account HF_TOKEN does not belong to'
    )
  }

  const cached = await lookUpCachedRevision(storage, revision)
  if (cached) return cached
  throw new Error(
    `Cannot reach Hugging Face to download Phonon model ${repo}` +
      (response ? `: HTTP ${response.status}` : '')
  )
}

async function lookUpCachedRevision(
  storage: string,
  revision: string
): Promise<Revision | undefined> {
  const sha = COMMIT_HASH.test(revision)
    ? revision
    : await readFile(join(storage, 'refs', revision), 'utf-8').catch(
        () => undefined
      )
  if (!sha) return
  const snapshot = join(storage, 'snapshots', sha.trim())
  if (!existsSync(snapshot)) return
  return {
    sha: sha.trim(),
    files: listFiles(snapshot).map((file) => relative(snapshot, file)),
    gated: false,
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}
