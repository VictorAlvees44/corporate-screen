import { useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { NewsFeed, NewsFeedFormData, NewsSettings } from '../types'

const EMPTY_SETTINGS: NewsSettings = { feeds: [] }
const EMPTY_FORM: NewsFeedFormData = {
  nome: '', categoria: 'Notícias', url: '', logoUrl: '', ativo: true,
  prioridade: 1, atualizarMinutos: 5, limiteNoticias: 15,
}

export default function NewsSettingsManager() {
  const [settings, setSettings] = useState<NewsSettings>(EMPTY_SETTINGS)
  const [editing, setEditing] = useState<NewsFeed | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const feeds = useMemo(() => [...settings.feeds].sort((a, b) => a.prioridade - b.prioridade || a.nome.localeCompare(b.nome)), [settings.feeds])

  useEffect(() => { void load() }, [])

  async function load() {
    setBusy('loading')
    try { setSettings(await api.getNewsSettings()) }
    catch (error) { setMessage(getMessage(error, 'Não foi possível carregar os feeds.')) }
    finally { setBusy(null) }
  }

  async function testFeed(feed: NewsFeed) {
    setBusy(`test-${feed.id}`); setMessage(null)
    try {
      const result = await api.testNewsFeed(feed.id)
      setSettings((current) => ({ feeds: current.feeds.map((item) => item.id === feed.id ? result.feed : item) }))
      setMessage(`${result.feed.nome}: teste concluído com ${result.quantidade} notícia(s).`)
    } catch (error) { setMessage(getMessage(error, `Não foi possível testar ${feed.nome}.`)) }
    finally { setBusy(null) }
  }

  async function refreshAll(testOnly = false) {
    setBusy(testOnly ? 'test-all' : 'refresh-all'); setMessage(null)
    try {
      const result = testOnly ? await api.testAllNewsFeeds() : await api.refreshAllNewsFeeds()
      setSettings(result)
      setMessage(testOnly ? 'Teste de todos os feeds concluído.' : 'Todos os feeds foram atualizados.')
    } catch (error) { setMessage(getMessage(error, 'Não foi possível atualizar os feeds.')) }
    finally { setBusy(null) }
  }

  async function remove(feed: NewsFeed) {
    if (!window.confirm(`Remover a fonte "${feed.nome}"?`)) return
    setBusy(`delete-${feed.id}`); setMessage(null)
    try {
      await api.deleteNewsFeed(feed.id)
      setSettings((current) => ({ feeds: current.feeds.filter((item) => item.id !== feed.id) }))
      setMessage(`${feed.nome} foi removido.`)
    } catch (error) { setMessage(getMessage(error, 'Não foi possível remover o feed.')) }
    finally { setBusy(null) }
  }

  return (
    <section className="grid gap-5">
      <div className="flex flex-col justify-between gap-4 rounded border border-slate-800 bg-slate-900/60 p-5 lg:flex-row lg:items-end">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Gerenciador de Notícias</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">Todas as fontes cadastradas ficam ativas, são atualizadas em segundo plano e entram em uma sequência aleatória sem repetição até concluir as notícias disponíveis. Se uma fonte falhar, as demais continuam normalmente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => void refreshAll(false)} disabled={busy !== null}>{busy === 'refresh-all' ? 'Atualizando...' : 'Atualizar todos'}</ActionButton>
          <ActionButton onClick={() => void refreshAll(true)} disabled={busy !== null}>{busy === 'test-all' ? 'Testando...' : 'Testar todos'}</ActionButton>
          <button className="rounded bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300" type="button" onClick={() => { setCreating(true); setEditing(null) }}>Adicionar feed</button>
        </div>
      </div>

      {message && <p className="rounded border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200">{message}</p>}

      {(creating || editing) && (
        <FeedEditor
          feed={editing}
          nextPriority={feeds.length + 1}
          onCancel={() => { setCreating(false); setEditing(null) }}
          onSaved={(feed) => {
            setSettings((current) => ({ feeds: editing ? current.feeds.map((item) => item.id === feed.id ? feed : item) : [...current.feeds, feed] }))
            setCreating(false); setEditing(null); setMessage(`${feed.nome} foi salvo.`)
          }}
        />
      )}

      <div className="overflow-hidden rounded border border-slate-800 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Fonte</th><th className="px-3 py-3">Categoria</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Atualização</th><th className="px-3 py-3">Prioridade</th><th className="px-3 py-3">Último resultado</th><th className="px-4 py-3 text-right">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {busy === 'loading' ? <tr><td className="px-4 py-5 text-slate-400" colSpan={7}>Carregando feeds...</td></tr> : feeds.length === 0 ? <tr><td className="px-4 py-7 text-slate-500" colSpan={7}>Nenhum feed cadastrado. Use “Adicionar feed” para começar.</td></tr> : feeds.map((feed) => (
                <tr className="align-middle text-slate-300" key={feed.id}>
                  <td className="px-4 py-3"><div className="flex items-center gap-3">{feed.logoUrl ? <img className="h-9 w-9 rounded object-cover" src={feed.logoUrl} alt="" /> : <div className="flex h-9 w-9 items-center justify-center rounded bg-cyan-400/15 text-xs font-bold text-cyan-200">{feed.nome.slice(0, 2).toUpperCase()}</div>}<div><p className="font-medium text-slate-100">{feed.nome}</p><p className="max-w-[260px] truncate text-xs text-slate-500" title={feed.url}>{feed.url}</p></div></div></td>
                  <td className="px-3 py-3">{feed.categoria}</td>
                  <td className="px-3 py-3"><StatusBadge feed={feed} /></td>
                  <td className="px-3 py-3">{feed.atualizarMinutos} min<br /><span className="text-xs text-slate-500">máx. {feed.limiteNoticias}</span></td>
                  <td className="px-3 py-3 font-semibold text-slate-100">{feed.prioridade}</td>
                  <td className="max-w-[260px] px-3 py-3 text-xs text-slate-400">{feed.ultimoStatus === 'error' ? <span className="text-rose-300" title={feed.ultimoErro}>{feed.ultimoErro || 'Erro na leitura'}</span> : <>{feed.ultimaQuantidade ?? 0} notícia(s)<br />{formatDate(feed.ultimaAtualizacaoEm)}</>}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2"><ActionButton onClick={() => void testFeed(feed)} disabled={busy !== null}>{busy === `test-${feed.id}` ? '...' : 'Testar'}</ActionButton><ActionButton onClick={() => { setEditing(feed); setCreating(false) }} disabled={busy !== null}>Editar</ActionButton><button className="text-sm text-rose-300 hover:text-rose-200 disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => void remove(feed)}>Remover</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function FeedEditor({ feed, nextPriority, onCancel, onSaved }: { feed: NewsFeed | null; nextPriority: number; onCancel: () => void; onSaved: (feed: NewsFeed) => void }) {
  const [form, setForm] = useState<NewsFeedFormData>(feed ? toForm(feed) : { ...EMPTY_FORM, prioridade: nextPriority })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = <K extends keyof NewsFeedFormData>(key: K, value: NewsFeedFormData[K]) => setForm((current) => ({ ...current, [key]: value }))

  async function uploadLogo(file: File | undefined) {
    if (!file) return
    setUploading(true); setError(null)
    try { update('logoUrl', (await api.uploadMedia(file)).url) }
    catch (error) { setError(getMessage(error, 'Não foi possível enviar o logo.')) }
    finally { setUploading(false) }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null)
    try { onSaved(feed ? await api.updateNewsFeed(feed.id, form) : await api.createNewsFeed(form)) }
    catch (error) { setError(getMessage(error, 'Não foi possível salvar o feed.')) }
    finally { setSaving(false) }
  }

  return <form className="rounded border border-cyan-500/40 bg-slate-900 p-5" onSubmit={submit}>
    <div className="flex items-center justify-between gap-4"><div><h4 className="font-semibold">{feed ? `Editar ${feed.nome}` : 'Adicionar feed'}</h4><p className="mt-1 text-sm text-slate-400">O link pode ser RSS/Atom ou a página do portal; o sistema tenta localizar o feed automaticamente.</p></div><button className="text-slate-400 hover:text-slate-100" type="button" onClick={onCancel}>Fechar</button></div>
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Field label="Nome"><input required value={form.nome} onChange={(event) => update('nome', event.target.value)} placeholder="G1" /></Field>
      <Field label="Categoria"><input required value={form.categoria} onChange={(event) => update('categoria', event.target.value)} placeholder="Notícias, Esportes, Tecnologia..." /></Field>
      <Field label="Prioridade"><input required min="1" type="number" value={form.prioridade} onChange={(event) => update('prioridade', Number(event.target.value))} /></Field>
      <Field label="URL RSS ou site"><input className="md:col-span-2 xl:col-span-2" required type="url" value={form.url} onChange={(event) => update('url', event.target.value)} placeholder="https://..." /></Field>
      <Field label="Atualizar a cada"><select value={form.atualizarMinutos} onChange={(event) => update('atualizarMinutos', Number(event.target.value))}>{[1, 2, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}</select></Field>
      <Field label="Máximo de notícias"><input required min="1" type="number" value={form.limiteNoticias} onChange={(event) => update('limiteNoticias', Number(event.target.value))} /></Field>
      <Field label="Logo da fonte (opcional)"><input accept="image/*" type="file" onChange={(event) => void uploadLogo(event.target.files?.[0])} />{uploading && <span className="text-xs text-cyan-300">Enviando logo...</span>}{form.logoUrl && <div className="mt-2 flex items-center gap-2"><img className="h-8 w-8 rounded object-cover" src={form.logoUrl} alt="Logo" /><button className="text-xs text-rose-300" type="button" onClick={() => update('logoUrl', '')}>Remover logo</button></div>}</Field>
      <p className="self-end pb-2 text-sm text-emerald-300">✓ Esta fonte ficará ativa no player.</p>
    </div>
    {error && <p className="mt-4 rounded border border-rose-900 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">{error}</p>}
    <div className="mt-5 flex gap-2"><button className="rounded bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" disabled={saving || uploading} type="submit">{saving ? 'Salvando...' : 'Salvar feed'}</button><ActionButton onClick={onCancel} disabled={saving}>Cancelar</ActionButton></div>
  </form>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-300"><span>{label}</span><span className="[&>input]:h-10 [&>input]:w-full [&>input]:rounded [&>input]:border [&>input]:border-slate-700 [&>input]:bg-slate-950 [&>input]:px-3 [&>select]:h-10 [&>select]:w-full [&>select]:rounded [&>select]:border [&>select]:border-slate-700 [&>select]:bg-slate-950 [&>select]:px-3">{children}</span></label> }
function ActionButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50" type="button" {...props}>{children}</button> }
function StatusBadge({ feed }: { feed: NewsFeed }) { const appearance = feed.ultimoStatus === 'success' ? ['Ativo', 'border-emerald-800 bg-emerald-950/40 text-emerald-300'] : feed.ultimoStatus === 'error' ? ['Erro', 'border-rose-800 bg-rose-950/30 text-rose-300'] : ['Atualizando', 'border-amber-800 bg-amber-950/30 text-amber-200']; return <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${appearance[1]}`}>{appearance[0]}</span> }
function toForm(feed: NewsFeed): NewsFeedFormData { const { nome, categoria, url, logoUrl, ativo, prioridade, atualizarMinutos, limiteNoticias } = feed; return { nome, categoria, url, logoUrl, ativo, prioridade, atualizarMinutos, limiteNoticias } }
function formatDate(value: string | undefined): string { if (!value) return 'Ainda não atualizado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Ainda não atualizado' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }
function getMessage(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback }
