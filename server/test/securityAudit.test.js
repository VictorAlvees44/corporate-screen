import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { registerPlayer, getPlayerContent } from '../dist/controllers/playerController.js'
import { findTVById, findOrCreatePlayerTV } from '../dist/data/tvRepository.js'
import { requestTVDiagnostic } from '../dist/controllers/tvController.js'
import { safeContentUrl, isPrivateAddress, readLimitedBody } from '../dist/utils/contentSecurity.js'
import { hasMediaSignature, isAllowedMediaFile, mediaContentType } from '../dist/utils/mediaValidation.js'
import { rejectCrossSiteMutation, googleLoginLimiter } from '../dist/middleware/requestSecurity.js'
import { normalizePlaybackReport, shouldPersistPlayback } from '../dist/utils/playerTelemetry.js'
import { useMemoryJsonStore } from './helpers/memoryJsonStore.js'

let records
const deviceId = 'device-01234567890123456789'
const token = 'token-local-de-teste-01234567890123456789'
const sync = '2026-09-04T13:00:00.000Z'
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this }, setHeader() {} } }
beforeEach(() => {
  records = useMemoryJsonStore()
  records.set('tvs.json', { version: 1, value: JSON.stringify([{ id: 'TV-1', deviceId, playerToken: token, approvalStatus: 'aprovada', ultimaConexao: sync, playlistAtual: 'private-playlist' }]) })
})

test('conhecer deviceId ou tvId não permite recuperar o token nem assumir a TV', async () => {
  for (const body of [{ deviceId }, { tvId: 'TV-1', deviceId }, { tvId: 'TV-1', deviceId, playerToken: 'wrong' }]) {
    const res = response(); await registerPlayer({ body }, res)
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.playerToken, undefined)
    assert.equal((await findTVById('TV-1')).playerToken, token)
  }
  for (const body of [{ deviceId, playerToken: token }, { deviceId, tvId: 'TV-1', playerToken: token }]) {
    const res = response(); await registerPlayer({ body }, res)
    assert.equal(res.statusCode, 200); assert.equal(res.body.id, 'TV-1')
  }
})

test('cadastro manual sem token não aceita migração pública nem acesso ao conteúdo', async () => {
  records.set('tvs.json', { version: 2, value: JSON.stringify([{ id: 'TV-1', approvalStatus: 'aprovada' }]) })
  const res = response(); await registerPlayer({ body: { tvId: 'TV-1', deviceId } }, res)
  assert.equal(res.statusCode, 401)
  const content = response(); await getPlayerContent({ params: { tvId: 'TV-1' }, header() {} }, content)
  assert.equal(content.statusCode, 401)
})

test('primeiro cadastro é pendente, permite repetição com segredo e limita pendências', async () => {
  const res = response(); await registerPlayer({ body: { deviceId: 'new-device-01234567890123456789', playerToken: token } }, res)
  assert.equal(res.statusCode, 201); assert.equal(res.body.approvalStatus, 'pendente')
  assert.equal(res.body.playlistAtual, null); assert.equal(res.body.playerToken, token)
  const again = response(); await registerPlayer({ body: { deviceId: res.body.deviceId, playerToken: token } }, again)
  assert.equal(again.statusCode, 200); assert.equal(again.body.id, res.body.id)
  records.set('tvs.json', { version: 3, value: JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: `TV-${i}`, approvalStatus: 'pendente' }))) })
  await assert.rejects(findOrCreatePlayerTV('another-device', sync, () => token), { statusCode: 429 })
})

test('pedido de diagnóstico altera só a TV alvo, não expõe credenciais e não reaprova', async () => {
  const res = response(); await requestTVDiagnostic({ params: { id: 'TV-1' } }, res)
  assert.equal(res.statusCode, 200); assert.ok(res.body.diagnosticoSolicitadoEm)
  assert.equal(res.body.playerToken, undefined); assert.equal(res.body.deviceId, undefined)
  assert.equal((await findTVById('TV-1')).playlistAtual, 'private-playlist')
  const missing = response(); await requestTVDiagnostic({ params: { id: 'missing' } }, missing)
  assert.equal(missing.statusCode, 404)
})

test('conteúdo rejeita esquemas ativos e credenciais; permite mídia e HTTP(S)', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', '//evil.example/test', 'https://user:pass@example.com/', 'file:///C:/test', 'https://example.com/a\nb']) assert.throws(() => safeContentUrl(url))
  assert.equal(safeContentUrl('/uploads/images/a.png'), '/uploads/images/a.png')
  assert.equal(safeContentUrl('https://example.com/image.jpg'), 'https://example.com/image.jpg')
})

test('RSS rejeita endereços privados, mapeados IPv6 e redes de transição', () => {
  for (const value of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '172.31.0.2', '192.168.0.1', '198.18.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fc00::1', '2002:7f00:1::', '2001::1']) assert.equal(isPrivateAddress(value), true, value)
  assert.equal(isPrivateAddress('1.1.1.1'), false)
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
})

test('leitura em fluxo cancela corpo grande mesmo sem Content-Length', async () => {
  let cancelled = false
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)) }, cancel() { cancelled = true } })
  await assert.rejects(readLimitedBody(new Response(stream), 10), /limite/)
  assert.equal(cancelled, true)
  assert.equal(new TextDecoder().decode(await readLimitedBody(new Response('ok'), 10)), 'ok')
})

test('upload rejeita SVG com parâmetros e arquivo HTML disfarçado de imagem', () => {
  assert.equal(isAllowedMediaFile('photo.jpg', 'image/svg+xml; charset=utf-8'), false)
  assert.equal(hasMediaSignature('photo.jpg', new TextEncoder().encode('<svg onload="alert(1)"/>')), false)
  assert.equal(hasMediaSignature('photo.png', new Uint8Array([137,80,78,71,13,10,26,10])), true)
  assert.equal(mediaContentType('photo.jpg'), 'image/jpeg')
  assert.equal(mediaContentType('unknown.html'), 'application/octet-stream')
})

test('Express rejeita mutação cross-site e limita início OAuth, não apenas CORS', () => {
  const guard = rejectCrossSiteMutation(new Set(['https://screens.example.com']))
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const res = response(); let next = false
    guard({ method: 'POST', get: (key) => headers[key] }, res, () => { next = true })
    assert.equal(res.statusCode, 403); assert.equal(next, false)
  }
  let allowed = false
  guard({ method: 'POST', get: (key) => key === 'origin' ? 'https://screens.example.com' : undefined }, response(), () => { allowed = true })
  assert.equal(allowed, true)
  for (let index = 0; index < 31; index++) {
    const res = response(); googleLoginLimiter({ ip: 'test-address' }, res, () => {})
    assert.equal(res.statusCode, index < 30 ? 200 : 429)
  }
})

test('normaliza diagnóstico, limita métricas e só confirma solicitação real', () => {
  const input = { state: 'playing', version: '2', diagnostics: { checkedRequest: 'fake', capabilities: { video: true, mp4: 'probably', webm: '<script>', storage: 'local', xhr: true, json: true }, network: { samples: 200, averageMs: Infinity, lastMs: -1, failures: 1000, token: 'omit' }, media: { loadMs: null, stalls: 100000 }, power: { supported: true, active: true, method: '<script>', error: 'segredo' } } }
  const first = normalizePlaybackReport(input, undefined, '', sync, sync)
  assert.equal(first.diagnostics.checkedRequest, '')
  assert.equal(first.diagnostics.network.samples, 20); assert.equal(first.diagnostics.network.lastMs, 0)
  assert.equal(first.diagnostics.capabilities.webm, 'no'); assert.equal(first.diagnostics.network.token, undefined)
  assert.deepEqual(first.diagnostics.power, { supported: false, active: false, method: 'none', error: '' })
  input.diagnostics.checkedRequest = sync
  input.diagnostics.power = { supported: true, active: true, method: 'screen-wake-lock', error: '' }
  const second = normalizePlaybackReport(input, first, '', sync, sync)
  assert.equal(second.diagnostics.checkedRequest, sync)
  assert.deepEqual(second.diagnostics.power, { supported: true, active: true, method: 'screen-wake-lock', error: '' })
  assert.equal(shouldPersistPlayback(first, second, Date.parse(sync) + 15000), true)
  input.diagnostics.power.active = false
  const third = normalizePlaybackReport(input, second, '', sync, sync)
  assert.equal(shouldPersistPlayback(second, third, Date.parse(sync) + 15000), true)
})

test('service worker não intercepta APIs privadas nem pré-carrega URLs administrativas', async () => {
  const handlers = {}; const cached = []
  const self = { location: { origin: 'https://screens.example.com' }, addEventListener(name, fn) { handlers[name] = fn } }
  vm.runInNewContext(readFileSync(new URL('../../client/public/service-worker.js', import.meta.url), 'utf8'), { self, URL, Request, caches: { async open() { return { async add(request) { cached.push(request.url) } } } } })
  for (const path of ['/api/auth/me', '/api/tvs', '/api/users', '/api/player/TV-1/content']) {
    let intercepted = false
    handlers.fetch({ request: new Request(`https://screens.example.com${path}`), respondWith() { intercepted = true } })
    assert.equal(intercepted, false, path)
  }
  let done
  handlers.message({ data: { type: 'CACHE_MEDIA', urls: ['https://screens.example.com/api/users', 'https://screens.example.com/uploads/images/a.png'] }, waitUntil(promise) { done = promise } })
  await done
  assert.deepEqual(cached, ['https://screens.example.com/uploads/images/a.png'])
})
