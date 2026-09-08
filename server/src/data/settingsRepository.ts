import { readJSON, writeJSON } from './jsonStore'
import type { OperationMode, SystemSettings } from '../types'

const FILE_NAME = 'settings.json'

const DEFAULT_SETTINGS: SystemSettings = {
  tema: 'dark',
  empresa: 'Corporate Screen',
  logoPadrao: '/favicon.svg',
  modoOperacao: 'normal',
  limiteCadastroAtivo: true,
  atualizacaoPlayersEm: '',
  sincronizacaoImagensAtiva: false,
  cicloSincronizadoEm: '',
}

export async function getSettings(): Promise<SystemSettings> {
  const settings = await readJSON<Partial<SystemSettings>>(FILE_NAME, DEFAULT_SETTINGS)

  return {
    tema: settings.tema?.trim() || DEFAULT_SETTINGS.tema,
    empresa: settings.empresa?.trim() || DEFAULT_SETTINGS.empresa,
    logoPadrao: settings.logoPadrao?.trim() || DEFAULT_SETTINGS.logoPadrao,
    modoOperacao: normalizeOperationMode(settings.modoOperacao),
    limiteCadastroAtivo: settings.limiteCadastroAtivo === true,
    atualizacaoPlayersEm: typeof settings.atualizacaoPlayersEm === 'string' ? settings.atualizacaoPlayersEm : '',
    sincronizacaoImagensAtiva: settings.sincronizacaoImagensAtiva === true,
    cicloSincronizadoEm: typeof settings.cicloSincronizadoEm === 'string' ? settings.cicloSincronizadoEm : '',
  }
}

export async function saveSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await getSettings()
  const next: SystemSettings = {
    ...current,
    ...settings,
    modoOperacao: normalizeOperationMode(settings.modoOperacao),
    limiteCadastroAtivo: settings.limiteCadastroAtivo ?? current.limiteCadastroAtivo,
    atualizacaoPlayersEm: settings.atualizacaoPlayersEm ?? current.atualizacaoPlayersEm,
    sincronizacaoImagensAtiva: settings.sincronizacaoImagensAtiva ?? current.sincronizacaoImagensAtiva,
    cicloSincronizadoEm: settings.cicloSincronizadoEm ?? current.cicloSincronizadoEm,
  }

  await writeJSON(FILE_NAME, next)
  return next
}

function normalizeOperationMode(value: unknown): OperationMode {
  return value === 'ferias' || value === 'feriado' ? value : 'normal'
}
