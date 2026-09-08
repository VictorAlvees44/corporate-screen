export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  NODE_ENV: string
  COOKIE_SECURE: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REDIRECT_URI?: string
  GOOGLE_WORKSPACE_DOMAIN?: string
}
