import {
  Micdrop,
  MicdropClientError,
  MicdropClientErrorCode,
  MicdropState,
} from '@micdrop/web'
import type { Call } from './display/Display'
import { CALL_QUERY } from './mode'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8095/call'

/** Opens the microphone, then the call */
export async function startCall() {
  await Micdrop.startMic({ vad: ['silero', 'volume'] })
  await Micdrop.start({ url: SERVER_URL + CALL_QUERY })
}

/** What the display needs to know about the call */
export function callOf(state: MicdropState): Call {
  return {
    started: state.isStarted,
    starting: state.isStarting,
    listening: state.isUserSpeaking,
    error: state.error
      ? errorText(state.error) + (state.isReconnecting ? ' Reconnecting…' : '')
      : undefined,
  }
}

/** The client errors carry a code, and rarely a message */
function errorText(error: MicdropClientError): string {
  switch (error.code) {
    case MicdropClientErrorCode.Mic:
      return 'The microphone is unavailable. Allow it in the browser and try again.'
    case MicdropClientErrorCode.Connection:
      return `The server at ${SERVER_URL} cannot be reached. Is it running?`
    case MicdropClientErrorCode.InternalServer:
      return 'The server failed to start. Check its logs and the API keys in .env.'
    default:
      return error.message || `Something went wrong (${error.code}).`
  }
}
