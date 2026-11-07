import { PassThrough } from 'stream'
import { Agent } from './Agent'

export class MockAgent extends Agent {
  private i = 0

  constructor() {
    super({ systemPrompt: '' })
  }

  protected async generateAnswer(stream: PassThrough): Promise<void> {
    const message = `Assistant Message ${this.i++}`
    // Written, then recorded once complete, as a real agent does
    stream.write(message)
    this.addAssistantMessage(message)
  }
}
