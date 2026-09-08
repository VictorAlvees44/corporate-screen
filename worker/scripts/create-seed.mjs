import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '../..')
const outputPath = path.resolve(process.argv[2] ?? path.join(projectRoot, '.codex-run/cloudflare-seed.sql'))
const configDir = path.join(projectRoot, 'server/config')
const files = [
  'birthdays.json',
  'layouts.json',
  'networkUsage.json',
  'news.json',
  'playlists.json',
  'rankings.json',
  'schedules.json',
  'settings.json',
  'tvs.json',
  'users.json',
]

// O importador remoto do D1 já executa o arquivo de forma atômica e rejeita
// BEGIN/COMMIT explícitos. Mantenha apenas as instruções idempotentes.
const statements = []
for (const fileName of files) {
  let value
  try {
    value = await readFile(path.join(configDir, fileName), 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
    throw error
  }

  // Recompacta e valida antes da migração; arquivos inválidos interrompem a
  // implantação em vez de enviarem dados quebrados para o D1.
  const compactJson = JSON.stringify(JSON.parse(value))
  const quotedName = fileName.replaceAll("'", "''")
  const quotedValue = compactJson.replaceAll("'", "''")
  statements.push(`INSERT INTO json_store (file_name, value, version, updated_at) VALUES ('${quotedName}', '${quotedValue}', 1, datetime('now')) ON CONFLICT(file_name) DO UPDATE SET value = excluded.value, version = json_store.version + 1, updated_at = excluded.updated_at;`)
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${statements.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
console.log(`Seed preparado em ${outputPath} (${files.length} arquivos previstos).`)
