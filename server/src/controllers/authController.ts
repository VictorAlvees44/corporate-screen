import type { Request, Response } from 'express'
import { createWorkspaceAdminSession, deleteSession } from '../data/sessionStore'
import { findAuthorizedAdmin } from '../data/userRepository'
import { findAuthenticatedAdmin } from '../utils/adminAccess'
import { clearSessionCookie, getRequestCookie, getSessionToken, setSessionCookie, shouldUseSecureCookie } from '../utils/authSession'
import { consumeGoogleLoginAttempt, createGoogleLoginAttempt, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, verifyGoogleIdentity } from '../utils/googleOAuth'

interface GoogleTokenResponse {
  id_token?: string
}

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
    || 'http://localhost:3001/api/auth/google/callback'
  const workspaceDomain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase()

  return { clientId, clientSecret, redirectUri, workspaceDomain }
}

function isGoogleOAuthConfigured() {
  const { clientId, clientSecret, workspaceDomain } = getGoogleOAuthConfig()
  return Boolean(clientId && clientSecret && workspaceDomain)
}

function sendOAuthError(res: Response, status: number, message: string) {
  res.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Corporate Screen</title><body style="font-family:Arial,sans-serif;background:#020617;color:#e2e8f0;padding:40px"><h1>Não foi possível entrar</h1><p>${escapeHtml(message)}</p><p><a style="color:#67e8f9" href="/admin">Voltar ao painel</a></p></body></html>`)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

export async function getAuthProviders(_req: Request, res: Response) {
  res.json({
    google: isGoogleOAuthConfigured(),
    // Preserve these flags for cached clients, without any local fallback.
    emailLogin: false,
    passwordLogin: false,
    adminOnly: true,
  })
}

export async function startGoogleLogin(req: Request, res: Response) {
  const { clientId, clientSecret, redirectUri, workspaceDomain } = getGoogleOAuthConfig()
  if (!clientId || !clientSecret || !workspaceDomain) {
    return res.status(503).json({ message: 'Google OAuth ainda não foi configurado no servidor.' })
  }

  // Bind the cookie to the callback host, including access via workers.dev.
  const callbackUrl = new URL(redirectUri)
  if (req.get('host') !== callbackUrl.host || req.protocol !== callbackUrl.protocol.slice(0, -1)) {
    return res.redirect(302, new URL('/api/auth/google', callbackUrl.origin).toString())
  }
  const { state, nonce, codeChallenge } = await createGoogleLoginAttempt()
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true, secure: shouldUseSecureCookie(), sameSite: 'lax',
    path: '/api/auth/google', maxAge: OAUTH_STATE_TTL_MS,
  })

  const authorizationUrl = new URL(GOOGLE_AUTHORIZE_URL)
  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', 'openid email')
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('nonce', nonce)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  // Evita que o navegador reutilize silenciosamente uma conta Google errada
  // ou fique aguardando uma sessão antiga. O operador sempre vê a escolha da
  // conta corporativa no próprio fluxo de login.
  authorizationUrl.searchParams.set('prompt', 'select_account')
  if (workspaceDomain) authorizationUrl.searchParams.set('hd', workspaceDomain)

  return res.redirect(302, authorizationUrl.toString())
}

export async function completeGoogleLogin(req: Request, res: Response) {
  const { clientId, clientSecret, redirectUri, workspaceDomain } = getGoogleOAuthConfig()
  const code = typeof req.query.code === 'string' ? req.query.code : undefined
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined

  if (!clientId || !clientSecret || !workspaceDomain) return sendOAuthError(res, 503, 'Google OAuth ainda não foi configurado no servidor.')
  const attempt = await consumeGoogleLoginAttempt(state, getRequestCookie(req, OAUTH_STATE_COOKIE))
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true, secure: shouldUseSecureCookie(), sameSite: 'lax', path: '/api/auth/google',
  })
  if (!attempt) return sendOAuthError(res, 400, 'A validação do login expirou. Tente novamente.')
  if (oauthError) return sendOAuthError(res, 401, 'O login foi cancelado no Google.')
  if (!code) return sendOAuthError(res, 400, 'O Google não retornou um código de login. Tente novamente.')

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: attempt.codeVerifier,
      }),
    })
    const tokenData = await tokenResponse.json() as GoogleTokenResponse
    if (!tokenResponse.ok || !tokenData.id_token) {
      return sendOAuthError(res, 401, 'O Google não autorizou este acesso.')
    }

    let email: string
    try {
      email = await verifyGoogleIdentity(tokenData.id_token, clientId, workspaceDomain, attempt.nonce)
    } catch {
      return sendOAuthError(res, 403, 'Use uma conta corporativa autorizada.')
    }

    const authorized = await findAuthorizedAdmin(email)
    if (!authorized) return sendOAuthError(res, 403, 'Esta conta não está autorizada como Administrador no Corporate Screen.')

    const session = await createWorkspaceAdminSession(email)
    setSessionCookie(res, session.token)
    return res.redirect(303, '/admin')
  } catch {
    return sendOAuthError(res, 502, 'Não foi possível concluir o login com o Google. Tente novamente.')
  }
}

export async function getCurrentSession(req: Request, res: Response) {
  const token = getSessionToken(req)

  if (!token) {
    return res.status(401).json({ message: 'Não autenticado' })
  }

  const authorized = await findAuthenticatedAdmin(token)
  if (!authorized) {
    await deleteSession(token)
    clearSessionCookie(res)
    return res.status(401).json({ message: 'Acesso revogado' })
  }

  res.json({ user: authorized })
}

export async function rejectLegacyLogin(_req: Request, res: Response) {
  return res.status(410).json({ message: 'Login por senha removido. Entre com Google Workspace usando uma conta autorizada como Administrador.' })
}

export async function logout(req: Request, res: Response) {
  const token = getSessionToken(req)

  if (token) {
    await deleteSession(token)
  }

  clearSessionCookie(res)
  res.status(204).send()
}
