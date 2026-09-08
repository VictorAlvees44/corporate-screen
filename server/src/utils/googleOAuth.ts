import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { mutateJSON } from '../data/jsonStore'

export const OAUTH_STATE_COOKIE = 'corporate-screen.oauth-state'
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const OAUTH_STATE_FILE = 'oauth-states.json'
const MAX_PENDING_OAUTH_STATES = 500
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 10_000,
})

interface GoogleLoginAttempt {
  createdAt: number
  nonce: string
  codeVerifier: string
}

type PendingAttempts = Record<string, GoogleLoginAttempt>

function activeAttempt(value: GoogleLoginAttempt | undefined, now: number): value is GoogleLoginAttempt {
  // Ignore the old state format during rolling deployments.
  return Boolean(value && typeof value === 'object' && Number.isFinite(value.createdAt)
    && now >= value.createdAt && now - value.createdAt < OAUTH_STATE_TTL_MS
    && typeof value.nonce === 'string' && typeof value.codeVerifier === 'string')
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

export async function createGoogleLoginAttempt(now = Date.now()) {
  const state = Buffer.from(randomBytes(32)).toString('hex')
  const nonce = Buffer.from(randomBytes(32)).toString('hex')
  const codeVerifier = Buffer.from(randomBytes(32)).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  await mutateJSON<PendingAttempts>(OAUTH_STATE_FILE, {}, (attempts) => {
    const active = Object.entries(attempts)
      .filter(([, attempt]) => activeAttempt(attempt, now))
      .sort((first, second) => first[1].createdAt - second[1].createdAt)
      .slice(-(MAX_PENDING_OAUTH_STATES - 1))
    return { ...Object.fromEntries(active), [hashState(state)]: { createdAt: now, nonce, codeVerifier } }
  })
  return { state, nonce, codeChallenge }
}

export async function consumeGoogleLoginAttempt(
  state: string | undefined,
  browserState: string | null,
  now = Date.now(),
): Promise<GoogleLoginAttempt | null> {
  if (!state || !browserState || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browserState)
    || !timingSafeEqual(Buffer.from(state), Buffer.from(browserState))) return null

  let consumed: GoogleLoginAttempt | null = null
  const key = hashState(state)
  await mutateJSON<PendingAttempts>(OAUTH_STATE_FILE, {}, (attempts) => {
    // Reset on every CAS retry: only the successful writer may consume it.
    consumed = activeAttempt(attempts[key], now) ? attempts[key] : null
    const next = { ...attempts }
    delete next[key]
    return next
  })
  return consumed
}

export async function verifyGoogleIdentity(
  idToken: string,
  clientId: string,
  workspaceDomain: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<string> {
  const { payload } = await jwtVerify(idToken, keys, {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email', 'email_verified', 'hd'],
    maxTokenAge: '10 minutes',
    clockTolerance: 60,
  })
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!workspaceDomain || payload.hd !== workspaceDomain || payload.email_verified !== true
    || !email.endsWith(`@${workspaceDomain}`) || payload.nonce !== nonce
    || (payload.azp !== undefined && payload.azp !== clientId)
    || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
    throw new Error('Identidade Google não autorizada')
  }
  return email
}
