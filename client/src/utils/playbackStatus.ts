import type { TV } from '../types'

export function latestRefresh(global: string, individual?: string): string {
  const globalTime = Date.parse(global)
  const individualTime = Date.parse(individual ?? '')
  return Number.isFinite(individualTime) && (!Number.isFinite(globalTime) || individualTime > globalTime) ? individual! : global
}

export function hasReceivedRefresh(received: string | undefined, requested: string): boolean {
  return Boolean(requested && received && Date.parse(received) >= Date.parse(requested))
}

export const PLAYBACK_ERRORS: Record<string, string> = {
  VIDEO_UNSUPPORTED: 'Este navegador não tem suporte a vídeo HTML5 e não consegue transmitir vídeos. Use imagens ou um navegador/dispositivo compatível.',
  PLAYER_UNAUTHORIZED: 'O token deste dispositivo foi recusado. Verifique o cadastro com o administrador; não é um diagnóstico de falha de internet.',
  IMAGE_LOAD: 'A imagem não carregou. Verifique se o arquivo existe e se o formato é aceito pela TV.',
  VIDEO_NETWORK: 'O vídeo falhou durante o download. Verifique a conexão da TV e o arquivo.',
  VIDEO_DECODE: 'A TV não conseguiu decodificar o vídeo. Converta para um formato compatível com o aparelho, como MP4/H.264.',
  VIDEO_FORMAT: 'O navegador não conseguiu abrir o vídeo. O formato ou codec pode não ser suportado, ou o arquivo pode estar indisponível.',
  MEDIA_ABORTED: 'O navegador interrompeu o carregamento da mídia.',
  MEDIA_LOAD: 'Falha ao carregar a mídia. Verifique o arquivo e a conexão da TV.',
  MEDIA_TIMEOUT: 'A mídia não iniciou dentro do tempo disponível para exibição. Verifique o arquivo, seu tamanho e a conexão.',
  VIDEO_STALLED: 'O vídeo ficou 30 segundos sem avançar. Verifique a conexão e recarregue o player se persistir.',
  AUTOPLAY_BLOCKED: 'O navegador bloqueou o início automático do vídeo. Interaja com a TV ou libere a reprodução automática nas configurações.',
  FRAME_LOAD: 'Falha ao abrir o conteúdo incorporado. O site pode impedir a exibição em outra página.',
  PLAYER_RUNTIME: 'O navegador informou um erro de execução do player. Recarregue a página; se persistir, verifique a compatibilidade do navegador.',
  CONTENT_FETCH: 'A TV não conseguiu consultar a programação. Pode haver falha de rede ou indisponibilidade da API; o player tentará novamente.',
}

export function playbackIsFresh(tv: TV, now = Date.now()): boolean {
  const contact = Date.parse(tv.ultimaConexao)
  const report = Date.parse(tv.reproducao?.reportedAt ?? '')
  return now - contact <= 120_000 && now - report <= 120_000
}

export function playbackSummary(tv: TV, now = Date.now()): { label: string; detail: string; problem: boolean } {
  if (now - Date.parse(tv.ultimaConexao) > 120_000 || tv.status === 'offline') return { label: 'Sem comunicação', detail: 'Sem contato há mais de 2 minutos. Não é possível distinguir TV desligada, navegador fechado ou falta de internet.', problem: true }
  if (tv.compatibilidade === 'incompativel') return { label: 'Navegador incompatível', detail: tv.alertaCompatibilidade || 'Verifique a compatibilidade do navegador desta TV.', problem: true }
  if (tv.approvalStatus === 'pendente') return { label: 'Aguardando aprovação', detail: 'Aprove esta TV para liberar a reprodução.', problem: false }
  const report = tv.reproducao
  if (!report) return { label: 'Reprodução não confirmada', detail: 'O player ainda não enviou diagnósticos. Recarregue a página na TV para carregar esta atualização.', problem: true }
  if (!playbackIsFresh(tv, now)) return { label: 'Diagnóstico desatualizado', detail: 'Há contato com a TV, mas não há um relatório recente de reprodução. Recarregue o player.', problem: true }
  if (report.offline) return { label: 'Falha de conexão informada', detail: PLAYBACK_ERRORS.CONTENT_FETCH, problem: true }
  if (report.state === 'error') return { label: 'Erro de reprodução', detail: PLAYBACK_ERRORS[report.errorCode] || 'O player informou uma falha de reprodução.', problem: true }
  const states = {
    loading: ['Carregando mídia', 'O início da reprodução ainda não foi confirmado.'],
    playing: ['Reprodução informada', 'Imagem carregada ou vídeo em reprodução, conforme o último relatório do player.'],
    layout: ['Layout aberto', 'O player abriu o layout. Isso não confirma o conteúdo de todos os widgets.'],
    external: ['Conteúdo externo', 'A reprodução dentro de sites incorporados não pode ser confirmada pelo navegador.'],
    empty: ['Sem conteúdo', 'Nenhuma mídia ou layout disponível. Selecione uma playlist com arquivos para esta TV.'],
    standby: ['Em espera programada', 'Fora do horário de exibição ou em modo de pausa. Não é uma falha.'],
    pending: ['Aguardando aprovação', 'Aprove o dispositivo no painel administrativo.'],
  }
  const [label, detail] = states[report.state]
  return { label, detail, problem: report.state === 'empty' }
}
