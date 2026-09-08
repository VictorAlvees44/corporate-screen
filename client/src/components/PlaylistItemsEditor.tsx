import { useRef, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { PlaylistItem, PlaylistItemType, UploadedMediaFile } from '../types'
import { buildYoutubeEmbedUrl, buildYoutubeThumbnailUrl, extractYoutubeId } from '../utils/youtube'

interface PlaylistItemsEditorProps {
  items: PlaylistItem[]
  mediaFiles: UploadedMediaFile[]
  onChange: (items: PlaylistItem[]) => void
  onMediaUploaded?: () => void
}

const TYPE_LABELS: Record<PlaylistItemType, string> = {
  imagem: 'Imagem',
  video: 'Vídeo',
  link: 'Link',
}

export default function PlaylistItemsEditor({ items, mediaFiles, onChange, onMediaUploaded }: PlaylistItemsEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<PlaylistItem | null>(null)
  const [librarySearch, setLibrarySearch] = useState('')

  function withOrder(nextItems: PlaylistItem[]): PlaylistItem[] {
    return nextItems.map((item, index) => ({ ...item, ordem: index + 1 }))
  }

  async function handleFilesSelected(fileList: FileList | null) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return

    setIsUploading(true)
    setFeedback(null)

    try {
      const videoDurations = await Promise.all(files.map(readVideoDuration))
      const uploaded = await api.uploadMediaBatch(files)
      const newItems: PlaylistItem[] = uploaded.map((file, index) => ({
        id: `item-${Date.now()}-${index}`,
        tipo: file.tipo,
        arquivo: file.url,
        // Vídeos continuam avançando pelo término real. A duração detectada
        // é usada apenas quando a sincronização entre TVs estiver ativa.
        tempoExibicao: file.tipo === 'video' ? videoDurations[index] ?? 10 : 20,
        ordem: 0,
      }))

      onChange(withOrder([...items, ...newItems]))
      setFeedback(`${uploaded.length} arquivo(s) enviados com sucesso.`)
      onMediaUploaded?.()
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : 'Não foi possível enviar os arquivos')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleAddUrl() {
    const trimmedUrl = url.trim()

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setFeedback('Informe uma URL completa, começando com http:// ou https://.')
      return
    }

    const type = inferUrlType(trimmedUrl)
    const videoId = extractYoutubeId(trimmedUrl)
    const newItem: PlaylistItem = {
      id: `item-${Date.now()}`,
      tipo: type,
      arquivo: videoId ? buildYoutubeEmbedUrl(videoId) : trimmedUrl,
      tempoExibicao: type === 'video' ? 10 : 30,
      ordem: 0,
    }

    onChange(withOrder([...items, newItem]))
    setUrl('')
    setFeedback('URL adicionada à playlist.')
  }

  function addLibraryFile(file: UploadedMediaFile) {
    if (items.some((item) => item.arquivo === file.url)) {
      setFeedback('Este arquivo já está nesta playlist.')
      return
    }

    const item: PlaylistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tipo: file.tipo,
      arquivo: file.url,
      tempoExibicao: file.tipo === 'video' ? 10 : 20,
      ordem: 0,
    }
    onChange(withOrder([...items, item]))
    setFeedback(`${file.nome} adicionado à playlist.`)
  }

  const availableFiles = mediaFiles.filter((file) =>
    file.nome.toLowerCase().includes(librarySearch.trim().toLowerCase()),
  )

  function updateItem(id: string, patch: Partial<PlaylistItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id: string) {
    onChange(withOrder(items.filter((item) => item.id !== id)))
  }

  function moveItem(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) return

    const next = [...items]
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    onChange(withOrder(next))
  }

  return (
    <div className="flex min-w-0 w-full max-w-full flex-col gap-4">
      <div className="rounded border border-dashed border-slate-700 bg-slate-950 p-4">
        <p className="text-sm font-medium text-slate-200">Adicionar arquivos</p>
        <p className="mt-1 text-xs text-slate-500">
          Envie imagens, vídeos, peças e avisos. Vídeos avançam automaticamente quando terminam.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
            {isUploading ? 'Enviando...' : 'Selecionar arquivos'}
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              multiple
              accept="image/*,video/*,.heic,.heif,.jxl,.tif,.tiff,.mkv,.avi,.3gp"
              disabled={isUploading}
              onChange={(event) => void handleFilesSelected(event.target.files)}
            />
          </label>
        </div>

        <details className="mt-4 rounded border border-slate-800 bg-slate-900/50 p-3">
          <summary className="cursor-pointer text-xs text-slate-400">Adicionar conteúdo por URL (opção avançada)</summary>
          <p className="mt-2 text-xs text-slate-500">Use somente para YouTube, notícias, dashboards ou uma página da intranet.</p>
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="h-10 min-w-0 w-full flex-1 rounded border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <button
              className="h-10 whitespace-nowrap rounded border border-slate-700 px-3 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-white"
              type="button"
              onClick={handleAddUrl}
            >
              Inserir URL
            </button>
          </div>
        </details>

        {feedback && <p className="mt-3 text-xs text-slate-400">{feedback}</p>}
      </div>

      <details className="rounded border border-slate-800 bg-slate-900/60 p-4" open={mediaFiles.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-slate-200">
          Biblioteca de arquivos <span className="ml-1 text-xs font-normal text-slate-500">({mediaFiles.length} disponíveis)</span>
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Reaproveite arquivos já enviados sem fazer upload novamente. Adicionar aqui não duplica o arquivo no servidor.
        </p>
        <input
          className="mt-3 h-9 w-full rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
          type="search"
          placeholder="Buscar arquivo enviado..."
          value={librarySearch}
          onChange={(event) => setLibrarySearch(event.target.value)}
        />
        <div className="mt-3 grid min-w-0 max-h-[32rem] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {availableFiles.map((file) => (
            <div className="flex min-w-0 flex-col gap-3 rounded border border-slate-800 bg-slate-950 p-3" key={file.url}>
              <button
                className="group relative flex aspect-video min-w-0 w-full items-center justify-center overflow-hidden rounded border border-slate-800 bg-black transition hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
                type="button"
                aria-label={`Ampliar ${file.nome}`}
                onClick={() => setPreviewItem({ id: file.url, tipo: file.tipo, arquivo: file.url, tempoExibicao: 20, ordem: 0 })}
              >
                <LibraryThumbnail file={file} />
                <span className="absolute bottom-2 right-2 rounded bg-slate-950/90 px-2 py-1 text-xs text-cyan-100">Ampliar</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-all text-sm font-medium leading-5 text-slate-200" title={file.nome}>{file.nome}</p>
                <p className="mt-1 text-xs text-slate-400">{TYPE_LABELS[file.tipo]}</p>
              </div>
              <button
                className="w-full rounded border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/10"
                type="button"
                onClick={() => addLibraryFile(file)}
              >
                Adicionar
              </button>
            </div>
          ))}
          {availableFiles.length === 0 && <p className="text-xs text-slate-500">Nenhum arquivo encontrado.</p>}
        </div>
      </details>

      {items.length === 0 ? (
        <p className="rounded border border-slate-800 bg-slate-950 px-4 py-6 text-center text-sm text-slate-500">
          Nenhum item ainda. Envie arquivos ou insira uma URL acima.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="grid min-w-0 grid-cols-1 gap-3 rounded border border-slate-800 bg-slate-950 p-3 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-center"
            >
              <button
                type="button"
                className="group relative h-16 w-16 shrink-0 overflow-hidden rounded border border-slate-800 bg-slate-900"
                onClick={() => setPreviewItem(item)}
                title="Pré-visualizar"
              >
                <ItemThumbnail item={item} />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/50 group-hover:opacity-100">
                  Ver
                </span>
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                    {TYPE_LABELS[item.tipo]}
                  </span>
                  <span className="min-w-0 max-w-full truncate text-xs text-slate-500">{item.arquivo}</span>
                </div>

                <input
                  className="h-8 min-w-0 w-full rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-300 outline-none transition focus:border-cyan-400"
                  type="text"
                  value={item.arquivo}
                  onChange={(event) => updateItem(item.id, { arquivo: event.target.value })}
                  aria-label="Arquivo ou URL"
                />
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-3 sm:col-span-2 sm:justify-end">
                {item.tipo === 'video' ? (
                  <label className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
                    Sinc.
                    <input
                      className="h-9 w-20 rounded border border-slate-700 bg-slate-900 px-2 text-center text-slate-100 outline-none transition focus:border-cyan-400"
                      type="number"
                      min={1}
                      value={item.tempoExibicao}
                      onChange={(event) => updateItem(item.id, { tempoExibicao: Number(event.target.value) })}
                      aria-label="Duração do vídeo para sincronização"
                    />
                    s
                  </label>
                ) : (
                  <label className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
                    Tempo
                    <input
                      className="h-9 w-20 rounded border border-slate-700 bg-slate-900 px-2 text-center text-slate-100 outline-none transition focus:border-cyan-400"
                      type="number"
                      min={1}
                      value={item.tempoExibicao}
                      onChange={(event) =>
                        updateItem(item.id, { tempoExibicao: Number(event.target.value) })
                      }
                    />
                    s
                  </label>
                )}

                <div className="flex shrink-0 gap-1">
                  <button
                    className="rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:border-cyan-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveItem(index, -1)}
                  >
                    Subir
                  </button>
                  <button
                    className="rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:border-cyan-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    type="button"
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(index, 1)}
                  >
                    Descer
                  </button>
                  <button
                    className="rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:border-red-400 hover:text-red-200"
                    type="button"
                    onClick={() => removeItem(item.id)}
                  >
                    Remover
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  )
}

function LibraryThumbnail({ file }: { file: UploadedMediaFile }) {
  if (file.tipo === 'imagem') return <img className="absolute inset-0 h-full w-full object-contain" src={file.url} alt="" loading="lazy" />
  if (file.tipo === 'video') return <video className="absolute inset-0 h-full w-full object-contain" src={file.url} muted playsInline preload="metadata" />
  return <span className="text-sm text-slate-400">Link / documento</span>
}

function ItemThumbnail({ item }: { item: PlaylistItem }) {
  if (item.tipo === 'imagem') {
    return <img className="h-full w-full object-cover" src={item.arquivo} alt="" />
  }

  if (item.tipo === 'video') {
    return <video className="h-full w-full object-cover" src={item.arquivo} muted playsInline preload="metadata" />
  }

  const videoId = extractYoutubeId(item.arquivo)

  if (videoId) {
    return <img className="h-full w-full object-cover" src={buildYoutubeThumbnailUrl(videoId)} alt="" />
  }

  return <span className="flex h-full w-full items-center justify-center text-xs text-slate-400">URL</span>
}

function PreviewModal({ item, onClose }: { item: PlaylistItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div className="w-full max-w-3xl overflow-hidden rounded border border-slate-700 bg-slate-950" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
          <span className="text-sm text-slate-300">{TYPE_LABELS[item.tipo]} - pré-visualização</span>
          <button className="rounded px-2 py-1 text-sm text-slate-400 hover:text-white" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="flex aspect-video items-center justify-center bg-black">
          {item.tipo === 'imagem' && <img className="h-full w-full object-contain" src={item.arquivo} alt="" />}
          {item.tipo === 'video' && <video className="h-full w-full object-contain" src={item.arquivo} controls autoPlay />}
          {item.tipo === 'link' && (
            <iframe className="h-full w-full border-0 bg-white" src={item.arquivo} title="Pré-visualização" sandbox="allow-scripts allow-presentation" allow="autoplay; encrypted-media; fullscreen" />
          )}
        </div>
      </div>
    </div>
  )
}

function inferUrlType(value: string): PlaylistItemType {
  const cleanUrl = value.split('?')[0].toLowerCase()

  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/.test(cleanUrl)) {
    return 'imagem'
  }

  if (/\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/.test(cleanUrl)) {
    return 'video'
  }

  return 'link'
}

function readVideoDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith('video/')) return Promise.resolve(null)

  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)
    const finish = (duration: number | null) => {
      URL.revokeObjectURL(objectUrl)
      resolve(duration)
    }

    video.preload = 'metadata'
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.max(1, Math.ceil(video.duration)) : null)
    video.onerror = () => finish(null)
    video.src = objectUrl
  })
}
