import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configureJsonStoreAdapter, type VersionedJsonValue } from '../../server/src/runtime/jsonStoreAdapter'
import { createWorkspaceAdminSession } from '../../server/src/data/sessionStore'
import { routeApi } from '../src/apiRouter'
import { handleMediaApi } from '../src/media'
import { handleMonitoring } from '../src/monitoring'
import type { Env } from '../src/env'

test('Worker bloqueia Editor em todas as áreas administrativas e preserva widgets públicos', async () => {
  const records = new Map<string, VersionedJsonValue>()
  configureJsonStoreAdapter({
    async read(name) { return records.get(name) ?? null },
    async write(name, value) { records.set(name, { value, version: (records.get(name)?.version ?? 0) + 1 }) },
    async writeIfVersion(name, value, expected) {
      if ((records.get(name)?.version ?? null) !== expected) return false
      records.set(name, { value, version: (expected ?? 0) + 1 })
      return true
    },
  })
  process.env.GOOGLE_WORKSPACE_DOMAIN = 'example.com'
  const email = 'operator@example.com'
  // No bindings are needed for a denied request: authorization runs first.
  const env = {} as Env
  for (const role of ['editor', 'admin']) {
    records.set('users.json', { value: JSON.stringify([{ email, role }]), version: 1 })
    const makeRequest = async (path: string, method = 'GET') => {
      // A fresh session per route prevents a previous rejection from masking
      // a missing role check in a different administrative entry point.
      const session = await createWorkspaceAdminSession(email)
      return new Request(`https://screens.example.com${path}`, {
        method, headers: { cookie: `corporate-screen.session=${session.token}` },
      })
    }
    for (const path of ['/api/tvs', '/api/layouts', '/api/playlists', '/api/schedules', '/api/users', '/api/settings', '/api/rankings', '/api/news']) {
      const res = await routeApi(await makeRequest(path), env)
      assert.equal(res.status, role === 'admin' ? 200 : 401, path)
    }
    if (role === 'editor') {
      for (const method of ['GET', 'POST', 'DELETE']) {
        assert.equal((await handleMediaApi(await makeRequest('/api/uploads/media', method), env)).status, 401)
      }
      for (const path of ['/api/monitoring/status', '/api/monitoring/logs']) {
        assert.equal((await handleMonitoring(await makeRequest(path), env, path)).status, 401)
      }
      assert.equal((await routeApi(await makeRequest('/api/tvs', 'POST'), env)).status, 401)
      assert.equal((await routeApi(await makeRequest('/api/layouts/example', 'DELETE'), env)).status, 401)
    }
  }
  assert.equal((await routeApi(new Request('https://screens.example.com/api/widgets/birthdays/today'), env)).status, 200)
  assert.equal((await routeApi(new Request('https://screens.example.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'unused' }) }), env)).status, 410)
})
