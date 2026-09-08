import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { Ranking, RankingFormData } from '../types'

const EMPTY_FORM: RankingFormData = { nome: '' }

/**
 * Gestão de rankings comerciais (widget "Ranking" do /designer). O CSV
 * importado (colunas posicao,nome,valor) substitui os itens do ranking
 * selecionado — o cadastro aqui só define nome/ID do ranking.
 */
export default function RankingManager() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [form, setForm] = useState<RankingFormData>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setRankings(await api.listRankings())
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível carregar os rankings')
    } finally {
      setStatus('idle')
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setMessage(null)

    try {
      const saved = editingId ? await api.updateRanking(editingId, form) : await api.createRanking(form)

      setRankings((current) => {
        const exists = current.some((item) => item.id === saved.id)
        return exists
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]
      })
      resetForm()
      setMessage(`Ranking salvo com ID ${saved.id}. Use esse ID no componente "Ranking" do designer.`)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar')
    } finally {
      setStatus('idle')
    }
  }

  async function handleDelete(ranking: Ranking) {
    if (!window.confirm(`Remover ${ranking.nome}?`)) return

    setStatus('saving')
    try {
      await api.deleteRanking(ranking.id)
      setRankings((current) => current.filter((item) => item.id !== ranking.id))
      if (editingId === ranking.id) resetForm()
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover')
    } finally {
      setStatus('idle')
    }
  }

  async function handleImport(ranking: Ranking, file: File) {
    setImportingId(ranking.id)
    setMessage(null)

    try {
      const updated = await api.importRanking(ranking.id, file)
      setRankings((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(`Importados ${updated.itens.length} itens para ${updated.nome}.`)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível importar o CSV')
    } finally {
      setImportingId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function edit(ranking: Ranking) {
    setEditingId(ranking.id)
    setForm({ nome: ranking.nome })
    setMessage(null)
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-base font-semibold">Rankings cadastrados</h3>
        <p className="mt-1 text-sm text-slate-400">
          Envie um CSV com colunas <code className="text-slate-300">posicao,nome,valor</code> para
          atualizar os itens de cada ranking.
        </p>

        {status === 'loading' && <p className="mt-3 text-sm text-slate-400">Carregando...</p>}

        {status !== 'loading' && rankings.length === 0 && (
          <p className="mt-3 text-sm text-slate-400">Nenhum ranking cadastrado ainda.</p>
        )}

        <ul className="mt-3 grid gap-2">
          {rankings.map((ranking) => (
            <li key={ranking.id} className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-slate-100">{ranking.nome}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{ranking.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded border border-cyan-400/50 px-2 py-1 text-xs text-cyan-200 hover:border-cyan-300">
                    {importingId === ranking.id ? 'Importando...' : 'Importar CSV'}
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      accept=".csv,text/csv"
                      disabled={importingId !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void handleImport(ranking, file)
                      }}
                    />
                  </label>
                  <button
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                    type="button"
                    onClick={() => edit(ranking)}
                  >
                    Editar
                  </button>
                  <button
                    className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200 hover:border-red-400"
                    type="button"
                    onClick={() => void handleDelete(ranking)}
                  >
                    Remover
                  </button>
                </div>
              </div>

              {ranking.itens.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {ranking.itens.length} itens · atualizado em{' '}
                  {new Date(ranking.atualizadoEm).toLocaleString('pt-BR')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <aside className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-base font-semibold">
          {editingId ? `Editar ${editingId}` : 'Cadastrar ranking'}
        </h3>

        <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Nome
            <input
              className="h-9 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-400"
              type="text"
              value={form.nome}
              onChange={(event) => setForm({ nome: event.target.value })}
              placeholder="Ranking Comercial — Julho"
              required
            />
          </label>

          {message && (
            <p className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              {message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              className="h-9 flex-1 rounded bg-cyan-400 px-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}
            </button>

            {editingId && (
              <button
                className="h-9 rounded border border-slate-700 px-3 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
                type="button"
                onClick={resetForm}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </aside>
    </div>
  )
}
