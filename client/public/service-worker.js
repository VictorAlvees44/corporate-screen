const STATIC_CACHE = 'corporate-screen-static-v8'
// Descarta respostas antigas que podiam conter MIME não normalizado.
const MEDIA_CACHE = 'corporate-screen-media-v5'
const WIDGET_CACHE = 'corporate-screen-widgets-v2'
// A raiz é o único endereço que uma TV precisa guardar. Rotas administrativas
// não entram no pré-cache para não manter uma cópia desnecessária do painel.
const STATIC_ASSETS = ['/', '/favicon.svg', '/icons.svg', '/player-diagnostics.js?v=2026-09-11.1']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('corporate-screen-') && ![STATIC_CACHE, MEDIA_CACHE, WIDGET_CACHE].includes(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_MEDIA') {
    return
  }

  const urls = Array.isArray(event.data.urls) ? event.data.urls : []

  event.waitUntil(
    caches.open(MEDIA_CACHE).then((cache) =>
      Promise.allSettled(
        urls
          .filter((url) => {
            if (typeof url !== 'string' || !url) return false
            try { const parsed = new URL(url, self.location.origin); return parsed.origin === self.location.origin && parsed.pathname.startsWith('/uploads/') } catch { return false }
          })
          .map((url) => cache.add(new Request(url, { mode: 'no-cors' }))),
      ),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  // Sessões e dados administrativos nunca entram no cache offline. O cookie
  // expirado/revogado deve ser conferido no servidor em todas as consultas.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/') && !isWidgetRequest(url)) return

  if (isMediaRequest(url, request)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (isWidgetRequest(url)) {
    event.respondWith(networkFirst(request, WIDGET_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE))
    return
  }

  event.respondWith(networkFirst(request, STATIC_CACHE))
})

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  const response = await fetch(request)

  // Só guarda em cache respostas válidas. Uma resposta de erro (404, 500...)
  // nunca deve ficar presa no cache, senão o mesmo arquivo fica "quebrado"
  // para sempre, mesmo depois de o problema no servidor ser corrigido.
  // Requisições no-cors (cross-origin) retornam status "opaque" (0) e são
  // aceitas aqui, pois não é possível inspecionar seu status real.
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(MEDIA_CACHE)
    cache.put(request, response.clone())
  }

  return response
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)

    if (response.ok && !/no-store|private/i.test(response.headers.get('cache-control') || '')) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }

    return response
  } catch {
    const cachedResponse = await caches.match(request)

    if (cachedResponse) {
      return cachedResponse
    }

    throw new Error('Sem conexão e sem cache disponível')
  }
}

function isMediaRequest(url, request) {
  if (url.pathname.startsWith('/uploads/')) {
    return true
  }

  return ['image', 'video'].includes(request.destination)
}

// Endpoints públicos consumidos pelos widgets do player (clima, notícias,
// aniversários, ranking). Ficam num cache próprio (WIDGET_CACHE) em vez de
// dividir o STATIC_CACHE com páginas/HTML, então podem ser versionados e
// limpos de forma independente.
function isWidgetRequest(url) {
  return url.pathname.startsWith('/api/widgets/')
}
