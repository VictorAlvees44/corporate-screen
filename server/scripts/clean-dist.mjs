import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

// O TypeScript não remove JavaScript gerado para arquivos-fonte que foram
// apagados. Limpar a saída antes de compilar evita que código obsoleto fique
// disponível no servidor de produção após uma atualização.
await rm(path.resolve(scriptDir, '../dist'), { recursive: true, force: true })
