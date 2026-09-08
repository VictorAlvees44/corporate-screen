const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.apng': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.heic': 'image/heic',
  '.heif': 'image/heif', '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.jxl': 'image/jxl',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.3gp': 'video/3gpp', '.pdf': 'application/pdf',
}
export function mediaExtension(name: string): string { return name.slice(name.lastIndexOf('.')).toLowerCase() }
export function mediaContentType(name: string): string { return TYPES[mediaExtension(name)] ?? 'application/octet-stream' }
export function isAllowedMediaFile(name: string, mimeType: string): boolean {
  const expected = TYPES[mediaExtension(name)]
  const mime = mimeType.split(';')[0].trim().toLowerCase()
  return Boolean(expected && (!mime || mime === 'application/octet-stream' || mime === expected
    || expected === 'image/jpeg' && mime === 'image/jpg'
    || expected === 'image/x-icon' && mime === 'image/vnd.microsoft.icon'))
}
export function hasMediaSignature(name: string, bytes: Uint8Array): boolean {
  const extension = mediaExtension(name)
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  const matches = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
  if (['.jpg', '.jpeg', '.jfif'].includes(extension)) return matches(255, 216, 255)
  if (['.png', '.apng'].includes(extension)) return matches(137, 80, 78, 71, 13, 10, 26, 10)
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6))
  if (extension === '.pdf') return text(0, 5) === '%PDF-'
  if (extension === '.webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
  if (extension === '.avi') return text(0, 4) === 'RIFF' && text(8, 12) === 'AVI '
  if (extension === '.bmp') return text(0, 2) === 'BM'
  if (extension === '.ico') return matches(0, 0, 1, 0)
  if (['.tif', '.tiff'].includes(extension)) return matches(73, 73, 42, 0) || matches(77, 77, 0, 42)
  if (['.webm', '.mkv'].includes(extension)) return matches(26, 69, 223, 163)
  if (extension === '.ogv') return text(0, 4) === 'OggS'
  if (['.mpg', '.mpeg'].includes(extension)) return matches(0, 0, 1, 186) || matches(0, 0, 1, 179)
  if (extension === '.jxl') return matches(255, 10) || matches(0, 0, 0, 12, 74, 88, 76, 32)
  if (['.mp4', '.m4v', '.mov', '.3gp', '.avif', '.heic', '.heif'].includes(extension)) return text(4, 8) === 'ftyp' || extension === '.mov' && ['moov', 'mdat', 'wide'].includes(text(4, 8))
  return false
}
