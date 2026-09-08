import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'

export type ExpressController = (req: ExpressRequest, res: ExpressResponse) => unknown | Promise<unknown>

export async function runController(
  controller: ExpressController,
  request: Request,
  params: Record<string, string> = {},
  body?: unknown,
  locals: Record<string, unknown> = {},
): Promise<Response> {
  const url = new URL(request.url)
  const response = new WorkerResponse(locals)
  const query = Object.fromEntries(url.searchParams)
  const expressRequest = {
    body,
    params,
    query,
    method: request.method,
    originalUrl: `${url.pathname}${url.search}`,
    path: url.pathname,
    protocol: 'https',
    secure: true,
    ip: request.headers.get('cf-connecting-ip') ?? '',
    socket: { remoteAddress: request.headers.get('cf-connecting-ip') ?? '' },
    header: (name: string) => request.headers.get(name) ?? undefined,
    get: (name: string) => request.headers.get(name) ?? undefined,
  } as unknown as ExpressRequest

  await controller(expressRequest, response as unknown as ExpressResponse)
  return response.toResponse()
}

class WorkerResponse {
  statusCode = 200
  readonly locals: Record<string, unknown>
  private readonly headers = new Headers()
  private body: BodyInit | null = null

  constructor(locals: Record<string, unknown>) {
    this.locals = locals
    this.headers.set('cache-control', 'no-store')
    this.headers.set('x-content-type-options', 'nosniff')
  }

  status(code: number): this {
    this.statusCode = code
    return this
  }

  json(value: unknown): this {
    this.headers.set('content-type', 'application/json; charset=utf-8')
    this.body = JSON.stringify(value ?? null)
    return this
  }

  send(value?: unknown): this {
    if (this.statusCode === 204 || value === undefined || value === null) {
      this.body = null
    } else if (typeof value === 'string' || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      this.body = value as BodyInit
    } else {
      this.headers.set('content-type', 'application/json; charset=utf-8')
      this.body = JSON.stringify(value)
    }
    return this
  }

  type(value: string): this {
    this.headers.set('content-type', value === 'html' ? 'text/html; charset=utf-8' : value)
    return this
  }

  redirect(statusOrUrl: number | string, maybeUrl?: string): this {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
    const location = typeof statusOrUrl === 'string' ? statusOrUrl : maybeUrl ?? '/'
    this.statusCode = status
    this.headers.set('location', location)
    this.body = null
    return this
  }

  cookie(name: string, value: string, options: Record<string, unknown> = {}): this {
    this.headers.append('set-cookie', serializeCookie(name, value, options))
    return this
  }

  clearCookie(name: string, options: Record<string, unknown> = {}): this {
    this.headers.append('set-cookie', serializeCookie(name, '', { ...options, maxAge: 0 }))
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    if (Array.isArray(value)) {
      this.headers.delete(name)
      value.forEach((item) => this.headers.append(name, item))
    } else {
      this.headers.set(name, String(value))
    }
    return this
  }

  toResponse(): Response {
    return new Response(this.statusCode === 204 ? null : this.body, {
      status: this.statusCode,
      headers: this.headers,
    })
  }
}

function serializeCookie(name: string, value: string, options: Record<string, unknown>): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`)
  if (typeof options.path === 'string') parts.push(`Path=${options.path}`)
  if (options.httpOnly === true) parts.push('HttpOnly')
  if (options.secure === true) parts.push('Secure')
  if (typeof options.sameSite === 'string') {
    const sameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1).toLowerCase()
    parts.push(`SameSite=${sameSite}`)
  }
  return parts.join('; ')
}
