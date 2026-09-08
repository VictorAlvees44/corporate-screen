import { mutateJSON, readJSON } from './jsonStore'
import type { Ranking } from '../types'

const FILE_NAME = 'rankings.json'

export async function listRankings(): Promise<Ranking[]> {
  return readJSON<Ranking[]>(FILE_NAME, [])
}

export async function findRankingById(id: string): Promise<Ranking | undefined> {
  const rankings = await listRankings()
  return rankings.find((ranking) => ranking.id === id)
}

export async function upsertRanking(ranking: Ranking): Promise<Ranking> {
  await mutateJSON<Ranking[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === ranking.id)

    if (index >= 0) {
      const next = [...current]
      next[index] = ranking
      return next
    }

    return [...current, ranking]
  })

  return ranking
}

// Usado pela importação de CSV: em vez de ler o ranking (fora da fila),
// aplicar a mudança e escrever de novo (o que poderia perder uma edição de
// nome feita bem no meio desse intervalo), o find-e-substitui acontece
// dentro da própria operação atômica.
export async function updateRankingItems(
  id: string,
  updater: (ranking: Ranking) => Ranking,
): Promise<Ranking | null> {
  let updated: Ranking | null = null

  await mutateJSON<Ranking[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === id)

    if (index < 0) {
      return current
    }

    updated = updater(current[index])
    const next = [...current]
    next[index] = updated
    return next
  })

  return updated
}

export async function deleteRanking(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<Ranking[]>(FILE_NAME, [], (current) => {
    const next = current.filter((ranking) => ranking.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

export async function generateNextRankingId(): Promise<string> {
  const rankings = await listRankings()

  const maxNumber = rankings.reduce((max, ranking) => {
    const match = ranking.id.match(/^ranking-(\d+)$/)
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)

  return `ranking-${String(maxNumber + 1).padStart(3, '0')}`
}
