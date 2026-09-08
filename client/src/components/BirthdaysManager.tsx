import { useEffect, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { Birthday, BirthdayFormData } from '../types'

const EMPTY_FORM: BirthdayFormData = {
  nome: '',
  dia: 1,
  mes: 1,
  setor: '',
}

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * Gestão de aniversariantes (widget "Aniversários" do /designer). Componente
 * autocontido: carrega e gerencia seu próprio estado, sem depender do estado
 * gigante do AdminPage.
 */
export default function BirthdaysManager() {
  const [birthdays, setBirthdays] = useState<Birthday[]>([])
  const [form, setForm] = useState<BirthdayFormData>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      const result = await api.listBirthdays()
      setBirthdays(sortBirthdays(result))
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível carregar os aniversariantes')
    } finally {
      setStatus('idle')
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setMessage(null)

    try {
      const saved = editingId
        ? await api.updateBirthday(editingId, form)
        : await api.createBirthday(form)

      setBirthdays((current) => {
        const exists = current.some((item) => item.id === saved.id)
        const next = exists
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]
        return sortBirthdays(next)
      })
      resetForm()
      setMessage('Aniversariante salvo com sucesso.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar')
    } finally {
      setStatus('idle')
    }
  }

  async function handleDelete(birthday: Birthday) {
    if (!window.confirm(`Remover ${birthday.nome}?`)) return

    setStatus('saving')
    try {
      await api.deleteBirthday(birthday.id)
      setBirthdays((current) => current.filter((item) => item.id !== birthday.id))
      if (editingId === birthday.id) resetForm()
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover')
    } finally {
      setStatus('idle')
    }
  }

  function edit(birthday: Birthday) {
    setEditingId(birthday.id)
    setForm({
      nome: birthday.nome,
      dia: birthday.dia,
      mes: birthday.mes,
      setor: birthday.setor,
    })
    setMessage(null)
  }

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-base font-semibold">Aniversariantes cadastrados</h3>

        {status === 'loading' && <p className="mt-3 text-sm text-slate-400">Carregando...</p>}

        {status !== 'loading' && birthdays.length === 0 && (
          <p className="mt-3 text-sm text-slate-400">Nenhum aniversariante cadastrado ainda.</p>
        )}

        <ul className="mt-3 grid gap-2">
          {birthdays.map((birthday) => (
            <li
              key={birthday.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-slate-100">{birthday.nome}</span>
                <span className="ml-2 text-slate-400">
                  {String(birthday.dia).padStart(2, '0')}/{String(birthday.mes).padStart(2, '0')}
                  {birthday.setor && ` · ${birthday.setor}`}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                  type="button"
                  onClick={() => edit(birthday)}
                >
                  Editar
                </button>
                <button
                  className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200 hover:border-red-400"
                  type="button"
                  onClick={() => void handleDelete(birthday)}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <aside className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-base font-semibold">
          {editingId ? `Editar ${editingId}` : 'Cadastrar aniversariante'}
        </h3>

        <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Nome
            <input
              className="h-9 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-400"
              type="text"
              value={form.nome}
              onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Dia
              <input
                className="h-9 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-400"
                type="number"
                min={1}
                max={31}
                value={form.dia}
                onChange={(event) =>
                  setForm((current) => ({ ...current, dia: Number(event.target.value) }))
                }
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Mês
              <select
                className="h-9 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-400"
                value={form.mes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, mes: Number(event.target.value) }))
                }
              >
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Setor (opcional)
            <input
              className="h-9 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-cyan-400"
              type="text"
              value={form.setor}
              onChange={(event) => setForm((current) => ({ ...current, setor: event.target.value }))}
              placeholder="Comercial, RH, TI..."
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

function sortBirthdays(birthdays: Birthday[]): Birthday[] {
  return [...birthdays].sort((first, second) =>
    first.mes === second.mes ? first.dia - second.dia : first.mes - second.mes,
  )
}
