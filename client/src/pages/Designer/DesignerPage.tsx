import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../services/api'
import type {
  Layout,
  LayoutComponent,
  LayoutComponentType,
  LayoutFormData,
  TV,
  TVFormData,
} from '../../types'

const COMPONENT_TYPES: { value: LayoutComponentType; label: string }[] = [
  { value: 'texto', label: 'Texto' },
  { value: 'imagem', label: 'Imagem' },
  { value: 'video', label: 'Vídeo' },
  { value: 'relogio', label: 'Relógio' },
  { value: 'logo', label: 'Logo' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'pagina-web', label: 'Página web' },
  { value: 'html', label: 'HTML customizado' },
  { value: 'qrcode', label: 'QR Code' },
  { value: 'clima', label: 'Clima' },
  { value: 'noticias', label: 'Notícias' },
  { value: 'aniversarios', label: 'Aniversários' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'indicadores', label: 'Indicadores' },
  { value: 'calendario', label: 'Calendário' },
]

const EMPTY_FORM: LayoutFormData = {
  nome: '',
  componentes: [],
}

export default function DesignerPage({ embedded = false }: { embedded?: boolean } = {}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [tvs, setTVs] = useState<TV[]>([])
  const [form, setForm] = useState<LayoutFormData>(EMPTY_FORM)
  const [editingLayoutId, setEditingLayoutId] = useState<string | null>(null)
  const [targetTVId, setTargetTVId] = useState('')
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void loadLayouts()
  }, [])

  async function loadLayouts() {
    setStatus('loading')
    setMessage(null)

    try {
      const [loadedLayouts, loadedTVs] = await Promise.all([api.listLayouts(), api.listTVs()])
      setLayouts(loadedLayouts)
      setTVs(loadedTVs)
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível carregar os layouts',
      )
    } finally {
      setStatus('idle')
    }
  }

  async function handleSaveLayout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setMessage(null)

    try {
      const savedLayout = editingLayoutId
        ? await api.updateLayout(editingLayoutId, form)
        : await api.createLayout(form)

      setLayouts((currentLayouts) => {
        const exists = currentLayouts.some((layout) => layout.id === savedLayout.id)
        return exists
          ? currentLayouts.map((layout) => (layout.id === savedLayout.id ? savedLayout : layout))
          : [...currentLayouts, savedLayout]
      })
      setEditingLayoutId(savedLayout.id)
      setForm(savedLayout)
      setMessage('Layout salvo. Selecione uma TV abaixo para colocá-lo no ar.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar o layout')
    } finally {
      setStatus('idle')
    }
  }

  async function handleDeleteLayout(layout: Layout) {
    const shouldDelete = window.confirm(`Remover ${layout.nome}?`)

    if (!shouldDelete) {
      return
    }

    setStatus('saving')
    setMessage(null)

    try {
      await api.deleteLayout(layout.id)
      setLayouts((currentLayouts) => currentLayouts.filter((item) => item.id !== layout.id))

      if (editingLayoutId === layout.id) {
        resetForm()
      }

      setMessage('Layout removido com sucesso.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover o layout')
    } finally {
      setStatus('idle')
    }
  }

  function editLayout(layout: Layout) {
    setEditingLayoutId(layout.id)
    setForm(layout)
    setSelectedComponentId(layout.componentes[0]?.id ?? null)
    setTargetTVId(tvs.find((tv) => tv.layoutAtual === layout.id)?.id ?? '')
    setMessage(null)
  }

  function resetForm() {
    setEditingLayoutId(null)
    setSelectedComponentId(null)
    setForm(EMPTY_FORM)
    setTargetTVId('')
  }

  async function handleApplyToTV() {
    if (!editingLayoutId || !targetTVId) {
      setMessage('Salve o layout e selecione uma TV para aplicá-lo.')
      return
    }

    const targetTV = tvs.find((tv) => tv.id === targetTVId)
    if (!targetTV) {
      setMessage('TV não encontrada. Atualize a página e tente novamente.')
      return
    }

    setStatus('saving')
    setMessage(null)
    const formData: TVFormData = {
      nome: targetTV.nome,
      local: targetTV.local,
      setor: targetTV.setor,
      unidade: targetTV.unidade,
      observacoes: targetTV.observacoes,
      playlistAtual: targetTV.playlistAtual ?? '',
      layoutAtual: editingLayoutId,
      cepClima: targetTV.cepClima ?? '',
      exibirRelogio: targetTV.exibirRelogio !== false,
      exibirNoticias: targetTV.exibirNoticias !== false,
      exibirClima: targetTV.exibirClima !== false,
    }

    try {
      const updated = await api.updateTV(targetTV.id, formData)
      setTVs((current) => current.map((tv) => (tv.id === updated.id ? updated : tv)))
      setMessage(`Layout aplicado em ${updated.nome || updated.id}. A TV atualizará em até 15 segundos.`)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível aplicar o layout nesta TV')
    } finally {
      setStatus('idle')
    }
  }

  function addComponent(tipo: LayoutComponentType) {
    setForm((currentForm) => {
      const nextIndex = currentForm.componentes.length + 1
      const component: LayoutComponent = {
        id: `component-${Date.now()}`,
        tipo,
        x: 60 + nextIndex * 16,
        y: 60 + nextIndex * 16,
        largura: getDefaultSize(tipo).largura,
        altura: getDefaultSize(tipo).altura,
        visivel: true,
        conteudo: getDefaultContent(tipo),
      }

      setSelectedComponentId(component.id)
      return { ...currentForm, componentes: [...currentForm.componentes, component] }
    })
  }

  function updateComponent(componentId: string, patch: Partial<LayoutComponent>) {
    setForm((currentForm) => ({
      ...currentForm,
      componentes: currentForm.componentes.map((component) =>
        component.id === componentId ? { ...component, ...patch } : component,
      ),
    }))
  }

  function duplicateComponent(component: LayoutComponent) {
    const duplicated = {
      ...component,
      id: `component-${Date.now()}`,
      x: component.x + 24,
      y: component.y + 24,
    }

    setForm((currentForm) => ({
      ...currentForm,
      componentes: [...currentForm.componentes, duplicated],
    }))
    setSelectedComponentId(duplicated.id)
  }

  function removeComponent(componentId: string) {
    setForm((currentForm) => ({
      ...currentForm,
      componentes: currentForm.componentes.filter((component) => component.id !== componentId),
    }))
    setSelectedComponentId(null)
  }

  // A ordem de `componentes` é também a ordem de empilhamento visual: quem
  // vem depois no array aparece por cima de quem vem antes. Sem isso, um
  // componente de fundo (imagem/vídeo) adicionado depois de um relógio,
  // clima ou notícias acaba cobrindo esses widgets por completo — eles
  // ficam salvos no layout, só não aparecem na TV.
  function moveComponentLayer(componentId: string, direction: 'front' | 'back' | 'forward' | 'backward') {
    setForm((currentForm) => {
      const index = currentForm.componentes.findIndex((component) => component.id === componentId)
      if (index === -1) return currentForm

      const componentes = [...currentForm.componentes]
      const [item] = componentes.splice(index, 1)

      if (direction === 'front') {
        componentes.push(item)
      } else if (direction === 'back') {
        componentes.unshift(item)
      } else if (direction === 'forward') {
        componentes.splice(Math.min(index + 1, componentes.length), 0, item)
      } else {
        componentes.splice(Math.max(index - 1, 0), 0, item)
      }

      return { ...currentForm, componentes }
    })
  }

  const selectedComponent =
    form.componentes.find((component) => component.id === selectedComponentId) ?? null

  return (
    <main className={embedded ? '' : 'min-h-screen bg-slate-950 text-slate-100'}>
      <div className={embedded ? 'flex w-full flex-col' : 'mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8'}>
        {!embedded && (
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">Corporate Screen</p>
              <h1 className="mt-2 text-2xl font-semibold">Editor Visual</h1>
            </div>

            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              type="button"
              onClick={resetForm}
            >
              Novo layout
            </button>
          </header>
        )}

        {embedded && (
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Layouts</h2>
              <p className="text-sm text-slate-400">Editor visual usado para montar o que aparece nas TVs.</p>
            </div>

            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              type="button"
              onClick={resetForm}
            >
              Novo layout
            </button>
          </div>
        )}

        <section className="grid items-start gap-5 py-5 2xl:grid-cols-[minmax(210px,0.65fr)_minmax(520px,1.55fr)_minmax(320px,0.9fr)]">
          <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm shadow-black/20">
            <h2 className="text-base font-semibold">Layouts salvos</h2>

            <div className="mt-4 grid gap-2">
              {status === 'loading' && (
                <p className="text-sm text-slate-400">Carregando layouts...</p>
              )}

              {status !== 'loading' && layouts.length === 0 && (
                <p className="text-sm leading-6 text-slate-400">
                  Nenhum layout salvo ainda.
                </p>
              )}

              {layouts.map((layout) => (
                <button
                  className={`rounded border px-3 py-2 text-left text-sm transition ${
                    editingLayoutId === layout.id
                      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                  }`}
                  key={layout.id}
                  type="button"
                  onClick={() => editLayout(layout)}
                >
                  <span className="block font-medium">{layout.nome}</span>
                  <span className="mt-1 block font-mono text-xs text-slate-500">{layout.id}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/30 p-4 shadow-sm shadow-black/20">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Prévia 16:9</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Arraste um componente para mover e use a alça no canto inferior direito para
                  redimensionar. A posição usa a base 1920 x 1080, igual ao player.
                </p>
              </div>
            </div>

            <div ref={canvasRef} className="aspect-video overflow-hidden rounded-lg border border-slate-700 bg-black shadow-inner shadow-black/70">
              <div className="relative h-full w-full">
                {form.componentes
                  .filter((component) => component.visivel)
                  .map((component) => (
                    <DraggableCanvasComponent
                      key={component.id}
                      component={component}
                      isSelected={selectedComponentId === component.id}
                      canvasRef={canvasRef}
                      onSelect={() => setSelectedComponentId(component.id)}
                      onChange={(patch) => updateComponent(component.id, patch)}
                    />
                  ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {COMPONENT_TYPES.map((type) => (
                <button
                  className="min-h-10 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/5 hover:text-cyan-100"
                  key={type.value}
                  type="button"
                  onClick={() => addComponent(type.value)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </section>

          <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm shadow-black/20">
            <h2 className="text-lg font-semibold">
              {editingLayoutId ? `Editar ${editingLayoutId}` : 'Cadastrar layout'}
            </h2>

            <form className="mt-5 flex flex-col gap-4" onSubmit={handleSaveLayout}>
              <DesignerInput
                label="Nome"
                value={form.nome}
                placeholder="Layout recepção"
                onChange={(value) => setForm((currentForm) => ({ ...currentForm, nome: value }))}
                required
              />

              <div className="grid gap-3">
                <p className="text-sm font-medium text-slate-300">Componentes</p>
                <p className="text-xs text-slate-500">
                  A ordem abaixo é também a ordem de camadas: quem está mais para baixo na lista aparece por
                  cima na TV. Use as setas para trazer um widget para frente de uma imagem/vídeo de fundo.
                </p>

                {form.componentes.length === 0 && (
                  <p className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400">
                    Adicione um componente para começar.
                  </p>
                )}

                {form.componentes.map((component, index) => (
                  <div
                    className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition ${
                      selectedComponentId === component.id
                        ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100'
                        : 'border-slate-800 bg-slate-950 text-slate-300'
                    }`}
                    key={component.id}
                  >
                    <button
                      className="flex-1 truncate text-left hover:text-white"
                      type="button"
                      onClick={() => setSelectedComponentId(component.id)}
                    >
                      {getComponentLabel(component.tipo)}
                      <span className="ml-2 text-xs text-slate-500">{component.conteudo}</span>
                    </button>

                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-30"
                        type="button"
                        title="Enviar para trás (uma posição)"
                        disabled={index === 0}
                        onClick={() => moveComponentLayer(component.id, 'backward')}
                      >
                        ↓
                      </button>
                      <button
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-30"
                        type="button"
                        title="Trazer para frente (uma posição)"
                        disabled={index === form.componentes.length - 1}
                        onClick={() => moveComponentLayer(component.id, 'forward')}
                      >
                        ↑
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {selectedComponent && (
                <ComponentEditor
                  component={selectedComponent}
                  onChange={(patch) => updateComponent(selectedComponent.id, patch)}
                  onDuplicate={() => duplicateComponent(selectedComponent)}
                  onRemove={() => removeComponent(selectedComponent.id)}
                />
              )}

              {message && (
                <p className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                  {message}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  className="h-10 flex-1 rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={status === 'saving'}
                >
                  {status === 'saving' ? 'Salvando...' : 'Salvar layout'}
                </button>

                {editingLayoutId && (
                  <button
                    className="h-10 rounded border border-red-500/40 px-4 text-sm text-red-200 transition hover:border-red-400"
                    type="button"
                    onClick={() => {
                      const layout = layouts.find((item) => item.id === editingLayoutId)
                      if (layout) void handleDeleteLayout(layout)
                    }}
                  >
                    Remover
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-3">
                <p className="text-sm font-medium text-cyan-100">Colocar este layout em uma TV</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {editingLayoutId
                    ? 'Selecione a tela que deve receber este layout. Ela atualizará automaticamente.'
                    : 'Salve o layout primeiro; em seguida você poderá escolhê-lo diretamente para uma TV.'}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select
                    className="h-10 min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                    value={targetTVId}
                    disabled={!editingLayoutId}
                    onChange={(event) => setTargetTVId(event.target.value)}
                  >
                    <option value="">Selecione a TV</option>
                    {tvs.map((tv) => (
                      <option key={tv.id} value={tv.id}>{tv.nome || tv.id} ({tv.id})</option>
                    ))}
                  </select>
                  <button
                    className="h-10 rounded border border-cyan-400/50 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={status === 'saving' || !targetTVId || !editingLayoutId}
                    onClick={() => void handleApplyToTV()}
                  >
                    Aplicar na TV
                  </button>
                </div>
              </div>
            </form>
          </aside>
        </section>
      </div>
    </main>
  )
}

interface ComponentEditorProps {
  component: LayoutComponent
  onChange: (patch: Partial<LayoutComponent>) => void
  onDuplicate: () => void
  onRemove: () => void
}

function ComponentEditor({ component, onChange, onDuplicate, onRemove }: ComponentEditorProps) {
  return (
    <section className="rounded border border-slate-800 bg-slate-950 p-4">
      <div className="grid gap-3">
        <label className="flex flex-col gap-2 text-sm text-slate-300">
          Tipo
          <select
            className="h-10 rounded border border-slate-700 bg-slate-900 px-3 text-slate-100 outline-none transition focus:border-cyan-400"
            value={component.tipo}
            onChange={(event) =>
              onChange({ tipo: event.target.value as LayoutComponentType })
            }
          >
            {COMPONENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        {component.tipo === 'html' ? (
          <label className="flex flex-col gap-2 text-sm text-slate-300">
            Código HTML
            <textarea
              className="h-32 rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none transition focus:border-cyan-400"
              value={component.conteudo}
              placeholder="<div style='color:white'>Seu HTML aqui</div>"
              onChange={(event) => onChange({ conteudo: event.target.value })}
            />
          </label>
        ) : (
          <DesignerInput
            label={getContentLabel(component.tipo)}
            value={component.conteudo}
            placeholder={getContentPlaceholder(component.tipo)}
            onChange={(value) => onChange({ conteudo: value })}
            disabled={component.tipo === 'noticias' || component.tipo === 'aniversarios'}
          />
        )}

        {component.tipo === 'noticias' && (
          <p className="text-xs leading-5 text-slate-500">
            O feed de notícias é configurado globalmente no painel administrativo (aba Notícias).
          </p>
        )}

        {component.tipo === 'aniversarios' && (
          <p className="text-xs leading-5 text-slate-500">
            Exibe automaticamente os aniversariantes do dia cadastrados no painel administrativo.
          </p>
        )}

        {isEmbedType(component.tipo) && (
          <div className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Opções de exibição
            </p>

            <NumberInput
              label="Atualizar a cada (segundos, 0 = nunca)"
              value={component.atualizarSegundos ?? 0}
              onChange={(value) =>
                onChange({ atualizarSegundos: value > 0 ? value : undefined })
              }
            />

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={component.permitirTelaCheia ?? false}
                onChange={(event) => onChange({ permitirTelaCheia: event.target.checked })}
              />
              Permitir tela cheia (útil para dashboards com botão de fullscreen próprio)
            </label>

            <p className="text-xs leading-5 text-slate-500">
              Alguns painéis (ex.: Power BI, sistemas internos com login) bloqueiam a exibição
              em iframe por segurança (cabeçalho X-Frame-Options). Se a tela do componente
              ficar em branco no player, confirme se a URL usada permite incorporação.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="X" value={component.x} onChange={(value) => onChange({ x: value })} />
          <NumberInput label="Y" value={component.y} onChange={(value) => onChange({ y: value })} />
          <NumberInput
            label="Largura"
            value={component.largura}
            onChange={(value) => onChange({ largura: value })}
          />
          <NumberInput
            label="Altura"
            value={component.altura}
            onChange={(value) => onChange({ altura: value })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={component.visivel}
            onChange={(event) => onChange({ visivel: event.target.checked })}
          />
          Visível
        </label>

        <div className="flex gap-2">
          <button
            className="h-9 flex-1 rounded border border-slate-700 px-3 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
            type="button"
            onClick={onDuplicate}
          >
            Duplicar
          </button>
          <button
            className="h-9 flex-1 rounded border border-red-500/40 px-3 text-sm text-red-200 transition hover:border-red-400"
            type="button"
            onClick={onRemove}
          >
            Remover
          </button>
        </div>
      </div>
    </section>
  )
}

interface DesignerInputProps {
  label: string
  value: string
  placeholder: string
  required?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}

function DesignerInput({
  label,
  value,
  placeholder,
  required = false,
  disabled = false,
  onChange,
}: DesignerInputProps) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      {label}
      <input
        className="h-10 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
      />
    </label>
  )
}

interface NumberInputProps {
  label: string
  value: number
  onChange: (value: number) => void
}

function NumberInput({ label, value, onChange }: NumberInputProps) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      {label}
      <input
        className="h-10 rounded border border-slate-700 bg-slate-900 px-3 text-slate-100 outline-none transition focus:border-cyan-400"
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const MIN_COMPONENT_SIZE = 60

type DragMode = 'move' | 'resize'

interface DragState {
  mode: DragMode
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

interface DraggableCanvasComponentProps {
  component: LayoutComponent
  isSelected: boolean
  canvasRef: React.RefObject<HTMLDivElement | null>
  onSelect: () => void
  onChange: (patch: Partial<LayoutComponent>) => void
}

/**
 * Componente do canvas do Designer que pode ser arrastado (mover) e
 * redimensionado (alça no canto), convertendo pixels de tela para a
 * base de coordenadas 1920x1080 usada pelo player.
 */
function DraggableCanvasComponent({
  component,
  isSelected,
  canvasRef,
  onSelect,
  onChange,
}: DraggableCanvasComponentProps) {
  const dragState = useRef<DragState | null>(null)
  const previewScale = getPreviewScale(component)

  function getScale(): number {
    const rect = canvasRef.current?.getBoundingClientRect()
    return rect && rect.width > 0 ? rect.width / CANVAS_WIDTH : 1
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>, mode: DragMode) {
    event.stopPropagation()
    event.preventDefault()
    onSelect()

    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: component.x,
      startY: component.y,
      startWidth: component.largura,
      startHeight: component.altura,
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const scale = getScale()
    const deltaX = (event.clientX - drag.startClientX) / scale
    const deltaY = (event.clientY - drag.startClientY) / scale

    if (drag.mode === 'move') {
      const maxX = Math.max(0, CANVAS_WIDTH - drag.startWidth)
      const maxY = Math.max(0, CANVAS_HEIGHT - drag.startHeight)
      onChange({
        x: Math.round(clamp(drag.startX + deltaX, 0, maxX)),
        y: Math.round(clamp(drag.startY + deltaY, 0, maxY)),
      })
      return
    }

    const maxWidth = Math.max(MIN_COMPONENT_SIZE, CANVAS_WIDTH - drag.startX)
    const maxHeight = Math.max(MIN_COMPONENT_SIZE, CANVAS_HEIGHT - drag.startY)
    onChange({
      largura: Math.round(clamp(drag.startWidth + deltaX, MIN_COMPONENT_SIZE, maxWidth)),
      altura: Math.round(clamp(drag.startHeight + deltaY, MIN_COMPONENT_SIZE, maxHeight)),
    })
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null
    }
  }

  return (
    <div
      className={`absolute cursor-move touch-none select-none overflow-hidden rounded border text-left text-xs transition ${
        isSelected
          ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50'
          : 'border-slate-600 bg-slate-900/80 text-slate-200 hover:border-slate-400'
      }`}
      style={getPreviewStyle(component)}
      onPointerDown={(event) => beginDrag(event, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="p-3">
        <span className="block uppercase text-slate-400" style={{ fontSize: `${Math.max(7, Math.round(10 * previewScale))}px` }}>
          {getComponentLabel(component.tipo)}
        </span>
        <span className="mt-1 block truncate font-medium" style={{ fontSize: `${Math.max(10, Math.round(14 * previewScale))}px` }}>
          {getPreviewText(component)}
        </span>
      </div>

      {isSelected && (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none rounded-tl bg-cyan-300"
          onPointerDown={(event) => beginDrag(event, 'resize')}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}

function getPreviewStyle(component: LayoutComponent): React.CSSProperties {
  return {
    left: `${(component.x / 1920) * 100}%`,
    top: `${(component.y / 1080) * 100}%`,
    width: `${(component.largura / 1920) * 100}%`,
    height: `${(component.altura / 1080) * 100}%`,
  }
}

function getPreviewScale(component: LayoutComponent): number {
  return Math.min(2.2, Math.max(0.55, Math.min(component.largura / 560, component.altura / 240)))
}

function getPreviewText(component: LayoutComponent): string {
  if (component.tipo === 'clima') return `☀️ 24° · ${component.conteudo || 'Clima'}`
  if (component.tipo === 'noticias') return '📰 Notícia em destaque'
  if (component.tipo === 'relogio') return '12:45'
  if (component.tipo === 'calendario') return 'Segunda-feira, 28'
  return component.conteudo || 'Sem conteúdo'
}

function getComponentLabel(tipo: LayoutComponentType): string {
  return COMPONENT_TYPES.find((type) => type.value === tipo)?.label ?? tipo
}

// Dashboard, página web e HTML customizado são todos "embeds" exibidos via
// iframe no player — compartilham as mesmas opções de exibição (atualização
// automática, tela cheia).
function isEmbedType(tipo: LayoutComponentType): boolean {
  return tipo === 'dashboard' || tipo === 'pagina-web' || tipo === 'html'
}

function getContentLabel(tipo: LayoutComponentType): string {
  if (tipo === 'clima') return 'Cidade ou CEP'
  if (tipo === 'ranking') return 'ID do ranking'
  if (tipo === 'indicadores') return 'Indicadores (um por linha: Título|Valor)'
  if (tipo === 'dashboard' || tipo === 'pagina-web') return 'URL'
  return 'Conteúdo'
}

function getContentPlaceholder(tipo: LayoutComponentType): string {
  if (tipo === 'clima') return 'Joinville ou 89201000'
  if (tipo === 'ranking') return 'ranking-001'
  if (tipo === 'indicadores') return 'Vendas|R$ 120 mil\nMeta|87%\nClientes|42'
  if (tipo === 'noticias') return 'Configurado na aba Notícias do admin'
  if (tipo === 'aniversarios') return 'Automático (birthdays.json)'
  if (tipo === 'dashboard') return 'https://app.powerbi.com/view?r=...'
  if (tipo === 'pagina-web') return 'https://intranet.empresa.com.br'
  return 'Texto, URL ou referência'
}

function getDefaultContent(tipo: LayoutComponentType): string {
  const defaults: Record<LayoutComponentType, string> = {
    texto: 'Novo comunicado',
    imagem: '/uploads/images/banner.jpg',
    video: '/uploads/videos/video.mp4',
    relogio: 'HH:mm',
    logo: '/uploads/logos/logo.png',
    dashboard: 'https://app.powerbi.com/view?r=...',
    'pagina-web': 'https://intranet.empresa.com.br',
    qrcode: 'https://empresa.com.br',
    clima: 'Joinville',
    noticias: '',
    aniversarios: '',
    ranking: 'ranking-001',
    indicadores: 'Vendas|R$ 120 mil\nMeta|87%\nClientes|42',
    calendario: '',
    html: "<div style='color:#fff;font-size:32px'>Seu HTML aqui</div>",
  }

  return defaults[tipo]
}

function getDefaultSize(tipo: LayoutComponentType): { largura: number; altura: number } {
  const sizes: Partial<Record<LayoutComponentType, { largura: number; altura: number }>> = {
    relogio: { largura: 260, altura: 100 },
    clima: { largura: 300, altura: 140 },
    noticias: { largura: 1920, altura: 70 },
    aniversarios: { largura: 420, altura: 220 },
    ranking: { largura: 480, altura: 320 },
    indicadores: { largura: 520, altura: 300 },
    calendario: { largura: 420, altura: 300 },
    dashboard: { largura: 960, altura: 540 },
    'pagina-web': { largura: 960, altura: 540 },
    html: { largura: 480, altura: 270 },
  }

  return sizes[tipo] ?? { largura: 360, altura: 190 }
}
