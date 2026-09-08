import type { OperationMode, Weekday } from '../types'

// Fuso horário explícito da operação. Antes, os cálculos de horário usavam
// `new Date().getHours()/getDay()` diretamente, que depende do fuso horário
// implícito do processo Node (o do sistema operacional/host). Isso funciona
// hoje porque o servidor roda no Brasil, mas quebra silenciosamente se o
// processo algum dia rodar em outro fuso (outra máquina, nuvem, container com
// TZ=UTC): a janela de operação e os agendamentos passariam a ser calculados
// na hora errada, sem nenhum erro visível. Centralizamos aqui usando
// `Intl.DateTimeFormat` com timeZone fixo, independente do fuso do host.
export const OPERATIONAL_TIMEZONE = 'America/Sao_Paulo'

const WEEKDAYS: Weekday[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export interface OperationalMoment {
  weekday: Weekday
  minutesOfDay: number
}

/**
 * Converte um instante (por padrão, agora) para dia da semana e minutos
 * desde a meia-noite, sempre no fuso horário `America/Sao_Paulo`.
 */
export function getOperationalMoment(date: Date = new Date()): OperationalMoment {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: OPERATIONAL_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)
  const weekdayPart = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun'
  const hourPart = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minutePart = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')

  const weekdayIndex = WEEKDAY_TO_INDEX[weekdayPart] ?? date.getDay()

  return {
    weekday: WEEKDAYS[weekdayIndex],
    minutesOfDay: hourPart * 60 + minutePart,
  }
}

export interface OperationalWindowState {
  dentroHorarioOperacional: boolean
  standbyReason: string | null
}

const BUSINESS_DAYS: Weekday[] = ['seg', 'ter', 'qua', 'qui', 'sex']
const WINDOW_START_MINUTES = 7 * 60 + 30 // 07:30
const WINDOW_END_MINUTES = 18 * 60 // 18:00

/**
 * Estado da janela operacional fixa (segunda a sexta, 07:30–18:00), levando
 * em conta o modo operacional global (`normal`, `ferias`, `feriado`).
 * Usada tanto pelo servidor (com `new Date()`) quanto, do lado do cliente,
 * com o horário local do próprio navegador quando o player está offline.
 */
export function getFixedOperationalWindowState(
  modoOperacao: OperationMode,
  moment: OperationalMoment = getOperationalMoment(),
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

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  return hours * 60 + minutes
}

/**
 * Verifica se um agendamento (dias da semana + faixa de horário, com suporte
 * a faixas que cruzam a meia-noite) está ativo no instante informado, sempre
 * calculado no fuso `America/Sao_Paulo`.
 */
export function isScheduleActiveAt(
  diasSemana: Weekday[],
  horaInicio: string,
  horaFim: string,
  moment: OperationalMoment = getOperationalMoment(),
): boolean {
  const start = parseTimeToMinutes(horaInicio)
  const end = parseTimeToMinutes(horaFim)
  if (start === null || end === null) return false

  if (start <= end) {
    return diasSemana.includes(moment.weekday)
      && moment.minutesOfDay >= start
      && moment.minutesOfDay <= end
  }

  if (moment.minutesOfDay >= start) return diasSemana.includes(moment.weekday)

  // Em uma faixa que cruza a meia-noite, a madrugada pertence ao dia em que
  // a faixa começou. Ex.: segunda 22:00–02:00 continua ativa terça às 01:00.
  const weekdayIndex = WEEKDAYS.indexOf(moment.weekday)
  const previousWeekday = WEEKDAYS[(weekdayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length]
  return moment.minutesOfDay <= end && diasSemana.includes(previousWeekday)
}
