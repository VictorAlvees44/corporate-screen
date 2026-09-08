import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createWorkspaceAdminSession, findSession } from '../dist/data/sessionStore.js'
import { findAuthenticatedAdmin } from '../dist/utils/adminAccess.js'
import { getAuthProviders, getCurrentSession, rejectLegacyLogin } from '../dist/controllers/authController.js'
import { createAuthorizedUser } from '../dist/controllers/userController.js'
import { requireAuth } from '../dist/middleware/requireAuth.js'
import { useMemoryJsonStore } from './helpers/memoryJsonStore.js'

let records
const email = 'admin@example.com'
beforeEach(() => {
  records = useMemoryJsonStore()
  process.env.GOOGLE_WORKSPACE_DOMAIN = 'example.com'
})

function grant(role = 'admin') {
  records.set('users.json', { version: 1, value: JSON.stringify([{ email, role }]) })
}

function response() {
  return {
    statusCode: 200, locals: {}, cleared: false,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    clearCookie() { this.cleared = true; return this },
  }
}

test('senha e login local nunca são reativados por variáveis de ambiente antigas', async () => {
  Object.assign(process.env, { ADMIN_PASSWORD: 'test-password-not-a-real-secret' })
  process.env.ALLOW_EMAIL_LOGIN_OVER_NETWORK = 'true'
  for (const nodeEnv of ['production', 'development']) {
    process.env.NODE_ENV = nodeEnv
    for (const ip of ['127.0.0.1', '::1', '192.0.2.1']) {
      const req = { ip, body: { email, password: process.env.ADMIN_PASSWORD } }
      const providers = response()
      await getAuthProviders(req, providers)
      assert.equal(providers.body.passwordLogin, false)
      assert.equal(providers.body.emailLogin, false)
      assert.equal(providers.body.adminOnly, true)
      const res = response()
      await rejectLegacyLogin(req, res)
      assert.equal(res.statusCode, 410)
      assert.equal(records.has('sessions.json'), false)
    }
  }
})

test('admin Workspace acessa; rebaixamento para Editor invalida a sessão existente', async () => {
  grant()
  const session = await createWorkspaceAdminSession(email)
  assert.equal((await findAuthenticatedAdmin(session.token))?.email, email)
  grant('editor')
  assert.equal(await findAuthenticatedAdmin(session.token), null)
  assert.equal(await findSession(session.token), undefined)
  grant()
  assert.equal(await findAuthenticatedAdmin(session.token), null)
})

test('conta removida, domínio diferente e permissão implícita são rejeitados', async () => {
  for (const users of [[], [email], [{ email }], [{ email, role: 'unknown' }]]) {
    records.set('users.json', { version: 1, value: JSON.stringify(users) })
    const session = await createWorkspaceAdminSession(email)
    assert.equal(await findAuthenticatedAdmin(session.token), null)
  }
  grant()
  const session = await createWorkspaceAdminSession(email)
  process.env.GOOGLE_WORKSPACE_DOMAIN = 'different.example'
  assert.equal(await findAuthenticatedAdmin(session.token), null)
})

test('sessão e middleware Express exigem admin e limpam o cookie negado', async () => {
  grant()
  const session = await createWorkspaceAdminSession(email)
  const req = { header: () => `corporate-screen.session=${session.token}` }
  const me = response()
  await getCurrentSession(req, me)
  assert.equal(me.body.user.role, 'admin')
  const accepted = response()
  let nextCalls = 0
  await requireAuth(req, accepted, () => { nextCalls++ })
  assert.equal(nextCalls, 1)
  assert.equal(accepted.locals.authenticatedRole, 'admin')
  grant('editor')
  const denied = response()
  await requireAuth(req, denied, () => { nextCalls++ })
  assert.equal(denied.statusCode, 401)
  assert.equal(denied.cleared, true)
  assert.equal(nextCalls, 1)
  const revoked = response()
  await getCurrentSession(req, revoked)
  assert.equal(revoked.statusCode, 401)
})

test('cadastro de usuários rejeita domínio externo e não rebaixa o próprio admin', async () => {
  for (const body of [{ email: 'outside@gmail.com', role: 'admin' }, { email, role: 'editor' }]) {
    const res = response()
    res.locals.authenticatedUser = email
    await createAuthorizedUser({ body }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(records.has('users.json'), false)
  }
})
