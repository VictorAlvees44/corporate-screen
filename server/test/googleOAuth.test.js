import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { configureJsonStoreAdapter } from '../dist/runtime/jsonStoreAdapter.js'
import { createGoogleLoginAttempt, consumeGoogleLoginAttempt, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, verifyGoogleIdentity } from '../dist/utils/googleOAuth.js'
import { completeGoogleLogin, getAuthProviders, startGoogleLogin } from '../dist/controllers/authController.js'

const clientId = 'test.apps.googleusercontent.com'
const domain = 'example.com'
const email = `admin@${domain}`
const callback = 'https://screens.example.com/api/auth/google/callback'
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' }
const keys = createLocalJWKSet({ keys: [jwk] })
let records

beforeEach(() => {
  records = new Map()
  configureJsonStoreAdapter({
    async read(name) { return records.get(name) ?? null },
    async write(name, value) { records.set(name, { value, version: (records.get(name)?.version ?? 0) + 1 }) },
    async writeIfVersion(name, value, expected) {
      if ((records.get(name)?.version ?? null) !== expected) return false
      records.set(name, { value, version: (expected ?? 0) + 1 })
      return true
    },
  })
  process.env.GOOGLE_OAUTH_CLIENT_ID = clientId
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret-not-a-real-credential'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = callback
  process.env.GOOGLE_WORKSPACE_DOMAIN = domain
  process.env.COOKIE_SECURE = 'true'
})

function response() {
  return {
    statusCode: 200, cookies: [], cleared: [],
    status(code) { this.statusCode = code; return this },
    type() { return this },
    send(body) { this.body = body; return this },
    json(body) { this.body = body; return this },
    redirect(code, location) { this.statusCode = code; this.location = location; return this },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this },
    clearCookie(name, options) { this.cleared.push({ name, options }); return this },
  }
}

function request(query = {}, cookie = '', host = 'screens.example.com') {
  return { query, protocol: 'https', header: () => cookie, get: () => host }
}

async function signedToken(nonce, overrides = {}, signingKey = privateKey) {
  return new SignJWT({
    iss: 'https://accounts.google.com', aud: clientId, sub: 'test-subject',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    email, email_verified: true, hd: domain, nonce, ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(signingKey)
}

test('OAuth vincula state ao navegador, armazena hash e impede reutilização concorrente', async () => {
  const attempt = await createGoogleLoginAttempt()
  const stored = JSON.parse(records.get('oauth-states.json').value)
  assert.equal(stored[attempt.state], undefined)
  assert.ok(stored[createHash('sha256').update(attempt.state).digest('hex')])
  assert.equal(await consumeGoogleLoginAttempt(attempt.state, null), null)
  assert.equal(await consumeGoogleLoginAttempt(attempt.state, 'f'.repeat(64)), null)
  const results = await Promise.all([
    consumeGoogleLoginAttempt(attempt.state, attempt.state),
    consumeGoogleLoginAttempt(attempt.state, attempt.state),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(results.find(Boolean).nonce, attempt.nonce)
  assert.equal(createHash('sha256').update(results.find(Boolean).codeVerifier).digest('base64url'), attempt.codeChallenge)
  assert.equal(await consumeGoogleLoginAttempt(attempt.state, attempt.state), null)
})

test('OAuth rejeita state vencido, malformado e formato antigo', async () => {
  const attempt = await createGoogleLoginAttempt(1000)
  assert.equal(await consumeGoogleLoginAttempt(attempt.state, attempt.state, 1000 + OAUTH_STATE_TTL_MS), null)
  assert.equal(await consumeGoogleLoginAttempt('bad', 'bad'), null)
  records.set('oauth-states.json', { value: JSON.stringify({ old: Date.now() }), version: 1 })
  await createGoogleLoginAttempt()
  assert.equal(JSON.parse(records.get('oauth-states.json').value).old, undefined)
})

test('início OAuth usa cookie protegido, nonce, PKCE e somente identidade básica', async () => {
  const res = response()
  await startGoogleLogin(request(), res)
  const url = new URL(res.location)
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('scope'), 'openid email')
  assert.equal(url.searchParams.get('hd'), domain)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('nonce'))
  assert.deepEqual(res.cookies[0], {
    name: OAUTH_STATE_COOKIE, value: url.searchParams.get('state'),
    options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/google', maxAge: OAUTH_STATE_TTL_MS },
  })
})

test('início OAuth usa domínio canônico antes de criar cookie', async () => {
  const res = response()
  await startGoogleLogin(request({}, '', 'alternate.workers.dev'), res)
  assert.equal(res.location, 'https://screens.example.com/api/auth/google')
  assert.equal(res.cookies.length, 0)
  assert.equal(records.size, 0)
})

test('OAuth falha fechado quando domínio Workspace não foi configurado', async () => {
  delete process.env.GOOGLE_WORKSPACE_DOMAIN
  const providers = response()
  await getAuthProviders({ ip: '127.0.0.1' }, providers)
  assert.equal(providers.body.google, false)
  const res = response()
  await startGoogleLogin(request(), res)
  assert.equal(res.statusCode, 503)
})

test('valida assinatura, emissor, audiência, prazo, nonce e domínio Workspace real', async () => {
  assert.equal(await verifyGoogleIdentity(await signedToken('nonce'), clientId, domain, 'nonce', keys), email)
  for (const overrides of [
    { iss: 'https://attacker.example' }, { aud: 'another-client' }, { exp: 1 },
    { nonce: 'wrong' }, { hd: undefined }, { hd: 'other.example' },
    { email_verified: false }, { email: 'someone@gmail.com' }, { azp: 'another-client' },
    { aud: [clientId, 'another-client'] }, { sub: undefined }, { iat: undefined },
  ]) {
    await assert.rejects(verifyGoogleIdentity(await signedToken('nonce', overrides), clientId, domain, 'nonce', keys))
  }
  const other = await generateKeyPair('RS256')
  await assert.rejects(verifyGoogleIdentity(await signedToken('nonce', {}, other.privateKey), clientId, domain, 'nonce', keys))
})

test('callback rejeita login sem cookie e não chama o Google', async (t) => {
  const attempt = await createGoogleLoginAttempt()
  const mocked = t.mock.method(globalThis, 'fetch', () => { throw new Error('não deveria chamar') })
  const res = response()
  await completeGoogleLogin(request({ state: attempt.state, code: 'code' }), res)
  assert.equal(res.statusCode, 400)
  assert.equal(mocked.mock.callCount(), 0)
  assert.equal(res.cookies.length, 0)
})

test('callback permite apenas admin explícito; nega editor, legado, conta não listada e replay', async (t) => {
  let currentToken
  let expectedChallenge
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] })
    assert.equal(String(url), 'https://oauth2.googleapis.com/token')
    assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), expectedChallenge)
    return Response.json({ id_token: currentToken })
  })
  for (const users of [[], [{ email, role: 'editor' }], [email], [{ email }], [{ email, role: 'admin' }]]) {
    const authorized = users[0]?.role === 'admin'
    const attempt = await createGoogleLoginAttempt()
    expectedChallenge = attempt.codeChallenge
    currentToken = await signedToken(attempt.nonce)
    records.set('users.json', { value: JSON.stringify(users), version: 1 })
    const req = request({ code: 'test-code', state: attempt.state }, `${OAUTH_STATE_COOKIE}=${attempt.state}`)
    const res = response()
    await completeGoogleLogin(req, res)
    assert.equal(res.statusCode, authorized ? 303 : 403)
    assert.equal(res.cookies.length, authorized ? 1 : 0)
    assert.equal(res.cleared[0].name, OAUTH_STATE_COOKIE)
    if (authorized) {
      assert.equal(res.location, '/admin')
      assert.ok(records.get('sessions.json'))
    } else {
      assert.equal(records.get('sessions.json'), undefined)
    }
    const replay = response()
    await completeGoogleLogin(req, replay)
    assert.equal(replay.statusCode, 400)
  }
})
