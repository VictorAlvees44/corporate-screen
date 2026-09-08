import { useEffect, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { AuthorizedUser } from '../types'

export default function UsersManager({ currentUserEmail }: { currentUserEmail: string }) {
  const [users, setUsers] = useState<AuthorizedUser[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AuthorizedUser['role']>('admin')
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.listAuthorizedUsers().then(setUsers).catch(() => {
      setMessageTone('error')
      setMessage('Não foi possível carregar os usuários.')
    })
  }, [])

  async function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      setUsers(await api.addAuthorizedUser(email, role))
      setMessageTone('success')
      setMessage(`${email.trim().toLowerCase()}: ${role === 'admin' ? 'Administrador autorizado a entrar pelo Workspace' : 'Editor, sem acesso ao painel administrativo'}.`)
      setEmail('')
    } catch (error) {
      setMessageTone('error')
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível adicionar o usuário.')
    } finally {
      setSaving(false)
    }
  }

  async function removeUser(user: AuthorizedUser) {
    if (!window.confirm(`Remover o acesso de ${user.email}?`)) return
    setSaving(true)
    setMessage(null)
    try {
      await api.deleteAuthorizedUser(user.email)
      setUsers((current) => current.filter((item) => item.email !== user.email))
      setMessageTone('success')
      setMessage(`O acesso de ${user.email} foi removido.`)
    } catch (error) {
      setMessageTone('error')
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover o usuário.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded border border-cyan-500/30 bg-cyan-500/5 p-4">
        <h3 className="text-sm font-semibold text-cyan-100">Como funcionam as permissões</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">Somente os e-mails cadastrados como Administrador podem entrar no painel e gerenciar TVs, conteúdos, usuários e configurações. Contas com perfil Editor não têm acesso ao painel nem às APIs administrativas.</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">O acesso é exclusivo pelo Google Workspace da empresa. Não existe senha compartilhada nem login somente por e-mail. Remover uma conta ou retirar seu perfil Administrador revoga o acesso nas próximas requisições.</p>
      </section>
      <section className="grid gap-4 rounded border border-slate-800 bg-slate-900/60 p-4">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void addUser(event)}>
        <input aria-label="E-mail corporativo" className="h-10 flex-1 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.example" required />
        <select aria-label="Permissão de acesso" className="h-10 rounded border border-slate-700 bg-slate-950 px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as AuthorizedUser['role'])}><option value="admin">Administrador — acesso ao painel</option><option value="editor">Editor — sem acesso ao painel</option></select>
        <button className="h-10 rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 disabled:opacity-60" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar permissão'}</button>
      </form>
      {message && <p className={`rounded border px-3 py-2 text-sm ${messageTone === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>{message}</p>}
      <ul className="divide-y divide-slate-800 rounded border border-slate-800">
        {users.map((user) => (
          <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={user.email}>
            <span className="break-all text-slate-200">{user.email} <span className="text-xs text-slate-500">({user.role === 'admin' ? 'administrador' : 'editor — sem acesso ao painel'})</span>{user.email === currentUserEmail && <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">Você</span>}</span>
            <button className="shrink-0 rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:border-red-400 disabled:opacity-60" type="button" disabled={saving || user.email === currentUserEmail} title={user.email === currentUserEmail ? 'Você não pode remover o próprio acesso' : undefined} onClick={() => void removeUser(user)}>Remover</button>
          </li>
        ))}
      </ul>
      </section>
    </div>
  )
}
