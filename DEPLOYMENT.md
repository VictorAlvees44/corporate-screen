# Implantação técnica

Este guia cria uma instalação nova do Corporate Screen na Cloudflare. Nenhum valor da instalação original está presente neste repositório. Substitua todos os nomes de exemplo por recursos sob seu controle.

## 1. Pré-requisitos

- Node.js 24 LTS ou versão indicada em `.github/workflows/quality.yml`.
- npm.
- Conta Cloudflare com Workers, D1 e R2 habilitados.
- Um domínio administrado na mesma conta Cloudflare, se desejar endereço próprio.
- Projeto no Google Cloud e uma conta Google Workspace para o acesso administrativo.
- MFA habilitado nas contas Cloudflare, Google e GitHub.

Valide o código antes de criar recursos externos:

```bash
npm ci
npm run check
npm run check:cloudflare
npm run audit:prod
```

## 2. Autenticar o Wrangler

```bash
npx wrangler login
npx wrangler whoami
```

Não copie tokens do navegador, não grave tokens em scripts e não versione a pasta `.wrangler`.

## 3. Criar o D1

```bash
npx wrangler d1 create corporate-screen
```

Copie somente o `database_id` retornado para `wrangler.jsonc`, substituindo o UUID zerado. O ID identifica o recurso, mas ainda assim não deve ser reaproveitado em um repositório-modelo compartilhado por várias instalações.

Aplique as migrations:

```bash
npx wrangler d1 migrations apply corporate-screen --remote
```

## 4. Criar o bucket R2

```bash
npx wrangler r2 bucket create corporate-screen-media
```

Se escolher outro nome, atualize `bucket_name` em `wrangler.jsonc`. Mantenha o binding `MEDIA`, pois é o nome usado pelo Worker.

## 5. Registrar OAuth próprio

O modelo é publicado sem Client ID, Client Secret, domínio Workspace ou e-mail autorizado. Cada instalação deve criar suas próprias credenciais.

No Google Cloud Console:

1. Crie ou selecione um projeto sob sua organização.
2. Configure a tela de consentimento para uso interno, quando aplicável.
3. Crie um cliente OAuth 2.0 do tipo **Aplicativo da Web**.
4. Adicione uma URI exata de redirecionamento, por exemplo:

   ```text
   https://screens.example.com/api/auth/google/callback
   ```

5. Guarde o Client Secret em um gerenciador de segredos. Nunca o coloque em `wrangler.jsonc`, `.env.example`, issue, commit ou workflow.

Grave os quatro valores diretamente como secrets do Worker:

```bash
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REDIRECT_URI
npx wrangler secret put GOOGLE_WORKSPACE_DOMAIN
```

O domínio Workspace é usado como uma primeira restrição, mas não concede acesso sozinho. O usuário também precisa constar explicitamente como administrador no D1.

## 6. Registrar o primeiro administrador

Não inclua o e-mail real em Git. Crie localmente `server/config/users.json` com o conteúdo abaixo, substituindo o exemplo:

```json
[
  {
    "email": "admin@empresa.example",
    "role": "admin"
  }
]
```

O arquivo está coberto pelo `.gitignore`. Gere e confira o seed local:

```bash
node worker/scripts/create-seed.mjs .codex-run/initial-admin.sql
```

Confirme que o SQL contém somente dados fictícios ou pertencentes à sua própria instalação. Em uma instalação nova, importe uma única vez:

```bash
npx wrangler d1 execute corporate-screen --remote --file .codex-run/initial-admin.sql
```

Não repita essa importação sobre uma instalação já operada pelo painel sem revisar o SQL: o seed atualiza registros correspondentes.

## 7. Testar no subdomínio workers.dev

Compile e publique inicialmente sem rota personalizada:

```bash
npm run deploy:cloudflare
npx wrangler deployments list
```

Atualize temporariamente `GOOGLE_OAUTH_REDIRECT_URI` e a URI autorizada no Google para o endereço exato de teste, se for validar o login em `workers.dev`. A URI deve coincidir byte por byte, incluindo HTTPS, host e caminho.

Testes mínimos:

```bash
curl -i https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev/api/health
curl -i https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev/api/auth/providers
```

Resultado esperado: saúde HTTP 200; provedor Google aparece configurado depois dos secrets. Uma rota administrativa sem sessão deve responder 401.

## 8. Associar domínio próprio

Edite `wrangler.jsonc` e acrescente uma rota sob seu próprio domínio:

```jsonc
"routes": [
  {
    "pattern": "screens.example.com/*",
    "zone_name": "example.com"
  }
]
```

Troque `screens.example.com` e `example.com` pelos seus valores. Não publique novamente essas alterações em um repositório que continuará sendo um modelo genérico.

Atualize no Google Cloud a URI autorizada e grave o callback definitivo:

```bash
npx wrangler secret put GOOGLE_OAUTH_REDIRECT_URI
npm run deploy:cloudflare
```

Depois verifique:

- `/api/health` responde 200.
- `/admin` encaminha para o OAuth próprio.
- Uma conta do domínio, mas não listada no D1, é rejeitada.
- O administrador inicial entra e consegue incluir outros administradores.
- Uma TV nova aparece como pendente antes da aprovação.
- Upload, reprodução, atualização individual e telemetria funcionam.

## 9. Operação e observabilidade

```bash
npx wrangler deployments list
npx wrangler tail corporate-screen
npx wrangler d1 migrations list corporate-screen --remote
```

Evite registrar corpos de requisição, cookies, tokens de player, e-mails ou URLs privadas. O painel mostra apenas o diagnóstico necessário à operação.

## 10. Atualização e rollback

Antes de atualizar:

```bash
git pull --ff-only
npm ci
npm run check
npm run check:cloudflare
npm run deploy:cloudflare
```

Se a nova implantação falhar, localize uma versão anterior e faça rollback usando os comandos suportados pela versão instalada do Wrangler:

```bash
npx wrangler deployments list
npx wrangler rollback
```

Migrations D1 devem ser aditivas. Não considere rollback do Worker como rollback automático do banco.

## 11. Instalação local opcional

O backend Express existe para desenvolvimento/contingência e escuta `127.0.0.1` por padrão. Copie `.env.example` para `.env`, preencha somente valores próprios e execute:

```bash
npm run dev
```

Não abra a porta do backend diretamente na internet. A implantação recomendada é o Worker com HTTPS da Cloudflare.
