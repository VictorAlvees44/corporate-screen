import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createWorkspaceAdminSession, deleteSession, findSession, SESSION_TTL_MS } from '../dist/data/sessionStore.js'
import { useMemoryJsonStore } from './helpers/memoryJsonStore.js'

test('cria, encontra e encerra uma sessão', async () => {
  const records = useMemoryJsonStore()
  const session = await createWorkspaceAdminSession(' ADMIN@EXAMPLE.COM ')
  assert.equal(session.email, 'admin@example.com')
  const persisted = records.get('sessions.json').value
  assert.equal(persisted.includes(session.token), false)
  assert.equal(JSON.parse(persisted)[0].authMethod, 'google-workspace-admin-v1')
  assert.equal((await findSession(session.token))?.role, 'admin')
  await deleteSession(session.token)
  assert.equal(await findSession(session.token), undefined)
})

test('invalida sessões antigas, mesmo que o e-mail e o perfil sejam de admin', async () => {
  const records = useMemoryJsonStore()
  const token = 'legacy-session'
  records.set('sessions.json', { version: 1, value: JSON.stringify([{
    tokenHash: createHash('sha256').update(token).digest('hex'),
    email: 'admin@example.com', role: 'admin', createdAt: new Date().toISOString(),
  }]) })
  assert.equal(await findSession(token), undefined)
  assert.deepEqual(JSON.parse(records.get('sessions.json').value), [])
})

test('sessão Workspace expira após oito horas', async () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000)
  const records = useMemoryJsonStore()
  const session = await createWorkspaceAdminSession('admin@example.com')
  const stored = JSON.parse(records.get('sessions.json').value)
  stored[0].createdAt = new Date(Date.now() - SESSION_TTL_MS - 1).toISOString()
  records.set('sessions.json', { version: 2, value: JSON.stringify(stored) })
  assert.equal(await findSession(session.token), undefined)
})
