// Helpers para lidar com links do YouTube colados pelo usuário no admin.
// Aceita os formatos mais comuns: watch?v=, youtu.be/, /embed/ e /shorts/.

const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

export function extractYoutubeId(url: string): string | null {
  const match = url.trim().match(YOUTUBE_ID_PATTERN)
  return match ? match[1] : null
}

export function buildYoutubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0`
}

export function buildYoutubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
}

export function getYoutubeIdFromEmbedUrl(embedUrl: string): string | null {
  const match = embedUrl.match(/\/embed\/([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}
