// A whole voice call in one screen.
// Micdrop takes care of the microphone permission, the voice activity
// detection, the audio session and the WebSocket, so this file only reads a
// state and draws it.
// https://micdrop.dev/docs/react-native

import {
  useMicdropEndCall,
  useMicdropError,
  useMicdropState,
  useMicVolume,
  useSpeakerVolume,
} from '@micdrop/react'
import {
  EARPIECE_DEVICE,
  Micdrop,
  MicdropState,
  SPEAKER_DEVICE,
} from '@micdrop/react-native'
import '@micdrop/react-native/silero'
import { SmartTurn } from '@micdrop/smart-turn'
import '@micdrop/smart-turn/react-native'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { CallButton } from './src/components/CallButton'
import { Conversation } from './src/components/Conversation'
import { ControlButton } from './src/components/ControlButton'
import { StatusPill } from './src/components/StatusPill'
import { VolumeBar } from './src/components/VolumeBar'
import { getServerUrl } from './src/config'
import { colors } from './src/theme'

/**
 * Hears whether a sentence has landed, so a pause in the middle of a thought
 * keeps the floor. It holds no native code of its own: the model runs on the
 * ONNX runtime that the import above brings in.
 * https://micdrop.dev/docs/client/turn-detection
 */
const smartTurn = new SmartTurn()

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Call />
    </SafeAreaProvider>
  )
}

function Call() {
  const insets = useSafeAreaInsets()
  const state = useMicdropState()
  const { micVolume } = useMicVolume()
  const { speakerVolume } = useSpeakerVolume()
  const [error, setError] = useState<string>()
  const [turnDetection, setTurnDetection] = useState(false)

  // Everything about the call lives in this one state
  // https://micdrop.dev/docs/client/call-state
  const status = getStatus(state)
  const onEarpiece = state.speakerDeviceId === EARPIECE_DEVICE

  const handleCall = useCallback(async () => {
    setError(undefined)
    try {
      if (state.isStarted || state.isStarting) {
        await Micdrop.stop()
      } else {
        // Asks for the microphone, opens the WebSocket and starts listening
        // https://micdrop.dev/docs/client/start-stop-call
        await Micdrop.start({ url: getServerUrl() })
      }
    } catch {
      // Already reported by useMicdropError below
    }
  }, [state.isStarted, state.isStarting])

  const handleMute = useCallback(() => {
    if (state.isMuted) Micdrop.unmute()
    else Micdrop.mute()
  }, [state.isMuted])

  const handlePause = useCallback(() => {
    if (state.isPaused) Micdrop.resume()
    else Micdrop.pause()
  }, [state.isPaused])

  const handleTurnDetection = useCallback(async () => {
    const next = !turnDetection
    setTurnDetection(next)
    setError(undefined)
    Micdrop.setTurnDetector(next ? smartTurn : undefined)
    if (!next) return
    try {
      // A few megabytes, fetched once and kept for as long as the app runs
      await smartTurn.load()
    } catch (loadError) {
      setTurnDetection(false)
      Micdrop.setTurnDetector(undefined)
      setError(
        loadError instanceof Error ? loadError.message : String(loadError)
      )
    }
  }, [turnDetection])

  const handleOutput = useCallback(() => {
    Micdrop.changeSpeakerDevice(onEarpiece ? SPEAKER_DEVICE : EARPIECE_DEVICE)
  }, [onEarpiece])

  // The assistant can hang up on its own when the conversation is over
  // https://micdrop.dev/docs/server/auto-end-call
  useMicdropEndCall(useCallback(() => Micdrop.stopAfterAnswer(), []))

  // Microphone refused, server unreachable, and so on
  // https://micdrop.dev/docs/client/error-handling
  useMicdropError(
    useCallback((micdropError) => {
      setError(micdropError.message || micdropError.code)
    }, [])
  )

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Micdrop</Text>
        <StatusPill label={status.label} color={status.color} />
      </View>

      <Conversation
        conversation={state.conversation}
        partialAssistantMessage={state.partialAssistantMessage}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.meters}>
        <VolumeBar label="You" volume={micVolume} color={colors.success} />
        <VolumeBar
          label="Assistant"
          volume={speakerVolume}
          color={colors.accent}
        />
      </View>

      <View style={styles.controls}>
        <ControlButton
          label={state.isMuted ? 'Unmute' : 'Mute'}
          icon={state.isMuted ? '🔇' : '🎙️'}
          active={state.isMuted}
          disabled={!state.isStarted}
          onPress={handleMute}
        />
        <ControlButton
          label={state.isPaused ? 'Resume' : 'Pause'}
          icon={state.isPaused ? '▶️' : '⏸️'}
          active={state.isPaused}
          disabled={!state.isStarted}
          onPress={handlePause}
        />
        <ControlButton
          label={onEarpiece ? 'Earpiece' : 'Speaker'}
          icon={onEarpiece ? '📱' : '🔊'}
          active={onEarpiece}
          onPress={handleOutput}
        />
        <ControlButton
          label="Smart turn"
          icon={turnDetection ? '🧠' : '💤'}
          active={turnDetection}
          onPress={handleTurnDetection}
        />
      </View>

      <CallButton
        isStarted={state.isStarted}
        isStarting={state.isStarting}
        onPress={handleCall}
      />
    </View>
  )
}

function getStatus(state: MicdropState): { label: string; color: string } {
  if (state.isReconnecting)
    return { label: 'Reconnecting', color: colors.danger }
  if (state.isStarting) return { label: 'Starting', color: colors.textMuted }
  if (!state.isStarted) return { label: 'Ready', color: colors.textMuted }
  if (state.isPaused) return { label: 'Paused', color: colors.textMuted }
  if (state.isUserSpeaking) return { label: 'Listening', color: colors.success }
  if (state.isAssistantSpeaking)
    return { label: 'Speaking', color: colors.accent }
  if (state.isProcessing) return { label: 'Thinking', color: colors.accent }
  if (state.isMuted) return { label: 'Muted', color: colors.danger }
  return { label: 'Your turn', color: colors.success }
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    gap: 16,
    paddingHorizontal: 20,
  },
  header: {
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  meters: {
    flexDirection: 'row',
    gap: 16,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
  },
})
