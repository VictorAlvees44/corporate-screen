import type { OperationMode, Schedule, Weekday } from '../types'

// Equivalente, do lado do cliente, a `server/src/utils/operationalSchedule.ts`.
//
// Quando o player está offline, ele reaplica o último conteúdo salvo em
// cache — inclusive o campo `dentroHorarioOperacional`, que foi calculado
// pelo servidor enquanto o player ainda estava online. Sem recalcular isso
// localmente, uma TV que fica offline durante o horário comercial continua
// exibindo a playlist normalmente até a noite ou o fim de semana, em vez de
// entrar em stand by.
//
// Aqui usamos o horário local do próprio navegador (não um fuso fixo como no
// servidor): o player já roda fisicamente no local de exibição, então o
// relógio do sistema/navegador é a melhor fonte disponível quando não há
// como consultar o servidor.

const WEEKDAYS: Weekday[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
const BUSINESS_DAYS: Weekday[] = ['seg', 'ter', 'qua', 'qui', 'sex']
const WINDOW_START_MINUTES = 7 * 60 + 30 // 07:30
const WINDOW_END_MINUTES = 18 * 60 // 18:00

export interface OperationalMoment {
  weekday: Weekday
  minutesOfDay: number
}

export function getLocalOperationalMoment(date: Date = new Date()): OperationalMoment {
  return {
    weekday: WEEKDAYS[date.getDay()],
    minutesOfDay: date.getHours() * 60 + date.getMinutes(),
  }
}

export interface OperationalWindowState {
  dentroHorarioOperacional: boolean
  standbyReason: string | null
}

export function getFixedOperationalWindowState(
  modoOperacao: OperationMode,
  moment: OperationalMoment = getLocalOperationalMoment(),
): OperationalWindowState {
  if (modoOperacao === 'ferias') {
    return { dentroHorarioOperacional: false, standbyReason: 'Modo férias ativo' }
  }

  if (modoOperacao === 'feriado') {
    return { dentroHorarioOperacional: false, standbyReason: 'Modo feriado ativo' }
  }

  if (!BUSINESS_DAYS.includes(moment.weekday)) {
    return { dentroHorarioOperacional: false, standbyReason: 'Fora dos dias de operação' }
  }

  if (moment.minutesOfDay < WINDOW_START_MINUTES || moment.minutesOfDay > WINDOW_END_MINUTES) {
    return { dentroHorarioOperacional: false, standbyReason: 'Fora do horário de operação' }
  }

  return { dentroHorarioOperacional: true, standbyReason: null }
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  return hours * 60 + minutes
}

function isScheduleActiveAt(schedule: Schedule, moment: OperationalMoment): boolean {
  if (!schedule.diasSemana.includes(moment.weekday)) return false

  const start = parseTimeToMinutes(schedule.horaInicio)
  const end = parseTimeToMinutes(schedule.horaFim)
  if (start === null || end === null) return false

  if (start <= end) {
    return moment.minutesOfDay >= start && moment.minutesOfDay <= end
  }

  return moment.minutesOfDay >= start || moment.minutesOfDay <= end
}

/**
 * Recalcula, com o horário local do navegador, se o conteúdo em cache ainda
 * deveria estar no ar. Deve ser chamada sempre que o player aplicar conteúdo
 * vindo do cache offline (nunca confiar no `dentroHorarioOperacional`
 * congelado da última resposta bem-sucedida da API).
 *
 * Se o agendamento que estava ativo no momento do cache não estiver mais
 * ativo agora, o retorno não usa mais esse agendamento (ele só volta a valer
 * quando o player reconectar e consultar a API de novo).
 */
export function recomputeOfflineOperationalState(
  modoOperacao: OperationMode,
  cachedSchedule: Schedule | null,
): OperationalWindowState & { schedule: Schedule | null } {
  const moment = getLocalOperationalMoment()
  const windowState = getFixedOperationalWindowState(modoOperacao, moment)

  if (!windowState.dentroHorarioOperacional) {
    return { ...windowState, schedule: null }
  }

  const schedule = cachedSchedule && isScheduleActiveAt(cachedSchedule, moment) ? cachedSchedule : null

  return { ...windowState, schedule }
}
