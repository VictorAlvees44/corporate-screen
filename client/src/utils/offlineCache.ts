// Cache offline genérico baseado em localStorage, usado pelos widgets do
// player (clima, notícias, aniversários, ranking). Segue o mesmo princípio
// já usado para o conteúdo principal do player (TV/playlist/layout): guarda
// a última resposta bem-sucedida e reaproveita quando a rede falha, mesmo
// depois de a página ser recarregada com o dispositivo offline.
//
// É um cache "best-effort": funciona em conjunto com o Service Worker (que
// cacheia as respostas HTTP em si), mas fica no nível da aplicação para
// poder guardar metadados próprios (como a data de referência dos
// aniversariantes) e para não depender de o Service Worker estar ativo.

interface CachedEntry<T> {
  data: T
  cachedAt: number
}

export function cacheJSON<T>(key: string, data: T): void {
  try {
    const entry: CachedEntry<T> = { data, cachedAt: Date.now() }
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // localStorage indisponível ou cheio: cache é best-effort, não deve
    // interromper o fluxo normal do widget.
  }
}

export function readCachedJSON<T>(key: string): CachedEntry<T> | null {
  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as CachedEntry<T>
  } catch {
    return null
  }
}
