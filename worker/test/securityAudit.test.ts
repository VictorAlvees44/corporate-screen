import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { configureJsonStoreAdapter, type VersionedJsonValue } from '../../server/src/runtime/jsonStoreAdapter'
import { createWorkspaceAdminSession } from '../../server/src/data/sessionStore'
import { routeApi } from '../src/apiRouter'
import { handleMediaApi, serveMedia } from '../src/media'
import { handleMonitoring } from '../src/monitoring'
import { rejectCrossSiteMutation } from '../src/security'
import type { Env } from '../src/env'

let records: Map<string, VersionedJsonValue>
beforeEach(() => {
  records = new Map()
  process.env.GOOGLE_WORKSPACE_DOMAIN = 'example.com'
  configureJsonStoreAdapter({
    async read(name) { return records.get(name) ?? null },
    async write(name, value) { records.set(name, { value, version: (records.get(name)?.version ?? 0) + 1 }) },
    async writeIfVersion(name, value, expected) {
      if ((records.get(name)?.version ?? null) !== expected) return false
      records.set(name, { value, version: (expected ?? 0) + 1 }); return true
    },
  })
})
async function cookie() {
  records.set('users.json', { value: JSON.stringify([{ email: 'admin@example.com', role: 'admin' }]), version: 1 })
  return `corporate-screen.session=${(await createWorkspaceAdminSession('admin@example.com')).token}`
}
function req(path: string, method = 'GET', auth?: string, body?: unknown) {
  return new Request(`https://screens.example.com${path}`, { method, headers: { ...(auth ? { cookie: auth } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
}

test('Worker rejeita visitante e cookie forjado em leituras, mudanças, aprovação e diagnóstico', async () => {
  const routes = [
    ['GET', '/api/tvs'], ['POST', '/api/tvs'], ['PUT', '/api/tvs/TV-1'], ['DELETE', '/api/tvs/TV-1'],
    ['PUT', '/api/tvs/TV-1/approve'], ['POST', '/api/tvs/TV-1/diagnose'], ['POST', '/api/tvs/TV-1/refresh'], ['POST', '/api/playlists'],
    ['POST', '/api/layouts'], ['POST', '/api/schedules'], ['POST', '/api/users'], ['DELETE', '/api/users/admin@example.com'],
    ['POST', '/api/news'], ['POST', '/api/news/refresh'], ['PUT', '/api/settings'], ['POST', '/api/settings/refresh-players'],
    ['POST', '/api/rankings'], ['POST', '/api/birthdays'],
  ]
  for (const auth of [undefined, 'corporate-screen.session=forged']) {
    for (const [method, path] of routes) assert.equal((await routeApi(req(path, method, auth), {} as Env)).status, 401, `${method} ${path}`)
    assert.equal((await handleMediaApi(req('/api/uploads/media', 'POST', auth), {} as Env)).status, 401)
    assert.equal((await handleMonitoring(req('/api/monitoring/status', 'GET', auth), {} as Env, '/api/monitoring/status')).status, 401)
  }
})

test('somente admin atual solicita diagnóstico e cadastro manual antigo foi desativado', async () => {
  const auth = await cookie()
  records.set('tvs.json', { value: JSON.stringify([{ id: 'TV-1', playerToken: 'test-secret', approvalStatus: 'pendente' }]), version: 1 })
  const res = await routeApi(req('/api/tvs/TV-1/diagnose', 'POST', auth), {} as Env)
  assert.equal(res.status, 200)
  const body = await res.json() as { diagnosticoSolicitadoEm: string; playerToken?: string; approvalStatus: string }
  assert.ok(body.diagnosticoSolicitadoEm); assert.equal(body.playerToken, undefined); assert.equal(body.approvalStatus, 'pendente')
  assert.equal((await routeApi(req('/api/tvs', 'POST', auth, {}), {} as Env)).status, 410)
  records.set('users.json', { value: '[]', version: 2 })
  assert.equal((await routeApi(req('/api/tvs/TV-1/diagnose', 'POST', auth), {} as Env)).status, 401)
})

test('corpos JSON inválidos ou grandes são rejeitados antes do controlador', async () => {
  for (const body of [null, [], 3, 'text']) assert.equal((await routeApi(req('/api/player/TV-1/content', 'POST', undefined, body), {} as Env)).status, 400)
  const res = await routeApi(req('/api/player/TV-1/content', 'POST', undefined, { value: 'x'.repeat(5000) }), {} as Env)
  assert.equal(res.status, 413)
  const auth = await cookie()
  const invalid = await routeApi(req('/api/playlists', 'POST', auth, { nome: 'Test', itens: [{ tipo: 'link', arquivo: 'javascript:alert(1)' }] }), {} as Env)
  assert.equal(invalid.status, 400)
  assert.match((await invalid.json() as { message: string }).message, /Protocolo/)
})

test('upload autenticado confere MIME e assinatura; mídia usa MIME canônico e sandbox', async () => {
  const auth = await cookie()
  const writes: string[] = []
  const env = { MEDIA: { async put(key: string) { writes.push(key) }, async get() { return { body: new Uint8Array([255,216,255]), size: 3, httpEtag: 'test', writeHttpMetadata(headers: Headers) { headers.set('content-type', 'image/svg+xml') } } } } } as unknown as Env
  for (const [name, type, bytes, status] of [
    ['attack.jpg', 'image/svg+xml; charset=utf-8', new TextEncoder().encode('<svg/>'), 400],
    ['attack.jpg', 'image/jpeg', new TextEncoder().encode('<html/>'), 400],
    ['valid.png', 'image/png', new Uint8Array([137,80,78,71,13,10,26,10]), 201],
  ] as const) {
    const form = new FormData(); form.set('file', new File([bytes], name, { type }))
    const res = await handleMediaApi(new Request('https://screens.example.com/api/uploads/media', { method: 'POST', headers: { cookie: auth }, body: form }), env)
    assert.equal(res.status, status)
  }
  assert.equal(writes.length, 1)
  const served = await serveMedia(req('/uploads/images/old.jpg'), env)
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  assert.match(served.headers.get('content-security-policy') || '', /sandbox/)
})

test('Worker impede mutações de outra origem e de iframe com origem opaca', () => {
  for (const origin of ['https://evil.example', 'null']) {
    const request = new Request('https://screens.example.com/api/users', { method: 'POST', headers: { origin } })
    assert.equal(rejectCrossSiteMutation(request)?.status, 403)
  }
  assert.equal(rejectCrossSiteMutation(new Request('https://screens.example.com/api/users', { method: 'POST', headers: { origin: 'https://screens.example.com' } })), null)
})
