import { mutateJSON, readJSON } from './jsonStore'
import { hasValidPlayerToken, PlayerRegistrationError } from '../utils/playerToken'
import type { TV } from '../types'

const FILE_NAME = 'tvs.json'
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000

export async function listTVs(): Promise<TV[]> {
  const stored = await readJSON<unknown>(FILE_NAME, [])
  // Protege a API contra um arquivo editado manualmente (ou restaurado) no
  // formato de objeto único em vez da lista esperada.
  const tvs = Array.isArray(stored) ? (stored as TV[]) : []
  return tvs.map(applyConnectionStatus)
}

export async function findTVById(id: string): Promise<TV | undefined> {
  const tvs = await listTVs()
  return tvs.find((tv) => tv.id === id)
}

/**
 * Localiza ou cria o cadastro inicial de um player na mesma operação
 * serializada. Duas tentativas próximas do mesmo navegador, portanto, não
 * conseguem criar duas TVs com o mesmo deviceId.
 */
export async function findOrCreatePlayerTV(
  deviceId: string,
  now: string,
  createToken: () => string,
  receivedToken?: string,
): Promise<{ tv: TV; created: boolean }> {
  let result: { tv: TV; created: boolean } | undefined

  await mutateJSON<TV[]>(FILE_NAME, [], (current) => {
    const existing = current.find((tv) => tv.deviceId === deviceId)

    if (existing) {
      if (!hasValidPlayerToken(receivedToken, existing.playerToken)) throw new PlayerRegistrationError(401, 'Dispositivo não autorizado. O identificador sozinho não permite recuperar o acesso.')
      const updated: TV = {
        ...existing,
        playerToken: existing.playerToken ?? createToken(),
        status: 'online',
        ultimaConexao: now,
      }
      result = { tv: updated, created: false }
      return current.map((tv) => (tv.id === updated.id ? updated : tv))
    }

    if (current.filter((tv) => tv.approvalStatus === 'pendente').length >= 100) throw new PlayerRegistrationError(429, 'Há muitos dispositivos aguardando aprovação. Revise o painel antes de cadastrar novas TVs.')
    const maxNumber = current.reduce((max, tv) => {
      const match = tv.id.match(/^TV-(\d+)$/)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const created: TV = {
      id: `TV-${String(maxNumber + 1).padStart(4, '0')}`,
      nome: 'Nova TV encontrada',
      local: '',
      setor: '',
      unidade: '',
      observacoes: 'Autocadastrada pelo player',
      status: 'online',
      ultimaConexao: now,
      playlistAtual: null,
      layoutAtual: null,
      cepClima: '',
      exibirRelogio: true,
      exibirNoticias: true,
      exibirClima: true,
      deviceId,
      playerToken: receivedToken && /^[a-zA-Z0-9_-]{32,160}$/.test(receivedToken) ? receivedToken : createToken(),
      approvalStatus: 'pendente',
    }
    result = { tv: created, created: true }
    return [...current, created]
  })

  return result!
}

export async function countIncompatibleTVs(): Promise<number> {
  return (await listTVs()).filter((tv) => tv.compatibilidade === 'incompativel').length
}


// Aplica somente os campos alterados sobre a versão mais recente. Um poll
// concorrente nunca pode restaurar uma playlist antiga ou recriar uma TV removida.
export async function patchTV(id: string, update: (current: TV) => TV): Promise<TV | undefined> {
  let result: TV | undefined
  await mutateJSON<TV[]>(FILE_NAME, [], (current) => {
    result = undefined
    return current.map((tv) => {
      if (tv.id !== id) return tv
      result = update(tv)
      return result
    })
  })
  return result
}

export async function deleteTV(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<TV[]>(FILE_NAME, [], (current) => {
    const next = current.filter((tv) => tv.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

function applyConnectionStatus(tv: TV): TV {
  const lastConnection = Date.parse(tv.ultimaConexao)

  if (Number.isNaN(lastConnection)) {
    return { ...tv, status: 'offline' }
  }

  const isOnline = Date.now() - lastConnection <= ONLINE_THRESHOLD_MS
  return { ...tv, status: isOnline ? 'online' : 'offline' }
}
