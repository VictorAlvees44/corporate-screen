import { timingSafeEqual } from 'crypto'

export function hasValidPlayerToken(received: unknown, expected: unknown): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string' || received.length > 160 || !received || !expected) return false
  const first = Buffer.from(received)
  const second = Buffer.from(expected)
  return first.length === second.length && timingSafeEqual(first, second)
}

export class PlayerRegistrationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}
