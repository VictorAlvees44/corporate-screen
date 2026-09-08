import type { Request, Response } from 'express'
import {
  listTVs,
  findTVById,
  patchTV,
  deleteTV,
} from '../data/tvRepository'
import { deleteSchedulesForTV } from '../data/scheduleRepository'
import type { TV } from '../types'

function toAdminTV(tv: TV): Omit<TV, 'playerToken' | 'deviceId'> {
  const { playerToken: _playerToken, deviceId: _deviceId, ...safeTV } = tv
  return safeTV
}

interface TVBody {
  nome?: string
  local?: string
  setor?: string
  unidade?: string
  observacoes?: string
  playlistAtual?: string | null
  layoutAtual?: string | null
  cepClima?: string
  exibirRelogio?: boolean
  exibirNoticias?: boolean
  exibirClima?: boolean
}

export async function getTVs(_req: Request, res: Response) {
  const tvs = await listTVs()
  res.json(tvs.map(toAdminTV))
}

export async function requestTVDiagnostic(req: Request, res: Response) {
  const tv = await patchTV(req.params.id, (current) => ({ ...current, diagnosticoSolicitadoEm: new Date().toISOString() }))
  if (!tv) return res.status(404).json({ message: 'TV não encontrada' })
  res.json(toAdminTV(tv))
}

export async function refreshTVHandler(req: Request, res: Response) {
  const tv = await patchTV(req.params.id, (current) => ({ ...current, atualizacaoSolicitadaEm: new Date().toISOString() }))
  if (!tv) return res.status(404).json({ message: 'TV não encontrada' })
  return res.json(toAdminTV(tv))
}

export async function getTVById(req: Request, res: Response) {
  const tv = await findTVById(req.params.id)

  if (!tv) {
    return res.status(404).json({ message: 'TV não encontrada' })
  }

  res.json(toAdminTV(tv))
}

export async function createTV(_req: Request, res: Response) {
  // Mantém resposta clara para painéis antigos, sem criar registros sem token.
  return res.status(410).json({ message: 'Abra o sistema na própria TV e aprove o cadastro descoberto automaticamente.' })
}

export async function approveTV(req: Request, res: Response) {
  const existing = await findTVById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'TV não encontrada' })

  const updated = await patchTV(existing.id, (current) => ({ ...current, approvalStatus: 'aprovada' }))
  if (!updated) return res.status(404).json({ message: 'TV não encontrada' })
  res.json(toAdminTV(updated))
}

export async function updateTV(req: Request, res: Response) {
  const existing = await findTVById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'TV não encontrada' })
  }

  const body = req.body as TVBody

  // Só os campos abaixo podem ser editados pelo admin — em especial, isso
  // evita que o corpo da requisição sobrescreva `status`/`ultimaConexao`
  // (controlados pelo próprio player) ou injete campos desconhecidos no
  // registro salvo em disco.
  const updated = await patchTV(existing.id, (current) => ({
    ...current,
    nome: body.nome?.trim() || existing.nome,
    local: body.local?.trim() ?? existing.local,
    setor: body.setor?.trim() ?? existing.setor,
    unidade: body.unidade?.trim() ?? existing.unidade,
    observacoes: body.observacoes?.trim() ?? existing.observacoes,
    playlistAtual: body.playlistAtual !== undefined ? body.playlistAtual : existing.playlistAtual,
    layoutAtual: body.layoutAtual !== undefined ? body.layoutAtual : existing.layoutAtual,
    cepClima: body.cepClima !== undefined ? normalizeCep(body.cepClima) : existing.cepClima,
    exibirRelogio: body.exibirRelogio !== undefined ? body.exibirRelogio !== false : existing.exibirRelogio !== false,
    exibirNoticias: body.exibirNoticias !== undefined ? body.exibirNoticias !== false : existing.exibirNoticias !== false,
    exibirClima: body.exibirClima !== undefined ? body.exibirClima !== false : existing.exibirClima !== false,
  }))
  if (!updated) return res.status(404).json({ message: 'TV não encontrada' })
  res.json(toAdminTV(updated))
}

function normalizeCep(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 8)
}

export async function removeTV(req: Request, res: Response) {
  const removed = await deleteTV(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'TV não encontrada' })
  }

  await deleteSchedulesForTV(req.params.id)
  res.status(204).send()
}
