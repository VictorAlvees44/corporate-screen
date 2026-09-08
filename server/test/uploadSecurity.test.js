import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedMediaFile, MAX_UPLOAD_SIZE_BYTES } from '../dist/controllers/uploadController.js'

test('aceita formatos de mídia esperados', () => {
  assert.equal(isAllowedMediaFile('comunicado.jpg', 'image/jpeg'), true)
  assert.equal(isAllowedMediaFile('video.mp4', 'video/mp4'), true)
  assert.equal(isAllowedMediaFile('manual.pdf', 'application/pdf'), true)
})

test('rejeita SVG, HTML e combinação de MIME incompatível', () => {
  assert.equal(isAllowedMediaFile('ataque.svg', 'image/svg+xml'), false)
  assert.equal(isAllowedMediaFile('ataque.jpg', 'text/html'), false)
  assert.equal(isAllowedMediaFile('imagem.jpg', 'video/mp4'), false)
})

test('mantém limite de upload positivo', () => {
  assert.ok(MAX_UPLOAD_SIZE_BYTES > 0)
})
