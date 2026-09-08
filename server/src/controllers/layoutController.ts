import type { Request, Response } from 'express'
import { InputValidationError } from '../utils/publicError'
import {
  deleteLayout,
  findLayoutById,
  generateNextLayoutId,
  listLayouts,
  upsertLayout,
} from '../data/layoutRepository'
import type { Layout, LayoutComponent, LayoutComponentType } from '../types'
import { safeContentUrl } from '../utils/contentSecurity'

interface LayoutBody {
  nome?: string
  componentes?: Partial<LayoutComponent>[]
}

const COMPONENT_TYPES: LayoutComponentType[] = [
  'texto',
  'imagem',
  'video',
  'relogio',
  'logo',
  'dashboard',
  'pagina-web',
  'qrcode',
  'clima',
  'noticias',
  'aniversarios',
  'ranking',
  'indicadores',
  'calendario',
  'html',
]

export async function getLayouts(_req: Request, res: Response) {
  res.json(await listLayouts())
}

export async function getLayoutById(req: Request, res: Response) {
  const layout = await findLayoutById(req.params.id)

  if (!layout) {
    return res.status(404).json({ message: 'Layout não encontrado' })
  }

  res.json(layout)
}

export async function createLayout(req: Request, res: Response) {
  const id = await generateNextLayoutId()
  const layout = normalizeLayout(id, req.body as LayoutBody)

  await upsertLayout(layout)
  res.status(201).json(layout)
}

export async function updateLayout(req: Request, res: Response) {
  const existing = await findLayoutById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'Layout não encontrado' })
  }

  const layout = normalizeLayout(existing.id, req.body as LayoutBody)
  await upsertLayout(layout)
  res.json(layout)
}

export async function removeLayout(req: Request, res: Response) {
  const removed = await deleteLayout(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'Layout não encontrado' })
  }

  res.status(204).send()
}

function normalizeLayout(id: string, body: LayoutBody): Layout {
  const nome = body.nome?.trim()

  if (!nome) {
    throw new InputValidationError('Informe o nome do layout')
  }

  return {
    id,
    nome,
    componentes: (body.componentes ?? []).map(normalizeComponent),
  }
}

function normalizeComponent(component: Partial<LayoutComponent>, index: number): LayoutComponent {
  const content = component.conteudo?.trim() ?? ''
  return {
    id: component.id?.trim() || `component-${index + 1}`,
    tipo: normalizeComponentType(component.tipo),
    x: normalizeNumber(component.x, 40),
    y: normalizeNumber(component.y, 40),
    largura: normalizeNumber(component.largura, 300),
    altura: normalizeNumber(component.altura, 160),
    visivel: component.visivel ?? true,
    conteudo: ['imagem', 'logo', 'video', 'dashboard', 'pagina-web'].includes(component.tipo ?? '') ? safeContentUrl(content) : content,
    atualizarSegundos:
      Number.isFinite(component.atualizarSegundos) && Number(component.atualizarSegundos) > 0
        ? Number(component.atualizarSegundos)
        : undefined,
    permitirTelaCheia: Boolean(component.permitirTelaCheia),
  }
}

function normalizeComponentType(tipo: LayoutComponentType | undefined): LayoutComponentType {
  return tipo && COMPONENT_TYPES.includes(tipo) ? tipo : 'texto'
}

function normalizeNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Number(value))
}
