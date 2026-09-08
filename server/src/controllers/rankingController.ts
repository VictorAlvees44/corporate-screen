import type { Request, Response } from 'express'
import { InputValidationError } from '../utils/publicError'
import multer from 'multer'
import {
  deleteRanking,
  findRankingById,
  generateNextRankingId,
  listRankings,
  updateRankingItems,
  upsertRanking,
} from '../data/rankingRepository'
import type { Ranking, RankingItem } from '../types'

interface RankingBody {
  nome?: string
  itens?: Partial<RankingItem>[]
}

export async function getRankings(_req: Request, res: Response) {
  res.json(await listRankings())
}

export async function getRankingById(req: Request, res: Response) {
  const ranking = await findRankingById(req.params.id)

  if (!ranking) {
    return res.status(404).json({ message: 'Ranking não encontrado' })
  }

  res.json(ranking)
}

export async function createRanking(req: Request, res: Response) {
  const id = await generateNextRankingId()
  const ranking = normalizeRanking(id, req.body as RankingBody)

  await upsertRanking(ranking)
  res.status(201).json(ranking)
}

export async function updateRanking(req: Request, res: Response) {
  const existing = await findRankingById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'Ranking não encontrado' })
  }

  const ranking = normalizeRanking(existing.id, req.body as RankingBody)
  await upsertRanking(ranking)
  res.json(ranking)
}

export async function removeRanking(req: Request, res: Response) {
  const removed = await deleteRanking(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'Ranking não encontrado' })
  }

  res.status(204).send()
}

// Importação de CSV (colunas: posicao,nome,valor — com ou sem cabeçalho).
// Mantido em memória (sem salvar o arquivo em disco): o CSV só serve para
// popular os itens do ranking, que passam a viver em rankings.json.
export const importRankingMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('file')

export async function importRanking(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo CSV não enviado' })
  }

  const itens = parseRankingCSV(new TextDecoder().decode(req.file.buffer))

  if (itens.length === 0) {
    return res.status(400).json({ message: 'Não foi possível ler linhas válidas do CSV' })
  }

  const ranking = await updateRankingItems(req.params.id, (current) => ({
    ...current,
    itens,
    atualizadoEm: new Date().toISOString(),
  }))

  if (!ranking) {
    return res.status(404).json({ message: 'Ranking não encontrado' })
  }

  res.json(ranking)
}

function parseRankingCSV(content: string): RankingItem[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const items: RankingItem[] = []

  lines.forEach((line, index) => {
    const columns = line.split(/[,;]/).map((column) => column.trim())

    // Pula a primeira linha se for cabeçalho (ex.: "posicao,nome,valor").
    if (index === 0 && Number.isNaN(Number(columns[0]))) {
      return
    }

    if (columns.length < 2) {
      return
    }

    const [posicaoRaw, nomeRaw, valorRaw] = columns
    const posicao = Number(posicaoRaw)
    const nome = nomeRaw?.trim()

    if (!nome) {
      return
    }

    items.push({
      posicao: Number.isFinite(posicao) ? posicao : items.length + 1,
      nome,
      valor: valorRaw?.trim() ?? '',
    })
  })

  return items.sort((first, second) => first.posicao - second.posicao)
}

function normalizeRanking(id: string, body: RankingBody): Ranking {
  const nome = body.nome?.trim()

  if (!nome) {
    throw new InputValidationError('Informe o nome do ranking')
  }

  const itens = (body.itens ?? [])
    .map((item, index) => normalizeRankingItem(item, index))
    .filter((item): item is RankingItem => item !== null)

  return { id, nome, itens, atualizadoEm: new Date().toISOString() }
}

function normalizeRankingItem(item: Partial<RankingItem>, index: number): RankingItem | null {
  const nome = item.nome?.trim()

  if (!nome) {
    return null
  }

  return {
    posicao: Number.isFinite(item.posicao) ? Number(item.posicao) : index + 1,
    nome,
    valor: item.valor?.trim() ?? '',
  }
}
