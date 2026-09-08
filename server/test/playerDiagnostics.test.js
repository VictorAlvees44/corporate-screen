import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../../client/public/player-diagnostics.js', import.meta.url), 'utf8')
const legacy = readFileSync(new URL('../../client/public/player-legacy.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]

test('diagnóstico e player legado continuam compilando para ES5', () => {
  assert.doesNotThrow(() => transformSync(source, { target: 'es5' }))
  assert.doesNotThrow(() => transformSync(legacy, { target: 'es5' }))
})

test('player mantém a tela acordada somente durante a exibição e readquire ao voltar', async () => {
  const documentListeners = new Map()
  let requests = 0
  let releases = 0
  const document = {
    hidden: false,
    addEventListener(name, fn) { documentListeners.set(name, fn) },
    createElement() { return { play() {}, canPlayType() { return '' } } },
  }
  const window = {
    document,
    location: { pathname: '/' },
    navigator: { wakeLock: { request() { requests += 1; return Promise.resolve({ release() { releases += 1; return Promise.resolve() }, addEventListener() {} }) } } },
    localStorage: { setItem() {}, getItem() { return '1' }, removeItem() {} },
    addEventListener() {},
    setTimeout(fn) { fn(); return 1 },
    setInterval() { return 1 },
    clearInterval() {},
    JSON,
  }
  vm.runInNewContext(source, { window, Date, Promise, Boolean, Error })
  window.CorporateScreenPower.setDesired(true)
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual({ ...window.CorporateScreenPower.snapshot() }, { supported: true, active: true, method: 'screen-wake-lock', error: '' })
  assert.equal(requests, 1)
  document.hidden = true; documentListeners.get('visibilitychange')()
  assert.equal(releases, 1); assert.equal(window.CorporateScreenPower.snapshot().active, false)
  document.hidden = false; documentListeners.get('visibilitychange')()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(requests, 2); assert.equal(window.CorporateScreenPower.snapshot().active, true)
  window.CorporateScreenPower.setDesired(false)
  assert.equal(releases, 2); assert.equal(window.CorporateScreenPower.snapshot().active, false)
})

test('player legado usa o controle de protetor do Tizen quando disponível', () => {
  const values = []
  const appcommon = {
    AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
    setScreenSaver(value, success) { values.push(value); success() },
  }
  const document = { hidden: false, addEventListener() {}, createElement() { return { play() {}, canPlayType() { return '' } } } }
  const window = { document, location: { pathname: '/player-legacy' }, navigator: {}, webapis: { appcommon }, localStorage: { setItem() {}, getItem() { return '1' }, removeItem() {} }, addEventListener() {}, setInterval() { return 1 }, clearInterval() {}, JSON }
  vm.runInNewContext(source, { window, Date, Boolean, Error })
  window.CorporateScreenPower.setDesired(true)
  assert.deepEqual(values, [0]); assert.equal(window.CorporateScreenPower.snapshot().active, true)
  window.CorporateScreenPower.setDesired(false)
  assert.deepEqual(values, [0, 1]); assert.equal(window.CorporateScreenPower.snapshot().active, false)
})
function setup() {
  let time = 100000
  let nextId = 0
  const timers = new Map()
  const window = { setInterval(fn) { const id = ++nextId; timers.set(id, fn); return id }, clearInterval(id) { timers.delete(id) } }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])) } }
  vm.runInNewContext(source, { window, Date: Clock })
  return { diagnostics: window.CorporateScreenDiagnostics.create(), advance(ms) { time += ms; for (const fn of timers.values()) fn() }, timers }
}
function element(properties = {}) {
  const listeners = new Map()
  return { currentTime: 0, ended: false, complete: false, play() {}, ...properties,
    addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) }, emit(name) { listeners.get(name)?.() } }
}
const item = { id: '1', tipo: 'imagem', arquivo: 'https://example.com/foto.jpg?private=secret', tempoExibicao: 10 }
const content = { playlist: { id: 'p', itens: [item] }, atualizacaoPlayersEm: 'sync-1' }

test('recebimento só é confirmado após resposta online; cache não confirma novo comando', () => {
  const { diagnostics: d } = setup()
  assert.equal(d.snapshot().receivedSync, '')
  d.content(content, true, false)
  assert.equal(d.snapshot().receivedSync, 'sync-1')
  assert.equal(d.snapshot().state, 'loading')
  d.content({ ...content, atualizacaoPlayersEm: 'sync-2' }, true, true)
  assert.equal(d.snapshot().receivedSync, 'sync-1')
})

test('imagem carregada confirma reprodução; erro transitório fica no histórico sem query string', () => {
  const { diagnostics: d, timers } = setup()
  const img = element()
  const stop = d.watch(img, item)
  img.emit('error')
  assert.equal(d.snapshot().errorCode, 'IMAGE_LOAD')
  assert.equal(d.snapshot().lastError.mediaName, 'foto.jpg')
  img.emit('load')
  assert.equal(d.snapshot().state, 'playing')
  assert.equal(d.snapshot().errorCode, '')
  assert.equal(d.snapshot().lastError.code, 'IMAGE_LOAD')
  stop(); assert.equal(timers.size, 0)
  img.emit('error'); assert.equal(d.snapshot().state, 'playing')
})

test('imagem em cache e timeout de carregamento são detectados', () => {
  const { diagnostics: d, advance } = setup()
  const stop = d.watch(element({ complete: true, naturalWidth: 100 }), item)
  assert.equal(d.snapshot().state, 'playing'); stop()
  d.watch(element(), item); advance(9000)
  assert.equal(d.snapshot().errorCode, 'MEDIA_TIMEOUT')
})

test('vídeo incompatível, bloqueio de autoplay e travamento têm códigos específicos', async () => {
  const { diagnostics: d, advance } = setup()
  const video = element({ error: { code: 3 } })
  const stop = d.watch(video, { ...item, tipo: 'video' })
  video.emit('error'); assert.equal(d.snapshot().errorCode, 'VIDEO_DECODE')
  video.emit('playing'); advance(30000)
  assert.equal(d.snapshot().errorCode, 'VIDEO_STALLED')
  video.currentTime = 2; video.emit('timeupdate')
  assert.equal(d.snapshot().state, 'playing'); stop()
  const blocked = element({ play() { return Promise.reject({ name: 'NotAllowedError' }) } })
  d.watch(blocked, { ...item, tipo: 'video' }); await Promise.resolve()
  assert.equal(d.snapshot().errorCode, 'AUTOPLAY_BLOCKED')
})

test('iframe não é tratado como reprodução comprovada, nem standby como falha', () => {
  const { diagnostics: d } = setup()
  const frame = element(); const stop = d.watch(frame, { ...item, tipo: 'link' })
  frame.emit('load'); assert.equal(d.snapshot().state, 'external'); stop()
  d.content({ ...content, dentroHorarioOperacional: false }, true, false)
  assert.equal(d.snapshot().state, 'standby')
  d.content({ ...content, playlist: null }, true, false)
  assert.equal(d.snapshot().state, 'empty')
})

test('diagnóstico individual usa últimas 20 consultas, mede mídia e confirma apenas online', () => {
  const { diagnostics: d, advance } = setup()
  for (let i = 0; i < 25; i++) d.requestSample(120, 200)
  d.requestSample(12000, 0)
  assert.equal(d.snapshot().diagnostics.network.samples, 20)
  assert.equal(d.snapshot().diagnostics.network.averageMs, 120)
  assert.equal(d.snapshot().diagnostics.network.networkFailures, 1)
  d.requestSample(500, 503)
  assert.equal(d.snapshot().diagnostics.network.failures, 2)
  assert.equal(d.snapshot().diagnostics.network.networkFailures, 1)
  d.content({ ...content, tv: { diagnosticoSolicitadoEm: 'request-1' } }, false, true)
  assert.equal(d.snapshot().diagnostics.checkedRequest, '')
  d.content({ ...content, tv: { diagnosticoSolicitadoEm: 'request-1' } }, false, false)
  assert.equal(d.snapshot().diagnostics.checkedRequest, 'request-1')
  const img = element(); d.watch(img, item); advance(1200); img.emit('load')
  assert.equal(d.snapshot().diagnostics.media.loadMs, 1200)
})

test('TV sem API de vídeo recebe erro específico mas ainda pode mostrar imagens', () => {
  const { diagnostics: d } = setup()
  const stop = d.watch(element({ play: undefined }), { ...item, tipo: 'video' })
  assert.equal(d.snapshot().errorCode, 'VIDEO_UNSUPPORTED'); stop()
  const img = element(); d.watch(img, item); img.emit('load')
  assert.equal(d.snapshot().state, 'playing')
})

test('diagnóstico funciona com attachEvent de navegadores legados', () => {
  const { diagnostics: d } = setup()
  const callbacks = new Map()
  const img = { attachEvent(name, fn) { callbacks.set(name, fn) }, detachEvent(name) { callbacks.delete(name) } }
  const stop = d.watch(img, item)
  callbacks.get('onload')()
  assert.equal(d.snapshot().state, 'playing')
  stop(); assert.equal(callbacks.size, 0)
})

test('rede recuperada não deixa o estado de erro preso numa imagem estática', () => {
  const { diagnostics: d } = setup()
  d.content(content, true, false)
  d.watch(element({ complete: true, naturalWidth: 100 }), item)
  d.network(); assert.equal(d.snapshot().offline, true)
  d.content(content, false, false)
  assert.equal(d.snapshot().state, 'playing')
  assert.equal(d.snapshot().offline, false)
  assert.equal(d.snapshot().lastError.code, 'CONTENT_FETCH')
})

test('player legado retoma a mesma playlist após erro de rede e confirma o comando', () => {
  const intervals = []
  const snapshots = []
  let failed = false
  function node(tag = 'DIV') {
    const result = { ...element(), tagName: tag.toUpperCase(), children: [], style: {}, setAttribute() {}, appendChild(child) { this.children.push(child); child.parentNode = this }, removeChild(child) { this.children = this.children.filter((value) => value !== child); child.parentNode = null } }
    let html = ''
    Object.defineProperty(result, 'innerHTML', { get() { return html }, set(value) { html = value; this.children = [] } })
    return result
  }
  const screen = node()
  const storage = new Map()
  const data = { ...content, tv: { exibirRelogio: false, exibirNoticias: false, exibirClima: false } }
  class XHR {
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader() {}
    send(body) {
      const value = body ? JSON.parse(body) : null
      let response = {}
      this.status = 200
      if (this.url.endsWith('/register')) response = { id: 'LOCAL', playerToken: 'test' }
      if (this.url.endsWith('/content')) { snapshots.push(value.playback); response = data; if (failed) this.status = 503 }
      this.readyState = 4; this.responseText = JSON.stringify(response); this.onreadystatechange()
    }
  }
  const window = { JSON, XMLHttpRequest: XHR, localStorage: { getItem(k) { return storage.get(k) }, setItem(k, v) { storage.set(k, v) } }, addEventListener() {}, setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length }, clearInterval() {}, setTimeout() { return 1 }, clearTimeout() {} }
  const document = { getElementById() { return screen }, createElement: node, documentElement: {}, addEventListener() {} }
  const context = vm.createContext({ window, document, navigator: { userAgent: 'TV QA' } })
  vm.runInContext(source, context); vm.runInContext(legacy, context)
  assert.equal(screen.children[0].tagName, 'IMG')
  screen.children[0].emit('load')
  const poll = intervals.find((entry) => entry.delay === 15000).fn
  poll()
  assert.equal(snapshots.at(-1).state, 'playing')
  assert.equal(snapshots.at(-1).receivedSync, 'sync-1')
  failed = true; poll(); assert.match(screen.innerHTML, /Sem conexão/)
  failed = false; poll(); assert.equal(screen.children[0].tagName, 'IMG')
  screen.children[0].emit('load'); poll()
  assert.equal(snapshots.at(-1).state, 'playing')
  assert.equal(snapshots.at(-1).lastError.code, 'CONTENT_FETCH')
})
