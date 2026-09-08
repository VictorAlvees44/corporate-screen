import express from 'express'
import cors from 'cors'
import path from 'path'
import { existsSync, readFileSync, watchFile } from 'fs'
import https from 'https'
import { fileURLToPath } from 'url'
import authRoutes from './routes/authRoutes'
import birthdayRoutes from './routes/birthdayRoutes'
import healthRoutes from './routes/healthRoutes'
import layoutRoutes from './routes/layoutRoutes'
import monitoringRoutes from './routes/monitoringRoutes'
import newsRoutes from './routes/newsRoutes'
import playerRoutes from './routes/playerRoutes'
import playlistRoutes from './routes/playlistRoutes'
import rankingRoutes from './routes/rankingRoutes'
import scheduleRoutes from './routes/scheduleRoutes'
import settingsRoutes from './routes/settingsRoutes'
import tvRoutes from './routes/tvRoutes'
import uploadRoutes from './routes/uploadRoutes'
import widgetRoutes from './routes/widgetRoutes'
import userRoutes from './routes/userRoutes'
import { errorHandler } from './middleware/errorHandler'
import { requireAuth } from './middleware/requireAuth'
import { auditLogger } from './middleware/auditLogger'
import { requireAdmin } from './middleware/requireAdmin'
import { securityHeaders } from './middleware/securityHeaders'
import { mediaContentType } from './utils/mediaValidation'
import { rejectCrossSiteMutation } from './middleware/requestSecurity'
import { startNetworkSampler } from './services/systemMonitor'
import { startNewsFeedScheduler } from './controllers/newsController'
import { startDailyBackupScheduler } from './services/backupScheduler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT ?? 3001
const LISTEN_HOST = process.env.LISTEN_HOST ?? '127.0.0.1'
const CLIENT_DIST_DIR = path.resolve(__dirname, '../../client/dist')
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
allowedOrigins.add(`http://localhost:${PORT}`)
allowedOrigins.add(`http://127.0.0.1:${PORT}`)
if (process.env.GOOGLE_OAUTH_REDIRECT_URI) allowedOrigins.add(new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI).origin)

app.disable('x-powered-by')
app.use(securityHeaders)
app.use('/api', rejectCrossSiteMutation(allowedOrigins))

app.use(
  cors({
    origin(origin, callback) {
      // Chamadas sem Origin (health check, proxy reverso e mesma origem) não
      // precisam de CORS. Origens de navegador precisam ser explicitamente
      // autorizadas via CORS_ORIGINS em produção.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true)
      return callback(null, false)
    },
  }),
)
// Limite padrão do Express (100kb) é pequeno demais para layouts que usam o
// componente "HTML customizado" (Etapa 10), que pode ter um bloco de
// HTML/CSS/JS relativamente grande embutido no próprio layout salvo.
app.use(express.json({ limit: '5mb' }))

// Arquivos enviados (imagens, vídeos, documentos, logos) ficam acessíveis
// publicamente via /uploads/*
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { setHeaders(res, file) {
  res.setHeader('Content-Type', mediaContentType(file))
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'")
} }))

app.use('/api/health', healthRoutes)
// O player e os widgets são públicos. A gestão fica protegida por sessão
// Google OAuth e pela lista de e-mails autorizados, inclusive via Cloudflare.
app.use('/api/auth', authRoutes)
app.use('/api/player', playerRoutes)
app.use('/api/widgets', widgetRoutes)
app.use('/api', auditLogger)
app.use('/api/layouts', requireAuth, layoutRoutes)
app.use('/api/playlists', requireAuth, playlistRoutes)
app.use('/api/schedules', requireAuth, scheduleRoutes)
app.use('/api/settings', requireAuth, requireAdmin, settingsRoutes)
app.use('/api/tvs', requireAuth, tvRoutes)
app.use('/api/uploads', requireAuth, uploadRoutes)
app.use('/api/birthdays', requireAuth, birthdayRoutes)
app.use('/api/rankings', requireAuth, rankingRoutes)
app.use('/api/news', requireAuth, newsRoutes)
app.use('/api/users', requireAuth, requireAdmin, userRoutes)
app.use('/api/monitoring', requireAuth, requireAdmin, monitoringRoutes)

// Alguns navegadores nativos de TVs Samsung/Tizen exibem o HTML, mas não
// executam corretamente a detecção de recursos do player moderno. O desvio no
// servidor garante que o endereço principal abra o player compatível, sem
// que o operador precise conhecer uma rota especial para cada modelo de TV.
app.get('/', (req, res, next) => {
  const userAgent = req.get('user-agent') ?? ''
  const isSmartTvBrowser = /smart-tv|smarttv|tizen|samsungbrowser/i.test(userAgent)
  if (isSmartTvBrowser) {
    return res.redirect(302, '/player-legacy.html')
  }
  return next()
})

// O endereço antigo deixa de ser uma página do produto, mas redireciona quem
// ainda o tiver memorizado. Novos dispositivos devem abrir apenas o domínio.
app.get(['/player', '/player/'], (_req, res) => res.redirect(308, '/'))

// TVs antigas costumam manter páginas estáticas em cache por muito tempo.
// O player legado precisa sempre buscar a versão atual, principalmente após
// correções de compatibilidade e do rodapé padrão.
app.get(['/player-legacy', '/player-legacy.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.sendFile(path.join(CLIENT_DIST_DIR, 'player-legacy.html'))
})

// Em produção, um único processo Node entrega também o build do frontend.
// Isso elimina a necessidade de manter o Vite aberto e permite acessar o
// sistema pela porta 3001 depois de `npm run build` + `npm run start`.
if (existsSync(CLIENT_DIST_DIR)) {
  app.use(express.static(CLIENT_DIST_DIR))
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html')))
}

// Middleware de erro deve ser o último a ser registrado
app.use(errorHandler)

const httpsKeyPath = process.env.HTTPS_KEY_PATH
const httpsCertPath = process.env.HTTPS_CERT_PATH
const useHttps = Boolean(httpsKeyPath && httpsCertPath)

const loadHttpsCredentials = () => ({
  key: readFileSync(httpsKeyPath!),
  cert: readFileSync(httpsCertPath!),
})

const server = useHttps ? https.createServer(loadHttpsCredentials(), app) : app

// O win-acme renova os arquivos PEM em segundo plano. Recarregar o contexto
// TLS evita que seja necessário reiniciar o servidor (e interromper as TVs)
// para que o novo certificado passe a valer.
if (useHttps && server instanceof https.Server) {
  let reloadTimer: NodeJS.Timeout | undefined
  const reloadCertificate = () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      try {
        server.setSecureContext(loadHttpsCredentials())
        console.log('[server] Certificado HTTPS recarregado com sucesso.')
      } catch (error) {
        console.error('[server] Não foi possível recarregar o certificado HTTPS:', error)
      }
    }, 1000)
  }

  watchFile(httpsKeyPath!, { interval: 5000 }, reloadCertificate)
  watchFile(httpsCertPath!, { interval: 5000 }, reloadCertificate)
}

server.listen(Number(PORT), LISTEN_HOST, () => {
  console.log(`[server] Corporate Screen rodando em ${useHttps ? 'https' : 'http'}://${LISTEN_HOST}:${PORT}`)
  startNetworkSampler()
  startNewsFeedScheduler()
  startDailyBackupScheduler()
})
