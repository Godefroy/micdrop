import { ReconnectingSocket, TTS } from '@micdrop/server'
import { Readable } from 'stream'
import { RawData } from 'ws'
import {
  DEFAULT_MODEL_NAME,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_REGION,
  GradiumAudioResponse,
  GradiumEosMessage,
  GradiumResponse,
  GradiumSetupMessage,
  GradiumTextMessage,
  GradiumTTSOptions,
} from './types'

// API Reference: https://gradium.ai/api_docs.html

/**
 * The utterance Gradium is synthesizing. While there is one the TTS is
 * speaking, and when there is none it is idle: every way out of a request
 * (end of stream, server error, cancel, text stream error, give up) clears it,
 * so nothing about it outlives it.
 */
interface GradiumRequest {
  id: string
  /** Complete words received so far, sent again whole on a new connection */
  words: string
  /** Start of a word, held until a space completes it or the stream ends */
  partial: string
  /** The text stream ended, so Gradium was told no more text follows */
  ended: boolean
}

export class GradiumTTS extends TTS {
  private socket: ReconnectingSocket
  // Numbers the audio requests, and only moves when there is something to say
  private counter = 0
  // Bumped by every speak() and every cancel(), so a request claimed late can
  // tell whether it is still the one that should be heard
  private generation = 0
  private request?: GradiumRequest

  constructor(private readonly options: GradiumTTSOptions) {
    super()

    const region = options.region ?? DEFAULT_REGION
    this.socket = new ReconnectingSocket({
      url: `wss://${region}.api.gradium.ai/api/speech/tts`,
      clientOptions: { headers: { 'x-api-key': options.apiKey } },
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', this.onOpen)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Failed', this.onFailed)
    this.socket.connect()
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let request: GradiumRequest | undefined

    // Claiming the request is deferred until there is something to say.
    //
    // Taking the next id right away would silence the utterance still playing,
    // because incoming audio is matched against the current id and anything
    // older is dropped. A stream that never carries a word, which is what an
    // answer skipped by a tool or by onBeforeAnswer hands over, would then cut
    // the assistant off mid-sentence for nothing.
    const claimRequest = () => {
      if (request) return request
      // Cancelled, or superseded by another speak(), before the first word
      if (this.generation !== generation) return
      request = {
        id: (++this.counter).toString(),
        words: '',
        partial: '',
        ended: false,
      }
      this.request = request
      // Each speak() is its own multiplexed request, opened by a setup stamped
      // with its client_req_id, so the server binds the voice to it.
      // Multiplexing is what lets the connection serve several utterances
      // (sequential mode only works for the first request on a socket). Without
      // a connection, the setup goes out on open.
      this.sendSetup(request.id)
      // A connection that gave up gets a new chance with a new utterance
      this.socket.connect()
      return request
    }

    textStream.on('data', (chunk: Buffer) => {
      const request = claimRequest()
      if (!request || this.request !== request) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')

      // Only complete words go out, up to the last space
      const spaceIndex = text.lastIndexOf(' ')
      if (spaceIndex === -1) {
        request.partial += text
        return
      }
      const words = request.partial + text.slice(0, spaceIndex + 1)
      request.partial = text.slice(spaceIndex + 1)
      request.words += words
      // Without a connection the words wait, and go out whole on open
      this.sendTranscript(words, request.id)
    })

    textStream.on('error', (error) => {
      if (!request || this.request !== request) return
      this.log('Error in text stream, cancelling the audio', error)
      this.stopRequest()
    })

    textStream.on('end', () => {
      // Nothing was ever said, so there is no request to close and no audio to
      // wait for
      if (!request || this.request !== request) return
      request.ended = true
      this.sendEnd(request)
    })
  }

  /**
   * Stops the current utterance. Gradium can only stop a synthesis by closing
   * its connection, so a new one opens right away.
   */
  cancel() {
    this.generation++
    if (!this.request) return
    this.log('Cancel')
    this.stopRequest()
  }

  destroy() {
    // Destroyed first, so the cancel() that super.destroy() runs opens no new
    // connection
    this.socket.destroy()
    super.destroy()
    this.request = undefined
  }

  /** Forgets the current request, and closes the connection that carries it */
  private stopRequest() {
    this.request = undefined
    // Free of charge on the retry budget, and a speak() that follows lands its
    // setup and text on the new connection
    this.socket.restart()
  }

  private sendSetup(clientReqId: string) {
    const sent = this.socket.send(
      JSON.stringify({
        type: 'setup',
        voice_id: this.options.voiceId,
        model_name: this.options.modelName ?? DEFAULT_MODEL_NAME,
        output_format: this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
        close_ws_on_eos: false,
        json_config: this.options.jsonConfig,
        client_req_id: clientReqId,
      } satisfies GradiumSetupMessage)
    )
    if (sent) this.log(`Sent setup (client_req_id=${clientReqId})`)
  }

  private sendTranscript(text: string, clientReqId: string) {
    const sent = this.socket.send(
      JSON.stringify({
        type: 'text',
        text,
        client_req_id: clientReqId,
      } satisfies GradiumTextMessage)
    )
    if (sent) this.log(`Sent transcript: "${text}"`)
  }

  /** Sends the last partial word, then the end of the text */
  private sendEnd(request: GradiumRequest) {
    if (request.partial.trim()) {
      this.sendTranscript(request.partial, request.id)
    }
    const sent = this.socket.send(
      JSON.stringify({
        type: 'end_of_stream',
        client_req_id: request.id,
      } satisfies GradiumEosMessage)
    )
    if (sent) this.log('Sent end_of_stream')
  }

  // A new connection has no session for the request under way: its setup and
  // its words go out again, the setup first, with the same client_req_id
  private onOpen = () => {
    const request = this.request
    if (!request) return
    this.log('Sending the request again')
    this.sendSetup(request.id)
    if (request.words) this.sendTranscript(request.words, request.id)
    if (request.ended) this.sendEnd(request)
  }

  private onMessage = (data: RawData) => {
    let message: GradiumResponse
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.log('Error parsing message', data)
      return
    }

    switch (message.type) {
      case 'ready':
        // The server emits one ready per setup, informational only
        this.log('Server ready', message.request_id ?? '')
        break

      case 'audio':
        this.processAudioMessage(message)
        break

      case 'end_of_stream':
        // Ignore if from a previous request
        if (
          !this.request ||
          (message.client_req_id !== undefined &&
            message.client_req_id !== this.request.id)
        )
          return
        this.log('Audio ended')
        this.request = undefined
        break

      case 'error':
        // The connection carries one request at a time, since cancel() closes
        // it, so the error is about the current one, which gets no more audio.
        // Its text is handed over, so a FallbackTTS can speak it instead, and
        // a fresh connection keeps the next request clear of it.
        this.log('Error:', message.message, message.code)
        if (!this.request) break
        this.onFailed()
        this.socket.restart()
        break
    }
  }

  private processAudioMessage(message: GradiumAudioResponse) {
    // Ignore messages from previous requests
    if (!this.request || message.client_req_id !== this.request.id) return

    const chunk = Buffer.from(message.audio, 'base64')
    this.log(`Received audio chunk (${chunk.length} bytes)`)
    this.emit('Audio', chunk)
  }

  private onFailed = () => {
    const request = this.request
    this.request = undefined
    const text = request ? request.words + request.partial : ''
    this.emit('Failed', text ? [text] : [])
  }
}
