// Mantém o campo de resposta antigo para que players já abertos também
// recebam atualizações individuais, sem mudar o ciclo das outras TVs.
export function latestPlayerRefresh(global: string, individual?: string): string {
  const globalTime = Date.parse(global)
  const individualTime = Date.parse(individual ?? '')
  return Number.isFinite(individualTime) && (!Number.isFinite(globalTime) || individualTime > globalTime)
    ? individual! : global
}

// Samsung Browser 2013/2014 (Chromium 25) trava em preto quando o player
// tenta buscar um ponto avançado de um MP4. Mantemos a sincronização para
// imagens e para aparelhos atuais; nesse caso específico, vídeo começa do zero.
export function synchronizationForPlayer(enabled: boolean, userAgent: string, hasVideo: boolean): boolean {
  if (!enabled || !hasVideo || !/SMART-TV/i.test(userAgent)) return enabled
  const match = userAgent.match(/(?:Chromium|Chrome)\/(\d+)/i)
  return !(match && Number(match[1]) < 40)
}
