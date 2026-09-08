import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(scriptDir, '../dist')

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return visit(fullPath)
      if (entry.isFile() && entry.name.endsWith('.js')) return fixFile(fullPath)
      return undefined
    }),
  )
}

async function fixFile(filePath) {
  const source = await readFile(filePath, 'utf8')
  const fixed = source.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (_match, start, specifier, end) => {
    return /\.(?:js|json|node)$/.test(specifier) ? `${start}${specifier}${end}` : `${start}${specifier}.js${end}`
  })

  if (fixed !== source) await writeFile(filePath, fixed)
}

await visit(distDir)
