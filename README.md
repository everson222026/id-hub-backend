# ID HUB — versão corrigida para Neon + Render Free

## O que foi corrigido

- Removido o uso de `localhost:3000` do frontend.
- Login agora gera e salva JWT.
- Rotas de dados exigem autenticação.
- Cada turma pertence ao docente que a criou.
- Alunos ficam ligados à turma no PostgreSQL.
- Notas ficam na tabela `notas`.
- Frequências ficam na tabela `frequencias`.
- O backend inicializa/migra a estrutura do banco automaticamente ao iniciar.
- Turmas antigas que estavam somente no `localStorage` podem ser migradas automaticamente quando o banco do docente estiver vazio e o `localStorage` ainda existir no mesmo domínio.
- O painel continua usando o mesmo formato visual e o mesmo modelo de dados da interface.

## Arquivos principais

- `server.js` — API Express e inicialização do sistema.
- `schema.js` — criação/migração das tabelas do PostgreSQL.
- `db.js` — conexão com o Neon.
- `api.js` — comunicação do frontend com `/api` e envio do JWT.
- `login.html` — login corrigido para produção.
- `cadastro.html` — cadastro usando a API de produção.
- `docente.html` — painel gravando dados no Neon.
- `package.json` — dependências e comando de inicialização.
- `render.yaml` — configuração opcional do Render.

## Banco de dados

A estrutura principal é:

`usuarios` → `turmas` → `alunos` → `notas`
                               ↘ `frequencias`

A turma possui `professor_id`, evitando que um docente veja ou sobrescreva turmas de outro.

## 1. Neon

Crie ou use seu projeto PostgreSQL no Neon e copie a **connection string** da opção de conexão.

Crie um arquivo `.env` local (não envie esse arquivo para o GitHub):

```env
DATABASE_URL=COLE_AQUI_A_CONNECTION_STRING_DO_NEON
JWT_SECRET=COLE_AQUI_UMA_CHAVE_GRANDE_E_ALEATORIA
NODE_ENV=development
```

O `server.js` já executa a criação/migração da estrutura quando sobe, então não é obrigatório rodar `init-db.js` manualmente.

Para conferir manualmente:

```bash
node init-db.js
```

## 2. Testar localmente

Instale as dependências:

```bash
npm install
```

Inicie:

```bash
npm start
```

Abra:

`http://localhost:3000`

E teste:

`http://localhost:3000/api/health`

A resposta esperada é um JSON com `ok: true` e `database: "connected"`.

## 3. GitHub

Envie todos os arquivos do projeto para um repositório GitHub.

**Não envie `.env`.** O `.gitignore` já está preparado para impedir isso.

## 4. Render

No Render, crie um **Web Service** apontando para esse repositório.

Use:

- Build Command: `npm install`
- Start Command: `npm start`
- Plan: `Free`
- Health Check Path: `/api/health`

Adicione as variáveis de ambiente:

```text
DATABASE_URL = sua connection string do Neon
JWT_SECRET   = sua chave aleatória grande
NODE_ENV     = production
```

Depois do deploy, o próprio Render dará uma URL como:

`https://seu-app.onrender.com`

Como o frontend é servido pelo mesmo Express, o sistema chama `/api` e não precisa de `localhost` nem de uma URL fixa do backend.

## 5. Conferência final

1. Abra a URL do Render.
2. Cadastre um docente.
3. Faça login.
4. Crie uma turma.
5. Atualize a página.
6. A turma deve continuar aparecendo.
7. Adicione um aluno.
8. Lance uma frequência.
9. Veja no Neon as tabelas `turmas`, `alunos` e `frequencias`.

## Recuperação de senha

A recuperação de senha usa a API HTTPS do Resend, evitando dependência de SMTP no Render. Configure `RESEND_API_KEY` e `EMAIL_FROM` no Render. O endereço de `EMAIL_FROM` deve pertencer a um domínio verificado no Resend. O plano gratuito atual do Resend inclui até 3.000 e-mails por mês, com limite de 100 por dia.

O código de recuperação fica salvo no PostgreSQL com validade de 10 minutos, então ele não é perdido quando o Web Service do Render reinicia ou sai do modo de suspensão.

## Importante sobre os dados antigos

Se uma turma existia somente no `localStorage`, ela não estava realmente no Neon. A versão nova tenta migrar essas turmas automaticamente na primeira carga quando o banco ainda está vazio e o `localStorage` estiver disponível no mesmo domínio.

Se os dados antigos estavam em outro domínio/local, eles podem não estar mais disponíveis no navegador novo. Nesse caso, será necessário exportá-los do ambiente antigo antes da migração.

## Segurança

O arquivo `.env` recebido no projeto continha credenciais reais. Por segurança, considere essas credenciais expostas e gere uma nova senha/connection string do Neon e uma nova senha de aplicativo do e-mail antes de publicar.
