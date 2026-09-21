import { EventEmitter } from 'events'
import assert from 'node:assert/strict'
import { PassThrough, Readable } from 'node:stream'
import { describe, it } from 'node:test'
import type { WebSocket } from 'ws'
import { Agent, AgentOptions } from '../src/agent'
import {
  Classifier,
  getTurnClassification,
  MicdropCallSummary,
  MicdropConfig,
  MicdropServer,
  MicdropServerCommands,
  MicdropTurnInput,
  STT,
  TTS,
} from '../src/index'

/**
 * Stands in for the browser at the other end of the call: it records what the
 * server sends and lets a test send commands and audio back.
 */
class FakeSocket extends EventEmitter {
  public sent: Array<string | Buffer> = []

  send(data: string | Buffer) {
    this.sent.push(data)
  }

  /** Every text command the server sent, audio chunks left out */
  get commands(): string[] {
    return this.sent.filter((data): data is string => typeof data === 'string')
  }

  get audioChunks(): Buffer[] {
    return this.sent.filter((data): data is Buffer => Buffer.isBuffer(data))
  }

  /** Payloads of one command, parsed back from JSON */
  payloads(command: MicdropServerCommands): any[] {
    return this.commands
      .filter((data) => data.startsWith(`${command} `))
      .map((data) => JSON.parse(data.substring(command.length + 1)))
  }

  countCommand(command: MicdropServerCommands): number {
    return this.commands.filter((data) => data === command).length
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket
  }

  // What the client does during a turn
  startSpeaking() {
    this.emit('message', Buffer.from('StartSpeaking'))
  }

  sendAudio() {
    this.emit('message', Buffer.alloc(320))
  }

  stopSpeaking() {
    this.emit('message', Buffer.from('StopSpeaking'))
  }

  close() {
    this.emit('close')
  }
}

/** Transcribes nothing on its own, a test decides what was heard and when */
class TestSTT extends STT {
  public streams = 0
  public destroyed = false

  transcribe(audioStream: Readable) {
    this.streams++
    audioStream.on('data', () => {})
  }

  hear(transcript: string) {
    this.emit('Transcript', transcript)
  }

  destroy() {
    this.destroyed = true
    super.destroy()
  }
}

/** Answers with a fixed sentence, written one word at a time */
class TestAgent extends Agent {
  public answers = 0
  public cancelled = 0
  public destroyed = false

  constructor(
    private words: string[] = ['Hello', ' there'],
    options: Partial<AgentOptions> = {}
  ) {
    super({ systemPrompt: 'Be brief', ...options })
  }

  protected async generateAnswer(stream: PassThrough): Promise<void> {
    this.answers++
    for (const word of this.words) {
      stream.write(word)
      await new Promise((resolve) => setImmediate(resolve))
    }
    this.addAssistantMessage(this.words.join(''))
  }

  cancel() {
    this.cancelled++
  }

  destroy() {
    this.destroyed = true
    super.destroy()
  }
}

/** Turns any text into one audio chunk, so a test can tell a voice was used */
class TestTTS extends TTS {
  public spoken: string[] = []
  public destroyed = false

  speak(textStream: Readable) {
    let text = ''
    textStream.on('data', (chunk: Buffer) => {
      text += chunk.toString()
    })
    textStream.on('end', () => {
      this.spoken.push(text)
      this.emit('Audio', Buffer.alloc(64))
    })
  }

  cancel() {}

  destroy() {
    this.destroyed = true
    super.destroy()
  }
}

/** Waits for a condition, so a test does not depend on fixed delays */
async function waitFor(
  check: () => boolean,
  message: string,
  timeout = 2000
): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function startCall(config: Partial<MicdropConfig> & { stt: STT }) {
  const socket = new FakeSocket()
  const server = new MicdropServer(socket.asWebSocket(), config)
  return { socket, server }
}

/** Plays a whole user turn and waits for the server to be done with it */
async function speakTo(socket: FakeSocket, stt: TestSTT, transcript: string) {
  socket.startSpeaking()
  socket.sendAudio()
  socket.stopSpeaking()
  stt.hear(transcript)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('MicdropServer with an agent and a voice', () => {
  it('speaks the first message and answers what it hears', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const tts = new TestTTS()
    const { socket } = startCall({
      stt,
      agent,
      tts,
      firstMessage: 'Good morning',
    })

    await waitFor(() => tts.spoken.length === 1, 'the first message')
    assert.deepEqual(tts.spoken, ['Good morning'])
    assert.deepEqual(socket.payloads(MicdropServerCommands.Message), [
      { role: 'assistant', content: 'Good morning' },
    ])

    await speakTo(socket, stt, 'How are you?')

    assert.equal(agent.answers, 1)
    assert.deepEqual(tts.spoken, ['Good morning', 'Hello there'])
    assert.deepEqual(
      socket
        .payloads(MicdropServerCommands.Message)
        .map((message) => `${message.role}: ${message.content}`),
      [
        'assistant: Good morning',
        'user: How are you?',
        'assistant: Hello there',
      ]
    )
    assert.ok(socket.audioChunks.length > 0, 'the answer was synthesized')
  })

  it('generates the first message when asked to', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const tts = new TestTTS()
    startCall({ stt, agent, tts, generateFirstMessage: true })

    await waitFor(() => tts.spoken.length === 1, 'the generated first message')
    assert.deepEqual(tts.spoken, ['Hello there'])
  })
})

describe('MicdropServer without a voice', () => {
  it('sends the answer as text and hands the turn back', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent })

    await speakTo(socket, stt, 'How are you?')

    assert.equal(agent.answers, 1)
    assert.deepEqual(
      socket
        .payloads(MicdropServerCommands.Message)
        .map((message) => `${message.role}: ${message.content}`),
      ['user: How are you?', 'assistant: Hello there']
    )
    assert.equal(socket.audioChunks.length, 0, 'nothing was synthesized')
    assert.ok(
      socket.countCommand(MicdropServerCommands.SkipAnswer) > 0,
      'the client was told it can listen again'
    )
  })

  it('still sends the first message', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent, firstMessage: 'Good morning' })

    await waitFor(
      () => socket.payloads(MicdropServerCommands.Message).length === 1,
      'the first message'
    )
    assert.deepEqual(socket.payloads(MicdropServerCommands.Message), [
      { role: 'assistant', content: 'Good morning' },
    ])
    assert.equal(socket.audioChunks.length, 0)
  })
})

describe('MicdropServer without an agent', () => {
  it('transcribes and keeps quiet', async () => {
    const stt = new TestSTT()
    const { socket, server } = startCall({ stt })

    await speakTo(socket, stt, 'Note this down')

    assert.deepEqual(socket.payloads(MicdropServerCommands.Message), [
      { role: 'user', content: 'Note this down' },
    ])
    assert.equal(socket.audioChunks.length, 0)
    assert.ok(
      socket.countCommand(MicdropServerCommands.SkipAnswer) > 0,
      'the client was told it can listen again'
    )
    assert.deepEqual(
      server.conversation.map(({ role }) => role),
      ['user']
    )
  })

  it('keeps every sentence of a long dictation', async () => {
    const stt = new TestSTT()
    const { socket, server } = startCall({ stt })

    await speakTo(socket, stt, 'First sentence')
    await speakTo(socket, stt, 'Second sentence')

    assert.deepEqual(
      server.conversation.map((message) =>
        'content' in message ? message.content : ''
      ),
      ['First sentence', 'Second sentence']
    )
  })

  it('records and speaks what the application decides to say', async () => {
    const stt = new TestSTT()
    const tts = new TestTTS()
    const { socket, server } = startCall({ stt, tts })

    server.speak('Noted')
    await waitFor(() => tts.spoken.length === 1, 'the spoken sentence')

    assert.deepEqual(tts.spoken, ['Noted'])
    assert.deepEqual(
      server.conversation.map((message) =>
        'content' in message ? `${message.role}: ${message.content}` : ''
      ),
      ['assistant: Noted']
    )
    assert.deepEqual(socket.payloads(MicdropServerCommands.Message), [
      { role: 'assistant', content: 'Noted' },
    ])
  })

  it('reports the conversation when the call ends', async () => {
    const stt = new TestSTT()
    const { socket, server } = startCall({ stt })
    let summary: MicdropCallSummary | undefined
    server.on('End', (value) => {
      summary = value
    })

    await speakTo(socket, stt, 'Note this down')
    socket.close()

    assert.equal(summary?.conversation.length, 1)
    assert.equal(
      summary?.conversation[0] &&
        'content' in summary.conversation[0] &&
        summary.conversation[0].content,
      'Note this down'
    )
    assert.equal(stt.destroyed, true)
    assert.deepEqual(server.conversation.length, 1, 'readable after the call')
  })

  it('asks nothing of a first message it cannot generate', async () => {
    const stt = new TestSTT()
    const { socket } = startCall({ stt, generateFirstMessage: true })

    await waitFor(
      () => socket.countCommand(MicdropServerCommands.SkipAnswer) === 1,
      'the client to stop waiting'
    )
    assert.deepEqual(socket.payloads(MicdropServerCommands.Message), [])
  })
})

describe('MicdropServer partial messages', () => {
  it('keeps the answer to itself by default', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent })

    await speakTo(socket, stt, 'How are you?')

    assert.deepEqual(
      socket.payloads(MicdropServerCommands.PartialAssistantMessage),
      []
    )
  })

  it('streams the answer while it is being written', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent, partialMessages: true })

    await speakTo(socket, stt, 'How are you?')

    assert.deepEqual(
      socket.payloads(MicdropServerCommands.PartialAssistantMessage),
      ['Hello', 'Hello there'],
      'each one carries the answer so far'
    )
    assert.deepEqual(
      socket
        .payloads(MicdropServerCommands.Message)
        .map((message) => message.content),
      ['How are you?', 'Hello there'],
      'the settled messages still arrive'
    )
  })

  it('streams the answer of a call that has no voice', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent, partialMessages: true })

    await speakTo(socket, stt, 'How are you?')

    assert.deepEqual(
      socket.payloads(MicdropServerCommands.PartialAssistantMessage),
      ['Hello', 'Hello there']
    )
    assert.equal(socket.audioChunks.length, 0)
  })
})

describe('MicdropServer turn handling', () => {
  it('skips the answer when the user said nothing', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent })

    socket.startSpeaking()
    socket.stopSpeaking()
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(agent.answers, 0)
    assert.ok(socket.countCommand(MicdropServerCommands.SkipAnswer) > 0)
  })

  it('skips the answer when nothing was understood', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const { socket } = startCall({ stt, agent })

    socket.startSpeaking()
    socket.sendAudio()
    socket.stopSpeaking()
    stt.hear('')
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(agent.answers, 0)
    assert.ok(socket.countCommand(MicdropServerCommands.SkipAnswer) > 0)
  })

  it('cancels the answer being written when the user speaks again', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const tts = new TestTTS()
    const { socket } = startCall({ stt, agent, tts })

    socket.startSpeaking()
    assert.equal(agent.cancelled, 1)
    assert.equal(stt.streams, 1)
  })

  it('destroys what it was given when the call ends', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const tts = new TestTTS()
    const { socket } = startCall({ stt, agent, tts })

    socket.close()

    assert.equal(agent.destroyed, true)
    assert.equal(stt.destroyed, true)
    assert.equal(tts.destroyed, true)
  })
})

/**
 * Answers with the turn it was given, after a delay the test picks, and keeps
 * every input so a test can tell which ones were classified
 */
class TestClassifier extends Classifier<string, MicdropTurnInput> {
  public inputs: MicdropTurnInput[] = []
  public destroyed = false

  constructor(private delay = 0) {
    super()
  }

  protected async evaluate(input: MicdropTurnInput): Promise<string> {
    this.inputs.push(input)
    if (this.delay === Infinity) return new Promise(() => {})
    await new Promise((resolve) => setTimeout(resolve, this.delay))
    return input.turn.toUpperCase()
  }

  destroy() {
    this.destroyed = true
    super.destroy()
  }
}

/** Plays a turn whose transcript lands in pieces, while the user speaks */
async function speakInPieces(
  socket: FakeSocket,
  stt: TestSTT,
  transcripts: string[]
) {
  socket.startSpeaking()
  socket.sendAudio()
  transcripts.forEach((transcript) => stt.hear(transcript))
  socket.stopSpeaking()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('MicdropServer with an onBeforeAnswer hook', () => {
  it('speaks the text the hook returns instead of generating', async () => {
    const stt = new TestSTT()
    const tts = new TestTTS()
    const agent = new TestAgent(undefined, {
      onBeforeAnswer: () => 'Scripted',
    })
    const { socket } = startCall({ stt, agent, tts })

    await speakTo(socket, stt, 'Hello')

    assert.equal(agent.answers, 0)
    assert.deepEqual(tts.spoken, ['Scripted'])
    const last = agent.conversation[agent.conversation.length - 1]
    assert.equal(last.role, 'assistant')
    assert.equal('content' in last && last.content, 'Scripted')
  })
})

describe('MicdropServer with a classifier', () => {
  it('classifies each turn and sends the result to the client', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const classifier = new TestClassifier()
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      firstMessage: 'How can I help?',
      classifierOptions: { sendToClient: true },
    })
    // The first message is said once the call has started
    await new Promise((resolve) => setTimeout(resolve, 0))

    await speakTo(socket, stt, 'Hi there')

    const [classification] = socket.payloads(
      MicdropServerCommands.Classification
    )
    assert.deepEqual(classification.input, {
      history: [{ role: 'assistant', text: 'How can I help?' }],
      turn: 'Hi there',
    })
    assert.equal(classification.result, 'HI THERE')
  })

  it('classifies a turn once, with all its transcripts', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const classifier = new TestClassifier()
    const { socket } = startCall({ stt, agent, classifier })

    await speakInPieces(socket, stt, ['I have a problem', 'with my bill'])
    await waitFor(() => agent.answers === 1, 'the answer')

    assert.deepEqual(
      classifier.inputs.map((input) => input.turn),
      ['I have a problem with my bill']
    )
  })

  it('reads the turn before and its answer as history', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent(['Got it'])
    const classifier = new TestClassifier()
    const { socket } = startCall({ stt, agent, classifier })

    await speakTo(socket, stt, 'Take the ball')
    await speakTo(socket, stt, 'Now bring it to the cat')
    await speakTo(socket, stt, 'Thanks')

    assert.deepEqual(classifier.inputs[2], {
      history: [
        { role: 'user', text: 'Now bring it to the cat' },
        { role: 'assistant', text: 'Got it' },
      ],
      turn: 'Thanks',
    })
  })

  it('reads as many turns before as asked', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent(['Got it'])
    const classifier = new TestClassifier()
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      classifierOptions: { history: 2 },
    })

    await speakTo(socket, stt, 'Take the ball')
    await speakTo(socket, stt, 'Now bring it to the cat')
    await speakTo(socket, stt, 'Thanks')

    assert.deepEqual(
      classifier.inputs[2].history.map((item) => item.text),
      ['Take the ball', 'Got it', 'Now bring it to the cat', 'Got it']
    )
  })

  it('holds the answer until the classification of its turn is done', async () => {
    const stt = new TestSTT()
    const order: string[] = []
    const classifier = new TestClassifier(30)
    classifier.on('Classification', () => order.push('classification'))
    const agent = new TestAgent()
    agent.on('Message', (message) => {
      if (message.role === 'assistant') order.push('answer')
    })
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      classifierOptions: { waitBeforeAnswer: true },
    })

    await speakInPieces(socket, stt, ['Hello'])
    await waitFor(() => order.length === 2, 'the answer')
    assert.deepEqual(order, ['classification', 'answer'])
  })

  it('keeps the classification of the turn in its last message', async () => {
    const stt = new TestSTT()
    let seen: any
    const agent = new TestAgent(undefined, {
      onBeforeAnswer() {
        seen = getTurnClassification(this.conversation)
      },
    })
    const classifier = new TestClassifier(10)
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      classifierOptions: { waitBeforeAnswer: true },
    })

    await speakInPieces(socket, stt, ['I have a problem', 'with my bill'])
    await waitFor(() => agent.answers === 1, 'the answer')

    assert.equal(seen?.result, 'I HAVE A PROBLEM WITH MY BILL')
    const [first] = agent.conversation.filter((item) => item.role === 'user')
    assert.equal('metadata' in first && first.metadata, undefined)
  })

  it('answers anyway when the classification takes too long', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const classifier = new TestClassifier(Infinity)
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      classifierOptions: { waitBeforeAnswer: true, maxWait: 20 },
    })

    await speakInPieces(socket, stt, ['Hello'])
    await waitFor(() => agent.answers === 1, 'the answer')
  })

  it('drops the answer and the classification when the user speaks again', async () => {
    const stt = new TestSTT()
    const agent = new TestAgent()
    const classifier = new TestClassifier(40)
    const results: string[] = []
    classifier.on('Classification', ({ result }) => results.push(result))
    const { socket } = startCall({
      stt,
      agent,
      classifier,
      classifierOptions: { waitBeforeAnswer: true },
    })

    await speakInPieces(socket, stt, ['I have a problem'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The user goes on before the answer: the turn is classified again whole
    await speakInPieces(socket, stt, ['with my bill'])
    await waitFor(() => agent.answers === 1, 'the answer')

    assert.equal(agent.answers, 1)
    assert.deepEqual(results, ['I HAVE A PROBLEM WITH MY BILL'])
  })

  it('keeps turns apart without an agent to answer them', async () => {
    const stt = new TestSTT()
    const classifier = new TestClassifier()
    const { socket } = startCall({ stt, classifier })

    for (const transcript of ['Take the ball', 'Bring it to the cat']) {
      await speakInPieces(socket, stt, [transcript])
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    assert.deepEqual(classifier.inputs[1], {
      history: [{ role: 'user', text: 'Take the ball' }],
      turn: 'Bring it to the cat',
    })
  })

  it('keeps the results on the server unless told to send them', async () => {
    const stt = new TestSTT()
    const classifier = new TestClassifier()
    const results: string[] = []
    classifier.on('Classification', ({ result }) => results.push(result))
    const { socket } = startCall({ stt, agent: new TestAgent(), classifier })

    await speakTo(socket, stt, 'Secret')

    assert.deepEqual(results, ['SECRET'])
    assert.equal(
      socket.payloads(MicdropServerCommands.Classification).length,
      0
    )
  })

  it('destroys the classifier when the call ends', () => {
    const classifier = new TestClassifier()
    const { socket } = startCall({ stt: new TestSTT(), classifier })

    socket.close()

    assert.equal(classifier.destroyed, true)
  })
})
