import { mutateJSON, readJSON } from './jsonStore'

const FILE_NAME = 'networkUsage.json'

interface MonthBucket {
  rxBytes: number
  txBytes: number
}

interface NetworkUsageStore {
  // Última leitura cumulativa (desde o boot da máquina) usada para calcular
  // quanto foi consumido desde a amostra anterior. Contadores de rede do
  // sistema operacional zeram a cada reinicialização da máquina, então
  // guardamos aqui a última leitura conhecida para não contar tudo de novo
  // (ou ficar negativo) quando o servidor reinicia.
  baseline: { rxBytes: number; txBytes: number } | null
  // Uma chave por mês ("2026-07"), com o total acumulado naquele mês.
  months: Record<string, MonthBucket>
}

const EMPTY_STORE: NetworkUsageStore = { baseline: null, months: {} }

export function currentMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Registra o consumo desde a última amostra, tratando corretamente o caso de
 * a máquina ter reiniciado (contador do sistema operacional voltou a zero ou
 * ficou menor que o esperado).
 */
export async function recordNetworkSample(totalRxBytes: number, totalTxBytes: number): Promise<void> {
  const monthKey = currentMonthKey()

  await mutateJSON<NetworkUsageStore>(FILE_NAME, EMPTY_STORE, (store) => {
    const baseline = store.baseline

    let deltaRx = 0
    let deltaTx = 0

    if (baseline && totalRxBytes >= baseline.rxBytes && totalTxBytes >= baseline.txBytes) {
      deltaRx = totalRxBytes - baseline.rxBytes
      deltaTx = totalTxBytes - baseline.txBytes
    }
    // Se não há baseline ainda, ou os contadores "voltaram" (reinício da
    // máquina/interface), não somamos nada nesta amostra — só atualizamos o
    // baseline, e o próximo intervalo já mede a partir daqui corretamente.

    const currentMonth = store.months[monthKey] ?? { rxBytes: 0, txBytes: 0 }

    return {
      baseline: { rxBytes: totalRxBytes, txBytes: totalTxBytes },
      months: {
        ...store.months,
        [monthKey]: {
          rxBytes: currentMonth.rxBytes + deltaRx,
          txBytes: currentMonth.txBytes + deltaTx,
        },
      },
    }
  })
}

export async function getCurrentMonthUsage(): Promise<MonthBucket> {
  const store = await readJSON<NetworkUsageStore>(FILE_NAME, EMPTY_STORE)
  return store.months[currentMonthKey()] ?? { rxBytes: 0, txBytes: 0 }
}
