import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Todas as chamadas /api são redirecionadas para o backend Express
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Arquivos enviados (imagens, vídeos, documentos, logos) também vivem no
      // backend. Sem este proxy, o <img>/<video> do player não encontra o
      // arquivo em desenvolvimento (o Vite responde antes do Express).
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
