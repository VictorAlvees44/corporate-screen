import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { hasValidPlayerToken, PlayerRegistrationError } from '../utils/playerToken'
import { findLayoutById } from '../data/layoutRepository'
import { findPlaylistById } from '../data/playlistRepository'
import { getSettings } from '../data/settingsRepository'
import { findActiveScheduleForTV } from '../data/scheduleRepository'
import { findOrCreatePlayerTV, findTVById, patchTV } from '../data/tvRepository'
import { normalizePlaybackReport, shouldPersistPlayback } from '../utils/playerTelemetry'
import { latestPlayerRefresh, synchronizationForPlayer } from '../utils/playerCommands'
import { getFixedOperationalWindowState } from '../utils/operationalSchedule'
import type { TV } from '../types'

interface RegisterPlayerBody {
  tvId?: string
  playerToken?: string
  deviceId?: string
}

interface CompatibilityBody {
  compatible?: boolean
  browser?: string
  reason?: string
}

type PlayerRegistrationResponse = Omit<TV, 'playerToken'> & { playerToken: string }

export async function registerPlayer(req: Request, res: Response) {
  const { tvId, playerToken, deviceId } = (req.body ?? {}) as RegisterPlayerBody
  if ((tvId !== undefined && typeof tvId !== 'string') || (playerToken !== undefined && typeof playerToken !== 'string')) return res.status(400).json({ message: 'Cadastro inválido' })
  const now = new Date().toISOString()

  if (tvId) {
    const existingTV = await findTVById(tvId)

    if (existingTV) {
      // Não há migração pública por ID: cadastros sem segredo devem passar
      // novamente pela descoberta/aprovação, nunca ser assumidos por terceiros.
      if (!hasValidPlayerToken(playerToken, existingTV.playerToken)) {
        return res.status(401).json({ message: 'Dispositivo não autorizado' })
      }

      const nextPlayerToken = existingTV.playerToken ?? randomUUID()
      const saved = await patchTV(existingTV.id, (current) => ({ ...current, deviceId: current.deviceId ?? deviceId, playerToken: nextPlayerToken, status: 'online', ultimaConexao: now }))
      if (!saved) return res.status(404).json({ message: 'TV não encontrada' })
      return res.json(toRegistrationResponse(saved))
    }
  }

  // Identificador persistente criado pelo player antes da primeira chamada.
  // Ele torna o cadastro idempotente: o mesmo navegador sempre recebe o
  // mesmo registro, até que alguém o remova no painel administrativo.
  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ message: 'Identificação do dispositivo inválida. Reabra o player para gerar um novo cadastro.' })
  }

  try {
    const registration = await findOrCreatePlayerTV(deviceId, now, randomUUID, playerToken)
    return res.status(registration.created ? 201 : 200).json(toRegistrationResponse(registration.tv))
  } catch (error) {
    if (error instanceof PlayerRegistrationError) return res.status(error.statusCode).json({ message: error.message })
    throw error
  }
}

export async function getPlayerContent(req: Request, res: Response) {
  const existingTV = await findTVById(req.params.tvId)

  if (!existingTV) {
    return res.status(404).json({ message: 'TV não encontrada' })
  }

  if (!hasValidPlayerToken(req.header('x-player-token'), existingTV.playerToken)) {
    return res.status(401).json({ message: 'Dispositivo não autorizado' })
  }

  // O player consulta a cada 15 segundos, mas uma presença a cada 45 segundos
  // ainda fica bem abaixo do limite offline de 2 minutos. Isso reduz em cerca
  // de 66% as gravações D1 sem atrasar o painel operacional.
  const now = new Date()
  const settings = await getSettings()
  const report = normalizePlaybackReport(req.body?.playback, existingTV.reproducao, latestPlayerRefresh(settings.atualizacaoPlayersEm, existingTV.atualizacaoSolicitadaEm), now.toISOString(), existingTV.diagnosticoSolicitadoEm)
  const saveReport = report && shouldPersistPlayback(existingTV.reproducao, report, now.getTime())
  const lastConnection = Date.parse(existingTV.ultimaConexao)
  const shouldPersistHeartbeat = existingTV.status !== 'online'
    || Number.isNaN(lastConnection)
    || now.getTime() - lastConnection >= 45_000
  const tv = shouldPersistHeartbeat || saveReport
    ? await patchTV(existingTV.id, (current) => {
      const latest = normalizePlaybackReport(req.body?.playback, current.reproducao, latestPlayerRefresh(settings.atualizacaoPlayersEm, current.atualizacaoSolicitadaEm), now.toISOString(), current.diagnosticoSolicitadoEm)
      return {
        ...current, status: 'online', ultimaConexao: now.toISOString(),
        ...(latest && shouldPersistPlayback(current.reproducao, latest, now.getTime()) ? { reproducao: latest } : {}),
      }
    })
    : existingTV
  if (!tv) return res.status(404).json({ message: 'TV não encontrada' })
  const scheduleState = getFixedOperationalWindowState(settings.modoOperacao)
  const safeTV = toPlayerContentTV(tv)
  const requestedRefresh = latestPlayerRefresh(settings.atualizacaoPlayersEm, tv.atualizacaoSolicitadaEm)

  if (tv.approvalStatus === 'pendente') {
    return res.json({
      tv: safeTV,
      playlist: null,
      layout: null,
      schedule: null,
      modoOperacao: settings.modoOperacao,
      dentroHorarioOperacional: true,
      standbyReason: null,
      pendenteAprovacao: true,
      atualizacaoPlayersEm: requestedRefresh,
      sincronizacaoImagensAtiva: settings.sincronizacaoImagensAtiva,
      cicloSincronizadoEm: settings.cicloSincronizadoEm,
      horarioServidor: new Date().toISOString(),
    })
  }

  if (!scheduleState.dentroHorarioOperacional) {
    return res.json({
      tv: safeTV,
      playlist: null,
      layout: null,
      schedule: null,
      modoOperacao: settings.modoOperacao,
      dentroHorarioOperacional: false,
      standbyReason: scheduleState.standbyReason,
      pendenteAprovacao: false,
      atualizacaoPlayersEm: requestedRefresh,
      sincronizacaoImagensAtiva: settings.sincronizacaoImagensAtiva,
      cicloSincronizadoEm: settings.cicloSincronizadoEm,
      horarioServidor: new Date().toISOString(),
    })
  }

  const schedule = await findActiveScheduleForTV(tv.id)
  const playlistId = schedule?.playlistId ?? tv.playlistAtual
  const playlist = playlistId ? await findPlaylistById(playlistId) : null
  const layout = tv.layoutAtual ? await findLayoutById(tv.layoutAtual) : null
  const userAgent = typeof req.get === 'function' ? req.get('user-agent') ?? '' : ''
  const synchronizedPlayback = synchronizationForPlayer(
    settings.sincronizacaoImagensAtiva,
    userAgent,
    Boolean(playlist?.itens.some((item) => item.tipo === 'video')),
  )

  res.json({
    tv: safeTV,
    playlist: playlist ?? null,
    layout: layout ?? null,
    schedule,
    modoOperacao: settings.modoOperacao,
    dentroHorarioOperacional: true,
    standbyReason: null,
    pendenteAprovacao: false,
    atualizacaoPlayersEm: requestedRefresh,
    sincronizacaoImagensAtiva: synchronizedPlayback,
    cicloSincronizadoEm: settings.cicloSincronizadoEm,
    horarioServidor: new Date().toISOString(),
  })
}

export async function reportPlayerCompatibility(req: Request, res: Response) {
  const tv = await findTVById(req.params.tvId)
  if (!tv) return res.status(404).json({ message: 'TV não encontrada' })

  if (!hasValidPlayerToken(req.header('x-player-token'), tv.playerToken)) {
    return res.status(401).json({ message: 'Dispositivo não autorizado' })
  }

  const body = req.body as CompatibilityBody
  const compatible = body.compatible !== false
  const updated: TV = {
    ...tv,
    compatibilidade: compatible ? 'compativel' : 'incompativel',
    navegador: String(body.browser ?? '').slice(0, 120),
    alertaCompatibilidade: compatible ? undefined : String(body.reason ?? 'Navegador incompatível').slice(0, 240),
  }

  await patchTV(tv.id, (current) => ({ ...current, compatibilidade: updated.compatibilidade, navegador: updated.navegador, alertaCompatibilidade: updated.alertaCompatibilidade }))
  res.status(204).send()
}

function toRegistrationResponse(tv: TV): PlayerRegistrationResponse {
  const { playerToken, ...safeTV } = tv
  // Mantém os campos da TV no nível principal da resposta para que players
  // que já estavam abertos antes da inclusão do token continuem lendo `id`.
  // A versão atual usa o mesmo objeto e lê também `playerToken`.
  return { ...safeTV, playerToken: playerToken! }
}

function toPlayerContentTV(tv: TV): Omit<TV, 'playerToken' | 'deviceId'> {
  // O token é entregue apenas no cadastro inicial e fica guardado pelo
  // navegador da TV. As consultas seguintes já o apresentam no cabeçalho;
  // não há motivo para devolvê-lo novamente junto com o conteúdo.
  const { playerToken: _playerToken, deviceId: _deviceId, ...safeTV } = tv
  return safeTV
}

function isValidDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === 'string' && /^[a-zA-Z0-9_-]{16,160}$/.test(deviceId)
}
