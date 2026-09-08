import type { PlayerContentResponse, PlayerPlaybackStatus, PlaylistItem } from '../types'

export interface PlayerDiagnostics {
  snapshot(): Omit<PlayerPlaybackStatus, 'reportedAt'>
  content(data: PlayerContentResponse, changed: boolean, offline: boolean): void
  network(): void
  requestSample(ms: number, httpStatus: number): void
  fail(code: string, mediaName?: string): void
  watch(element: HTMLMediaElement | HTMLImageElement | HTMLIFrameElement, item: PlaylistItem): () => void
}

declare global {
  interface Window {
    CorporateScreenDiagnostics: { create(): PlayerDiagnostics; capabilities(): import('../types').TVDiagnostics['capabilities'] }
    CorporateScreenPower?: {
      setDesired(desired: boolean): void
      request(): void
      snapshot(): import('../types').TVDiagnostics['power']
    }
  }
}
