import { createHash } from 'crypto'
import { SharedInstances } from './SharedInstances'

// A list of voices or models changes rarely: a day keeps every call fast, and
// `refresh` is there for one added a moment ago
const LIST_TTL = 24 * 60 * 60 * 1000 // ms

const lists = new SharedInstances<unknown[]>({ ttl: LIST_TTL })

/**
 * Fetches a list from a provider once per key and account, then shares it with
 * every caller of the process for a day. Calls asking at the same time share
 * one request, and a failed one is not kept.
 *
 * @param key - What the list is, the provider first, then what changes it
 * @param apiKey - The account, kept only as a hash
 * @param load - Fetches the list
 * @param refresh - Fetches it again, for an item added a moment ago
 */
export function cachedList<T>(
  key: unknown[],
  apiKey: string,
  load: () => Promise<T[]>,
  refresh = false
): Promise<T[]> {
  const account = createHash('sha256').update(apiKey).digest('hex')
  const id = [...key, account]
  if (refresh) lists.delete(id)
  return lists.load(id, load) as Promise<T[]>
}
