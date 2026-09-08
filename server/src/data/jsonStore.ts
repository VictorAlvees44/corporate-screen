import { promises as fs } from 'fs'
import path from 'path'
import { getJsonStoreAdapter } from '../runtime/jsonStoreAdapter'

// Raiz da pasta config/, onde vivem todos os arquivos JSON de persistência.
// process.cwd() é o projeto no serviço Windows e a pasta server nos scripts
// do workspace npm. Evitar import.meta.url também mantém este módulo portável
// no bundle do Cloudflare Worker.
const CONFIG_DIR = path.basename(process.cwd()).toLowerCase() === 'server'
  ? path.resolve(process.cwd(), 'config')
  : path.resolve(process.cwd(), 'server/config')

// Fila de escrita por arquivo, para evitar que duas requisições concorrentes
// corrompam o mesmo JSON escrevendo ao mesmo tempo.
const writeLocks = new Map<string, Promise<unknown>>()

function resolveConfigPath(fileName: string): string {
  return path.join(CONFIG_DIR, fileName)
}

/**
 * Lê e faz parse de um arquivo JSON dentro de config/.
 * Se o arquivo não existir, retorna o valor padrão informado (e não cria o arquivo sozinho).
 */
export async function readJSON<T>(fileName: string, defaultValue: T): Promise<T> {
  return readJSONFile(resolveConfigPath(fileName), defaultValue)
}

/**
 * Escreve um valor como JSON em config/, de forma serializada por arquivo
 * (garante que escritas concorrentes no mesmo arquivo não se sobreponham).
 */
export async function writeJSON<T>(fileName: string, value: T): Promise<void> {
  await enqueueWrite(fileName, async () => {
    await writeJSONFile(resolveConfigPath(fileName), value)
    return value
  })
}

/**
 * Lê, transforma e regrava um arquivo JSON como uma única operação atômica
 * (a leitura e a escrita ficam dentro da mesma fila do arquivo).
 *
 * Isso existe porque o padrão "ler lista inteira, alterar em memória, escrever
 * lista inteira de volta" (usado por upsert/delete em todos os repositórios)
 * tem uma janela de corrida se feito com `readJSON` + `writeJSON` separados:
 * duas requisições concorrentes podem ler o mesmo estado antigo e a segunda
 * escrita apaga o que a primeira tinha acabado de adicionar/remover. Isso é
 * especialmente sensível no cadastro de TVs, já que cada player atualiza seu
 * "último contato" a cada poll — com várias TVs ao mesmo tempo, esse é o
 * caminho com maior chance real de disparar a corrida.
 */
export async function mutateJSON<T>(
  fileName: string,
  defaultValue: T,
  mutate: (current: T) => T,
): Promise<T> {
  const adapter = getJsonStoreAdapter()
  if (adapter) {
    // D1 não expõe uma transação interativa entre SELECT e UPDATE. O CAS
    // otimista preserva a atomicidade com várias TVs atualizando ao mesmo
    // tempo: se outra requisição gravar primeiro, relê e tenta novamente.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const stored = await adapter.read(fileName)
      const current = stored ? JSON.parse(stored.value) as T : defaultValue
      const updated = mutate(current)
      const written = await adapter.writeIfVersion(
        fileName,
        JSON.stringify(updated),
        stored?.version ?? null,
      )
      if (written) return updated
    }

    throw new Error(`Não foi possível atualizar ${fileName} após várias tentativas concorrentes.`)
  }

  return enqueueWrite(fileName, async () => {
    const current = await readJSONFile(resolveConfigPath(fileName), defaultValue)
    const updated = mutate(current)
    await writeJSONFile(resolveConfigPath(fileName), updated)
    return updated
  })
}

function enqueueWrite<T>(fileName: string, task: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(fileName) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)

  // A fila guarda a promise "genérica" só para encadear a próxima operação;
  // o valor de retorno de `next` (tipado) é o que volta para quem chamou.
  writeLocks.set(fileName, next)
  return next
}

async function readJSONFile<T>(filePath: string, defaultValue: T): Promise<T> {
  const adapter = getJsonStoreAdapter()
  if (adapter) {
    const stored = await adapter.read(path.basename(filePath))
    return stored ? JSON.parse(stored.value) as T : defaultValue
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      return defaultValue
    }
    throw error
  }
}

async function writeJSONFile<T>(filePath: string, value: T): Promise<void> {
  const adapter = getJsonStoreAdapter()
  if (adapter) {
    await adapter.write(path.basename(filePath), JSON.stringify(value))
    return
  }

  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  await fs.rename(tmpPath, filePath)
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
