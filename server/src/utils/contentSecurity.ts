import { isIP } from 'net'
import { InputValidationError, PayloadTooLargeError } from './publicError'

export function safeContentUrl(value: string): string {
  const url = value.trim()
  if (!url) return ''
  if (/^\/uploads\/(images|videos|documents|logos)\/[a-zA-Z0-9._-]+$/.test(url)) return url
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new InputValidationError('Use uma URL HTTP(S) válida ou um arquivo da biblioteca.') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /[\u0000-\u001f]/.test(url)) throw new InputValidationError('Protocolo ou credenciais não permitidos na URL do conteúdo.')
  return parsed.toString()
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 0 || b === 168) || a === 198 && (b === 18 || b === 19)
  }
  // Somente unicast global IPv6; rejeita mapeados IPv4, loopback, link-local,
  // multicast e mecanismos de transição que podem alcançar IPv4 privado.
  if (isIP(address) !== 6) return true
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const first = parseInt(normalized.split(':')[0], 16)
  return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff || normalized.startsWith('2002:')
    || normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0:') || normalized.startsWith('2001::')
}

export async function readLimitedBody(response: Pick<Response, 'headers' | 'body'>, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new PayloadTooLargeError('Conteúdo excede o limite permitido') }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel(); throw new PayloadTooLargeError('Conteúdo excede o limite permitido') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
