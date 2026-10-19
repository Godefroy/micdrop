import { setSileroModelLoader } from '@micdrop/client'
import { OnnxSileroModel, OnnxSileroOptions } from './vad/OnnxSileroModel'

export * from './vad/OnnxSileroModel'
export * from './vad/onnxQueue'

let options: OnnxSileroOptions = {}

/**
 * Says where the Silero model comes from, to serve it from your own domain
 * rather than from a CDN, or to hand over its bytes directly. Merged into the
 * options already set, so it keeps what the `@micdrop/web/vite` plugin chose.
 * @param next - Address or bytes of the model, and of the ONNX runtime
 */
export function setSileroOptions(next: OnnxSileroOptions) {
  options = { ...options, ...next }
}

// The ONNX runtime weighs more than the rest of Micdrop put together, so it
// only enters the bundle of an app that imports this file
setSileroModelLoader(async () => {
  const model = new OnnxSileroModel(options)
  await model.load()
  return model
})
