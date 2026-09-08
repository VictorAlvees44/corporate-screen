import type { NextFunction, Request, Response } from 'express'
import { appendFile, mkdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIT_LOG_PATH = path.resolve(__dirname, '../../logs/audit.jsonl')

export function auditLogger(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const user = res.locals.authenticatedUser as string | undefined

    // Registra apenas alterações administrativas concluídas com sucesso. O
    // player e os GETs são muito frequentes e não pertencem à auditoria.
    if (!user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || res.statusCode >= 400) return

    const entry = JSON.stringify({
      at: new Date().toISOString(),
      user,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
    })

    void mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
      .then(() => appendFile(AUDIT_LOG_PATH, `${entry}\n`, 'utf8'))
      .catch((error: unknown) => console.error('[auditoria] Falha ao registrar alteração', error))
  })

  next()
}
