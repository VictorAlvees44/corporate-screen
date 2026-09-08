import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configureJsonStoreAdapter, type VersionedJsonValue } from '../../server/src/runtime/jsonStoreAdapter'
import { routeApi } from '../src/apiRouter'
import type { Env } from '../src/env'
import { playbackSummary, hasReceivedRefresh, latestRefresh } from '../../client/src/utils/playbackStatus'
import type { TV } from '../../client/src/types'

test('Worker aceita diagnóstico pelo poll POST somente com token da TV', async () => {
  const records = new Map<string, VersionedJsonValue>()
  configureJsonStoreAdapter({
    async read(name) { return records.get(name) ?? null },
    async write(name, value) { records.set(name, { value, version: (records.get(name)?.version ?? 0) + 1 }) },
    async writeIfVersion(name, value, expected) {
      if ((records.get(name)?.version ?? null) !== expected) return false
      records.set(name, { value, version: (expected ?? 0) + 1 }); return true
    },
  })
  const sync = new Date().toISOString()
  records.set('tvs.json', { value: JSON.stringify([{ id: 'test', playerToken: 'local-test-only', ultimaConexao: sync }]), version: 1 })
  records.set('settings.json', { value: JSON.stringify({ atualizacaoPlayersEm: sync, modoOperacao: 'normal' }), version: 1 })
  for (const token of ['wrong', 'local-test-only']) {
    const res = await routeApi(new Request('https://example.com/api/player/test/content', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-player-token': token },
      body: JSON.stringify({ playback: { version: 'test', state: 'error', errorCode: 'IMAGE_LOAD', receivedSync: sync, lastError: { code: 'IMAGE_LOAD', id: 'e1', mediaName: 'missing.jpg' } } }),
    }), {} as Env)
    assert.equal(res.status, token === 'wrong' ? 401 : 200)
    const data = await res.json() as { tv?: { playerToken?: string } }
    assert.equal(data.tv?.playerToken, undefined)
  }
  const tv = JSON.parse(records.get('tvs.json')!.value)[0]
  assert.equal(tv.reproducao.errorCode, 'IMAGE_LOAD')
  assert.equal(tv.reproducao.receivedSync, sync)
  assert.equal(tv.reproducao.lastError.mediaName, 'missing.jpg')
})

test('painel distingue sem contato, relatório antigo, standby, erro e conteúdo externo', () => {
  const now = Date.now()
  const base = { id: 'test', status: 'online', ultimaConexao: new Date(now).toISOString(), approvalStatus: 'aprovada' } as TV
  assert.equal(playbackSummary(base, now).label, 'Reprodução não confirmada')
  assert.equal(playbackSummary({ ...base, status: 'offline' }, now).label, 'Sem comunicação')
  const tv = { ...base, reproducao: { version: 'test', state: 'standby', reportedAt: base.ultimaConexao } } as TV
  assert.equal(playbackSummary(tv, now).problem, false)
  assert.equal(playbackSummary(tv, now + 121000).label, 'Sem comunicação')
  assert.equal(playbackSummary({ ...tv, ultimaConexao: new Date(now + 121000).toISOString() }, now + 121000).label, 'Diagnóstico desatualizado')
  assert.equal(playbackSummary({ ...tv, reproducao: { ...tv.reproducao!, state: 'error', errorCode: 'VIDEO_DECODE' } }, now).detail.includes('decodificar'), true)
  assert.equal(playbackSummary({ ...tv, reproducao: { ...tv.reproducao!, state: 'external' } }, now).label, 'Conteúdo externo')
})

test('atualização individual confirmada não rebaixa o ACK global já recebido', () => {
  const global = '2026-09-04T10:00:00.000Z'
  const individual = '2026-09-04T11:00:00.000Z'
  const later = '2026-09-04T12:00:00.000Z'
  assert.equal(latestRefresh(global, individual), individual)
  assert.equal(latestRefresh(later, individual), later)
  assert.equal(hasReceivedRefresh(individual, global), true)
  assert.equal(hasReceivedRefresh(global, individual), false)
  assert.equal(hasReceivedRefresh(undefined, global), false)
  assert.equal(hasReceivedRefresh('invalid', global), false)
})
