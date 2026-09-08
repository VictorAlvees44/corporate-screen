import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { getPlayerContent } from '../dist/controllers/playerController.js'
import { patchTV, findTVById, deleteTV } from '../dist/data/tvRepository.js'
import { normalizePlaybackReport, shouldPersistPlayback } from '../dist/utils/playerTelemetry.js'
import { useMemoryJsonStore } from './helpers/memoryJsonStore.js'

let records
const sync = '2026-09-04T13:00:00.000Z'
const now = '2026-09-04T13:01:00.000Z'
const report = { version: 'test', state: 'playing', receivedSync: sync, itemId: 'item-1', mediaName: 'foto.jpg' }
beforeEach(() => {
  records = useMemoryJsonStore()
  records.set('tvs.json', { version: 1, value: JSON.stringify([{ id: 'TV-1', nome: 'Sala', status: 'online', ultimaConexao: new Date().toISOString(), playerToken: 'device-secret', playlistAtual: 'playlist-1', approvalStatus: 'aprovada' }]) })
  records.set('settings.json', { version: 1, value: JSON.stringify({ modoOperacao: 'normal', atualizacaoPlayersEm: sync }) })
})
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } } }
function request(token = 'device-secret', playback = report) { return { params: { tvId: 'TV-1' }, header: () => token, body: { playback } } }

test('telemetria exige o token exclusivo da TV e não devolve segredos', async () => {
  const denied = response()
  await getPlayerContent(request('wrong'), denied)
  assert.equal(denied.statusCode, 401)
  assert.equal((await findTVById('TV-1')).reproducao, undefined)
  const allowed = response()
  await getPlayerContent(request(), allowed)
  assert.equal(allowed.statusCode, 200)
  assert.equal((await findTVById('TV-1')).reproducao.receivedSync, sync)
  assert.equal(allowed.body.tv.playerToken, undefined)
  assert.equal(allowed.body.tv.deviceId, undefined)
})

test('GET antigo continua funcionando sem inventar confirmação de reprodução', async () => {
  const req = request(); delete req.body
  const res = response(); await getPlayerContent(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal((await findTVById('TV-1')).reproducao, undefined)
})

test('validação limita campos, rejeita estados inválidos e não aceita comando inexistente', () => {
  for (const value of [null, [], 'text', { state: 'root', version: '1' }, { state: ['playing'], version: '1' }]) assert.equal(normalizePlaybackReport(value, undefined, sync, now), undefined)
  const normalized = normalizePlaybackReport({ ...report, mediaName: 'x'.repeat(500), receivedSync: 'fake', playerToken: 'secret', lastError: { id: 'a', code: 'IMAGE_LOAD', mediaName: 'bad.jpg', stack: 'private' } }, undefined, sync, now)
  assert.equal(normalized.mediaName.length, 160)
  assert.equal(normalized.receivedSync, '')
  assert.equal(normalized.playerToken, undefined)
  assert.equal(normalized.lastError.stack, undefined)
  assert.equal(normalized.lastError.receivedAt, now)
})

test('ocorrência persiste após recuperação sem alterar a data original', () => {
  const first = normalizePlaybackReport({ ...report, state: 'error', errorCode: 'VIDEO_DECODE', lastError: { id: 'a', code: 'VIDEO_DECODE', mediaName: 'video.mp4' } }, undefined, sync, now)
  const recovered = normalizePlaybackReport({ ...report, lastError: first.lastError }, first, sync, '2026-09-04T13:02:00Z')
  assert.equal(recovered.state, 'playing')
  assert.equal(recovered.errorCode, '')
  assert.equal(recovered.lastError.receivedAt, now)
  assert.equal(normalizePlaybackReport(report, first, sync, now).lastError.code, 'VIDEO_DECODE')
})

test('limita gravações normais a 45s e prioriza falhas/confirmações após 5s', () => {
  const first = normalizePlaybackReport(report, undefined, sync, now)
  const time = Date.parse(now)
  assert.equal(shouldPersistPlayback(first, { ...first, mediaName: 'next.jpg' }, time + 15000), false)
  assert.equal(shouldPersistPlayback(first, first, time + 45000), true)
  assert.equal(shouldPersistPlayback(first, { ...first, state: 'error' }, time + 1000), false)
  assert.equal(shouldPersistPlayback(first, { ...first, state: 'error' }, time + 5000), true)
  assert.equal(shouldPersistPlayback(first, { ...first, receivedSync: 'next' }, time + 15000), true)
})

test('atualização atômica preserva configuração, relatório e remoção da TV', async () => {
  await Promise.all([
    patchTV('TV-1', (tv) => ({ ...tv, playlistAtual: 'new' })),
    getPlayerContent(request(), response()),
  ])
  const tv = await findTVById('TV-1')
  assert.equal(tv.playlistAtual, 'new')
  assert.equal(tv.reproducao.state, 'playing')
  await deleteTV('TV-1')
  assert.equal(await patchTV('TV-1', (tv) => ({ ...tv, status: 'online' })), undefined)
  assert.equal(await findTVById('TV-1'), undefined)
})
