import { Logger } from '@micdrop/server'
import { onTestFailed } from 'vitest'

/** Keeps the log lines of a provider, to print them if the test fails */
class CapturingLogger extends Logger {
  public lines: string[] = []

  log(...message: any[]) {
    const time = process.uptime().toFixed(3)
    this.lines.push(`[${this.name} ${time}] ${message.map(format).join(' ')}`)
  }
}

function format(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Gives a provider a logger, whose lines show up only when the test fails,
 * with the events that tell what went wrong
 */
export function captureLogs<P extends { logger?: Logger }>(
  provider: P,
  name: string
): P {
  const logger = new CapturingLogger(name)
  provider.logger = logger
  // A classifier has no Failed event, and listening to it changes nothing
  ;(provider as any).on('Failed', (...args: any[]) =>
    logger.log('Failed', ...args)
  )
  onTestFailed(() => {
    console.log(
      `\n--- Logs of ${name} ---\n${logger.lines.slice(-100).join('\n')}`
    )
  })
  return provider
}
