import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { InputValidationError } from '../utils/publicError'

// Middleware central de erros. Qualquer erro não tratado nas rotas cai aqui,
// garantindo uma resposta JSON consistente em vez de o processo quebrar.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof InputValidationError) return res.status(400).json({ message: err.message })
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') return res.status(413).json({ message: 'Requisição acima do limite permitido' })
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido' })
  console.error('[erro]', err)

  if (err instanceof multer.MulterError) {
    const fileTooLarge = err.code === 'LIMIT_FILE_SIZE'
    return res.status(fileTooLarge ? 413 : 400).json({
      message: fileTooLarge
        ? 'Arquivo maior que o limite permitido pelo servidor'
        : 'Upload inválido ou acima da quantidade permitida',
    })
  }

  // Detalhes técnicos pertencem ao log do servidor. Devolvê-los ao navegador
  // exporia caminhos locais e outras informações úteis a um atacante.
  res.status(500).json({ message: 'Erro interno do servidor' })
}

// Wrapper para rotas assíncronas, evitando repetir try/catch em cada controller.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
