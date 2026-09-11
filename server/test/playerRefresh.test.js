import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { refreshTVHandler } from '../dist/controllers/tvController.js'
import { getPlayerContent } from '../dist/controllers/playerController.js'
import { getSettings } from '../dist/data/settingsRepository.js'
import { findTVById } from '../dist/data/tvRepository.js'
import { latestPlayerRefresh, synchronizationForPlayer } from '../dist/utils/playerCommands.js'
import { useMemoryJsonStore } from './helpers/memoryJsonStore.js'

const global = '2026-01-01T10:00:00.000Z'
let records
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } } }
beforeEach(() => {
  records = useMemoryJsonStore()
  records.set('settings.json', { version: 1, value: JSON.stringify({ atualizacaoPlayersEm: global, cicloSincronizadoEm: global, sincronizacaoImagensAtiva: false, modoOperacao: 'normal' }) })
  records.set('tvs.json', { version: 1, value: JSON.stringify(['TV-1', 'TV-2'].map((id) => ({ id, playerToken: `test-${id}`, approvalStatus: 'pendente', playlistAtual: 'playlist', ultimaConexao: new Date().toISOString() }))) })
})

test('atualização individual muda só a TV solicitada e preserva ciclo, aprovação e playlist', async () => {
  const before = await getSettings()
  const other = await findTVById('TV-2')
  const result = response(); await refreshTVHandler({ params: { id: 'TV-1' } }, result)
  assert.equal(result.statusCode, 200); assert.ok(result.body.atualizacaoSolicitadaEm)
  assert.equal(result.body.playerToken, undefined)
  assert.equal(result.body.approvalStatus, 'pendente'); assert.equal(result.body.playlistAtual, 'playlist')
  assert.deepEqual(await findTVById('TV-2'), other)
  assert.deepEqual(await getSettings(), before)
  const missing = response(); await refreshTVHandler({ params: { id: 'missing' } }, missing)
  assert.equal(missing.statusCode, 404)
})

test('player antigo recebe comando individual no campo já conhecido; ACK é exclusivo da TV', async () => {
  const updated = response(); await refreshTVHandler({ params: { id: 'TV-1' } }, updated)
  const individual = updated.body.atualizacaoSolicitadaEm
  for (const id of ['TV-1', 'TV-2']) {
    const result = response()
    await getPlayerContent({ params: { tvId: id }, header: () => `test-${id}` }, result)
    assert.equal(result.body.atualizacaoPlayersEm, id === 'TV-1' ? individual : global)
    assert.equal(result.body.cicloSincronizadoEm, global)
    const ack = response()
    await getPlayerContent({ params: { tvId: id }, header: () => `test-${id}`, body: { playback: { state: 'pending', version: '1', receivedSync: individual } } }, ack)
    assert.equal((await findTVById(id)).reproducao.receivedSync, id === 'TV-1' ? individual : '')
  }
})

test('a atualização mais nova prevalece, inclusive um comando global posterior', () => {
  const individual = '2026-01-01T11:00:00.000Z'
  const nextGlobal = '2026-01-01T12:00:00.000Z'
  assert.equal(latestPlayerRefresh(global, individual), individual)
  assert.equal(latestPlayerRefresh(nextGlobal, individual), nextGlobal)
  assert.equal(latestPlayerRefresh('', individual), individual)
  assert.equal(latestPlayerRefresh(global, 'invalid'), global)
})

test('Samsung Chromium 25 reproduz vídeo sem busca sincronizada que trava a tela', () => {
  const oldSamsung = 'Mozilla/5.0 (SMART-TV; X11; Linux armv7l) AppleWebKit/537.42 Chromium/25.0.1349.2 Chrome/25.0.1349.2'
  assert.equal(synchronizationForPlayer(true, oldSamsung, true), false)
  assert.equal(synchronizationForPlayer(true, oldSamsung, false), true)
  assert.equal(synchronizationForPlayer(true, 'Mozilla/5.0 (SMART-TV) Chrome/63.0.0.0', true), true)
  assert.equal(synchronizationForPlayer(false, oldSamsung, true), false)
})
