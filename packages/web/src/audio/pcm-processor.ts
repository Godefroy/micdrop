import pcmProcessorWorklet from './pcm-processor-worklet?raw'
import { audioContext } from './audioContext'

declare global {
  interface Window {
    micdropPcmProcessor?: Promise<void>
  }
}

/**
 * Loads the worklet into the audio context, once per page. A second caller
 * waits for the same load rather than building a node before it exists, and a
 * failed load is forgotten so the next microphone tries again.
 */
export function initPcmProcessor(): Promise<void> {
  if (!window.micdropPcmProcessor) {
    const workletBlob = new Blob([pcmProcessorWorklet], {
      type: 'application/javascript',
    })
    const workletUrl = URL.createObjectURL(workletBlob)
    const loading = audioContext.audioWorklet.addModule(workletUrl)
    window.micdropPcmProcessor = loading
    loading.catch(() => {
      if (window.micdropPcmProcessor === loading) {
        window.micdropPcmProcessor = undefined
      }
    })
  }
  return window.micdropPcmProcessor
}
