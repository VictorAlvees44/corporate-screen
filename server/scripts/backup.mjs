import { cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(scriptDir, '..')
const targetRoot = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(serverDir, '../backups')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const target = path.join(targetRoot, `corporate-screen-${stamp}`)
const partialTarget = `${target}.partial`

// Retenção: por padrão mantemos os 14 backups mais recentes (~2 semanas se a
// tarefa agendada rodar 1x/dia). Sem isso, cada backup completo de
// config+uploads fica no disco para sempre e o volume só cresce. Pode ser
// ajustado com a variável de ambiente BACKUP_RETENTION_COUNT.
const retentionCount = Number.parseInt(process.env.BACKUP_RETENTION_COUNT ?? '', 10) || 14

await rm(partialTarget, { recursive: true, force: true })

try {
  await mkdir(partialTarget, { recursive: true })
  await cp(path.join(serverDir, 'config'), path.join(partialTarget, 'config'), { recursive: true })
  await cp(path.join(serverDir, 'uploads'), path.join(partialTarget, 'uploads'), { recursive: true, force: true })

  const [sourceStats, backupStats] = await Promise.all([
    treeStats([path.join(serverDir, 'config'), path.join(serverDir, 'uploads')]),
    treeStats([path.join(partialTarget, 'config'), path.join(partialTarget, 'uploads')]),
  ])

  if (sourceStats.files !== backupStats.files || sourceStats.bytes !== backupStats.bytes) {
    throw new Error(`Validação do backup falhou: origem ${sourceStats.files}/${sourceStats.bytes}, cópia ${backupStats.files}/${backupStats.bytes}`)
  }

  await writeFile(
    path.join(partialTarget, 'backup-manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), ...backupStats }, null, 2)}\n`,
    'utf-8',
  )
  await rename(partialTarget, target)
  console.log(`Backup validado e criado em ${target} (${backupStats.files} arquivos, ${backupStats.bytes} bytes).`)
} catch (error) {
  await rm(partialTarget, { recursive: true, force: true })
  throw error
}

await pruneOldBackups(targetRoot, retentionCount)

async function pruneOldBackups(root, keep) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }

  const backupDirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('corporate-screen-'))

  if (backupDirs.length <= keep) {
    return
  }

  const withStats = await Promise.all(
    backupDirs.map(async (entry) => {
      const fullPath = path.join(root, entry.name)
      const info = await stat(fullPath)
      return { fullPath, mtimeMs: info.mtimeMs }
    }),
  )

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const toRemove = withStats.slice(keep)

  for (const entry of toRemove) {
    await rm(entry.fullPath, { recursive: true, force: true })
    console.log(`Backup antigo removido: ${entry.fullPath}`)
  }
}

async function treeStats(roots) {
  const result = { files: 0, bytes: 0 }
  for (const root of roots) await addDirectoryStats(root, result)
  return result
}

async function addDirectoryStats(directory, result) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await addDirectoryStats(fullPath, result)
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(fullPath)
    result.files += 1
    result.bytes += info.size
  }
}
