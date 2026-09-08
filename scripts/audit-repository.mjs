// Auditoria somente leitura. Nunca imprime valores encontrados, só categoria e caminho.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 })
const objects = git('rev-list', '--objects', '--all').trim().split('\n')
const rules = [
  ['google-secret', /GOCSPX-[A-Za-z0-9_-]{15,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['cloudflare-tunnel-token', /eyJ[a-zA-Z0-9_-]{120,}\.[a-zA-Z0-9_-]+/],
  ['runtime-config', /"(?:playerToken|tokenHash|client_secret)"\s*:\s*"[^"\s]{15,}"/],
  ['password-assignment', /(?:ADMIN_PASSWORD\s*=|\$AdminPassword\s*=)\s*['"]?[^\s'";]{12,}/],
]
const findings = []
let blobs = 0
for (const line of objects) {
  const [oid, ...parts] = line.split(' ')
  const file = parts.join(' ')
  if (!file) continue
  if (git('cat-file', '-t', oid).trim() !== 'blob') continue
  if (Number(git('cat-file', '-s', oid)) > 2_000_000) continue
  blobs += 1
  const content = git('cat-file', 'blob', oid)
  for (const [category, pattern] of rules) if (pattern.test(content)) findings.push({ category, file, object: oid.slice(0, 12) })
}
const currentFiles = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
let currentFilesScanned = 0
for (const file of new Set(currentFiles)) {
  try {
    if (statSync(file).size > 2_000_000) continue
    const content = readFileSync(file, 'utf8'); currentFilesScanned += 1
    for (const [category, pattern] of rules) if (pattern.test(content)) findings.push({ category, file, object: 'working-tree' })
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
console.log(JSON.stringify({ scope: 'reachable Git history and non-ignored working tree, files up to 2 MB; heuristic scan, not proof of absence', commits: Number(git('rev-list', '--all', '--count')), blobs, currentFilesScanned, findings }, null, 2))
