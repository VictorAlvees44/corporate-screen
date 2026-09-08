import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTH_COOKIE_NAME, getSessionToken } from '../dist/utils/authSession.js'

function requestWithHeaders(headers) {
  return {
    header(name) {
      return headers[name.toLowerCase()]
    },
  }
}

test('lê sessão do cookie HttpOnly', () => {
  const req = requestWithHeaders({ cookie: `theme=dark; ${AUTH_COOKIE_NAME}=token%20seguro` })
  assert.equal(getSessionToken(req), 'token seguro')
})

test('ignora token Bearer legado e usa somente o cookie protegido', () => {
  const req = requestWithHeaders({
    authorization: 'Bearer token-antigo',
  })
  assert.equal(getSessionToken(req), null)
})

test('rejeita cookie malformado', () => {
  const req = requestWithHeaders({ cookie: `${AUTH_COOKIE_NAME}=%E0%A4%A` })
  assert.equal(getSessionToken(req), null)
})
