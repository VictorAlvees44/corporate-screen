import type { Request, Response } from 'express'
import { getSettings, saveSettings } from '../data/settingsRepository'
import type { OperationMode } from '../types'

interface SettingsBody {
  modoOperacao?: OperationMode
  limiteCadastroAtivo?: boolean
  sincronizacaoImagensAtiva?: boolean
}

export async function getSettingsHandler(_req: Request, res: Response) {
  res.json(await getSettings())
}

export async function updateSettingsHandler(req: Request, res: Response) {
  const body = req.body as SettingsBody
  const settings = await saveSettings({
    modoOperacao: body.modoOperacao,
    limiteCadastroAtivo: body.limiteCadastroAtivo,
    sincronizacaoImagensAtiva: body.sincronizacaoImagensAtiva,
  })

  res.json(settings)
}

export async function refreshPlayersHandler(_req: Request, res: Response) {
  const now = new Date().toISOString()
  const settings = await saveSettings({
    atualizacaoPlayersEm: now,
    sincronizacaoImagensAtiva: true,
    cicloSincronizadoEm: now,
  })
  res.json({
    atualizacaoPlayersEm: settings.atualizacaoPlayersEm,
    sincronizacaoImagensAtiva: settings.sincronizacaoImagensAtiva,
    cicloSincronizadoEm: settings.cicloSincronizadoEm,
  })
}
