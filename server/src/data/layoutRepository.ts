import { mutateJSON, readJSON } from './jsonStore'
import type { Layout } from '../types'

const FILE_NAME = 'layouts.json'

export async function listLayouts(): Promise<Layout[]> {
  return readJSON<Layout[]>(FILE_NAME, [])
}

export async function findLayoutById(id: string): Promise<Layout | undefined> {
  const layouts = await listLayouts()
  return layouts.find((layout) => layout.id === id)
}

export async function upsertLayout(layout: Layout): Promise<Layout> {
  await mutateJSON<Layout[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === layout.id)

    if (index >= 0) {
      const next = [...current]
      next[index] = layout
      return next
    }

    return [...current, layout]
  })

  return layout
}

export async function deleteLayout(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<Layout[]>(FILE_NAME, [], (current) => {
    const next = current.filter((layout) => layout.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

export async function generateNextLayoutId(): Promise<string> {
  const layouts = await listLayouts()

  const maxNumber = layouts.reduce((max, layout) => {
    const match = layout.id.match(/^layout-(\d+)$/)
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)

  return `layout-${String(maxNumber + 1).padStart(3, '0')}`
}
