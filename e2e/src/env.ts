/** Whether every key a provider needs is set */
export function hasKeys(...names: string[]): boolean {
  return names.every((name) => !!process.env[name])
}

/** A key, or an empty string when it is missing and the test skipped */
export function key(name: string): string {
  return process.env[name] ?? ''
}

/** A key the provider refuses, to test how a failure is reported */
export const INVALID_KEY = 'invalid-key-for-micdrop-e2e'
