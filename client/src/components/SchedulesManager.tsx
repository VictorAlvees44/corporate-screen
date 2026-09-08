import { useEffect, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { Playlist, Schedule, ScheduleFormData, TV, Weekday } from '../types'

const DAYS: { value: Weekday; label: string }[] = [
  { value: 'dom', label: 'Dom' }, { value: 'seg', label: 'Seg' }, { value: 'ter', label: 'Ter' },
  { value: 'qua', label: 'Qua' }, { value: 'qui', label: 'Qui' }, { value: 'sex', label: 'Sex' }, { value: 'sab', label: 'Sáb' },
]

const EMPTY_FORM: ScheduleFormData = { tvId: '', playlistId: '', horaInicio: '07:30', horaFim: '18:00', diasSemana: ['seg', 'ter', 'qua', 'qui', 'sex'] }

export default function SchedulesManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [tvs, setTVs] = useState<TV[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [form, setForm] = useState<ScheduleFormData>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void Promise.all([api.listSchedules(), api.listTVs(), api.listPlaylists()])
      .then(([loadedSchedules, loadedTVs, loadedPlaylists]) => {
        setSchedules(loadedSchedules)
        setTVs(loadedTVs)
        setPlaylists(loadedPlaylists)
        setForm((current) => ({ ...current, tvId: current.tvId || loadedTVs[0]?.id || '', playlistId: current.playlistId || loadedPlaylists[0]?.id || '' }))
      })
      .catch(() => setMessage('Não foi possível carregar os agendamentos.'))
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const saved = editingId ? await api.updateSchedule(editingId, form) : await api.createSchedule(form)
      setSchedules((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
      setEditingId(null)
      setForm({ ...EMPTY_FORM, tvId: tvs[0]?.id || '', playlistId: playlists[0]?.id || '' })
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar o agendamento.')
    } finally {
      setSaving(false)
    }
  }

  function edit(schedule: Schedule) {
    setEditingId(schedule.id)
    setForm({ tvId: schedule.tvId, playlistId: schedule.playlistId, horaInicio: schedule.horaInicio, horaFim: schedule.horaFim, diasSemana: schedule.diasSemana })
  }

  async function remove(schedule: Schedule) {
    if (!window.confirm(`Remover o agendamento ${schedule.id}?`)) return
    setSaving(true)
    try {
      await api.deleteSchedule(schedule.id)
      setSchedules((current) => current.filter((item) => item.id !== schedule.id))
      if (editingId === schedule.id) setEditingId(null)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover o agendamento.')
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(day: Weekday) {
    setForm((current) => ({ ...current, diasSemana: current.diasSemana.includes(day) ? current.diasSemana.filter((item) => item !== day) : [...current.diasSemana, day] }))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="overflow-hidden rounded border border-slate-800 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-slate-900 text-slate-400"><tr><th className="px-4 py-3">TV</th><th className="px-4 py-3">Playlist</th><th className="px-4 py-3">Horário</th><th className="px-4 py-3">Dias</th><th className="px-4 py-3">Ações</th></tr></thead>
            <tbody>{schedules.map((schedule) => <tr className="border-t border-slate-800" key={schedule.id}>
              <td className="px-4 py-3 text-slate-200">{tvs.find((tv) => tv.id === schedule.tvId)?.nome || schedule.tvId}</td>
              <td className="px-4 py-3 text-slate-300">{playlists.find((playlist) => playlist.id === schedule.playlistId)?.nome || schedule.playlistId}</td>
              <td className="px-4 py-3 text-slate-300">{schedule.horaInicio}–{schedule.horaFim}</td>
              <td className="px-4 py-3 text-slate-400">{schedule.diasSemana.join(', ')}</td>
              <td className="flex gap-2 px-4 py-3"><button className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200" type="button" onClick={() => edit(schedule)}>Editar</button><button className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200" type="button" disabled={saving} onClick={() => void remove(schedule)}>Remover</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      <form className="grid h-fit gap-3 rounded border border-slate-800 bg-slate-900/60 p-4" onSubmit={(event) => void save(event)}>
        <h3 className="text-base font-semibold">{editingId ? 'Editar agendamento' : 'Novo agendamento'}</h3>
        <select className="h-10 rounded border border-slate-700 bg-slate-950 px-3 text-sm" value={form.tvId} onChange={(event) => setForm((current) => ({ ...current, tvId: event.target.value }))} required><option value="">Selecione a TV</option>{tvs.map((tv) => <option key={tv.id} value={tv.id}>{tv.nome} ({tv.id})</option>)}</select>
        <select className="h-10 rounded border border-slate-700 bg-slate-950 px-3 text-sm" value={form.playlistId} onChange={(event) => setForm((current) => ({ ...current, playlistId: event.target.value }))} required><option value="">Selecione a playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.nome}</option>)}</select>
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-400">Início<input className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm" type="time" value={form.horaInicio} onChange={(event) => setForm((current) => ({ ...current, horaInicio: event.target.value }))} required /></label><label className="text-xs text-slate-400">Fim<input className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm" type="time" value={form.horaFim} onChange={(event) => setForm((current) => ({ ...current, horaFim: event.target.value }))} required /></label></div>
        <div className="flex flex-wrap gap-2">{DAYS.map((day) => <label className="flex items-center gap-1 text-xs text-slate-300" key={day.value}><input type="checkbox" checked={form.diasSemana.includes(day.value)} onChange={() => toggleDay(day.value)} />{day.label}</label>)}</div>
        {message && <p className="text-sm text-red-200">{message}</p>}
        <div className="flex gap-2"><button className="h-10 flex-1 rounded bg-cyan-400 text-sm font-semibold text-slate-950 disabled:opacity-60" type="submit" disabled={saving}>{editingId ? 'Salvar' : 'Adicionar'}</button>{editingId && <button className="rounded border border-slate-700 px-3 text-sm" type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM) }}>Cancelar</button>}</div>
      </form>
    </div>
  )
}
