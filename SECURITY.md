# Segurança

## Dados deliberadamente ausentes

Este repositório não contém:

- histórico Git do ambiente operacional;
- domínio, zona, Account ID, Database ID ou Tunnel ID reais;
- Client ID, Client Secret, token Cloudflare ou arquivo OAuth;
- e-mails, usuários, sessões ou tokens de players reais;
- cadastro, telemetria ou identificação das TVs;
- uploads, logos, imagens, vídeos, logs, backups ou exports do D1/R2;
- nomes de pessoas ou caminhos internos da instalação de origem.

Os UUIDs zerados e os endereços em `example.com` são placeholders não funcionais.

## Modelo de acesso

- O login por senha local está desativado.
- OAuth só fica ativo após o proprietário configurar suas próprias credenciais.
- Pertencer ao domínio Workspace não basta: a conta precisa estar na lista explícita e ter perfil `admin` para administrar usuários e ações sensíveis.
- A sessão usa cookie HttpOnly, Secure e SameSite.
- O valor bruto da sessão não é persistido; o armazenamento mantém hash.
- Cada player tem um token exclusivo e precisa ser aprovado.
- D1 persiste limites de tentativas relevantes; o Worker aplica CSP e cabeçalhos defensivos.

## Checklist antes de publicar uma derivação

1. Comece de um histórico novo; não copie `.git` de uma instalação real.
2. Execute `npm run audit:repo` e uma ferramenta de secret scanning no GitHub.
3. Revise `git ls-files` e confirme que `.env`, `.dev.vars`, `server/config/*.json`, uploads e backups não aparecem.
4. Procure por domínio, organização, nomes, e-mails, IDs e URLs internas.
5. Ative proteção de branch, Dependabot e secret scanning.
6. Mantenha MFA e privilégios mínimos nas contas externas.
7. Se um segredo tiver sido versionado, revogue-o primeiro; remover apenas o arquivo não elimina cópias do histórico.

## Relato responsável

Não publique vulnerabilidades com credenciais, dados pessoais ou detalhes de uma instalação. Abra um relato privado ao mantenedor do fork correspondente.
