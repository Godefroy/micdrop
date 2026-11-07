import { AudioManager } from 'react-native-audio-api'

// The route the speaker chose last, which the microphone keeps when it
// configures the session as it starts
let earpiece = false

/**
 * Configures the audio session for a phone call: the operating system then
 * applies echo cancellation, which keeps the assistant voice out of what is
 * recorded.
 * @param route - Plays against the ear rather than loud, when given
 */
export function configureCallSession(route?: { earpiece: boolean }) {
  if (route) earpiece = route.earpiece
  AudioManager.setAudioSessionOptions({
    iosCategory: 'playAndRecord',
    iosMode: 'voiceChat',
    iosOptions: earpiece
      ? ['allowBluetoothHFP']
      : ['defaultToSpeaker', 'allowBluetoothHFP', 'allowBluetoothA2DP'],
  })
}
