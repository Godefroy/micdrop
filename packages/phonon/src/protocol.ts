import type { ModelFiles } from './modelFiles'

/** Language the text is normalized as, numbers and symbols included. */
export type PhononLanguage = 'en' | 'fr' | 'de' | 'es' | 'pt' | 'none'

/** Weight precision the module runs the flow transformer at. */
export type PhononQuant = 'q8' | 'f32'

export interface WorkerData {
  wasmDir: string
  files: ModelFiles
  quant: PhononQuant
  language: PhononLanguage
  rewrites?: string
}

export type WorkerRequest =
  | {
      type: 'generate'
      id: number
      voicePath: string
      text: string
      temperature: number
      seed: number
    }
  | { type: 'cancel'; id: number }

export type WorkerReply =
  | { type: 'ready'; sampleRate: number }
  | { type: 'loadFailed'; message: string }
  | { type: 'audio'; id: number; samples: Float32Array }
  | { type: 'done'; id: number }
  | { type: 'failed'; id: number; message: string }
