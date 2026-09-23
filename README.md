# ID HUB — PostgreSQL/Neon + Render

Esta versão usa **Express + PostgreSQL (`pg`) + Neon**. Prisma não é usado pelo servidor e não é necessário para o deploy.

## Correções incluídas

- Frontend e backend usam `/api` e não dependem de `localhost:3000` em produção.
- O Express serve as páginas HTML que estão na raiz do projeto.
- Cadastro usa os mesmos campos aceitos pelo backend (`nome`, `email`, `telefone`, `senha`, `tipo`).
- Login salva JWT e os dados reais retornados pelo backend (`usuario`).
- Perfil docente usa os mesmos campos em frontend e backend.
- Cada turma pertence ao docente autenticado.
- Turmas, alunos, matérias, notas, frequências e atividades são sincronizados com o PostgreSQL/Neon.
- A estrutura antiga do `localStorage` continua sendo aceita para uma migração inicial.
- IDs do navegador ficam em `client_id`, enquanto o PostgreSQL continua usando seus IDs internos.
- Notas são armazenadas na tabela `notas` e reconstruídas no formato usado pela tela docente.
- Frequências são armazenadas na tabela `frequencias` e reconstruídas no histórico usado pela tela docente.
- Recuperação de senha usa Nodemailer + Brevo SMTP, com código de 6 dígitos válido por 15 minutos.
- Tokens de recuperação são armazenados como hash SHA-256 no banco.
- Dados de um docente não podem ser carregados ou sobrescritos por outro docente usando os mesmos IDs do navegador.

## Arquivos principais

- `server.js` — API Express, autenticação, turmas, alunos, notas, frequências e recuperação de senha.
- `schema.js` — criação e migração das tabelas PostgreSQL.
- `db.js` — conexão com o Neon.
- `api.js` — cliente JavaScript da API e envio do JWT.
- `login.html` — login e recuperação de senha.
- `cadastro.html` — cadastro de usuário.
- `docente.html` — painel docente, turmas, alunos e frequência.
- `notas-atividades-docente.html` — notas, matérias e atividades.
- `render.yaml` — configuração do Render.

## Banco de dados

A estrutura principal é:

```text
USUÁRIO/DOCENTE
      │
      └── TURMAS
            │
            └── ALUNOS
                  ├── NOTAS
                  └── FREQUÊNCIAS
```

As tabelas utilizadas são:

```text
usuarios
turmas
alunos
notas
frequencias
password_reset_tokens
```

O `schema.js` foi preparado para adicionar e migrar colunas de versões anteriores sem exigir que o banco seja apagado.

## Configuração local

Crie um `.env` local e não envie esse arquivo para o GitHub:

```env
DATABASE_URL=SUA_CONNECTION_STRING_DO_NEON
JWT_SECRET=UMA_CHAVE_GRANDE_E_ALEATORIA
NODE_ENV=development

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=SEU_USUARIO_SMTP
SMTP_PASS=SUA_SENHA_SMTP
EMAIL_FROM=SEU_EMAIL_VERIFICADO
```

Instale e execute:

```bash
npm install
npm start
```

Abra:

```text
http://localhost:3000
```

Teste a API:

```text
http://localhost:3000/api/health
```

## Render

Use:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Configure as variáveis de ambiente:

```text
DATABASE_URL
JWT_SECRET
NODE_ENV=production
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER
SMTP_PASS
EMAIL_FROM
```

O `DATABASE_URL` deve ser a connection string do Neon.

O `EMAIL_FROM` deve ser um endereço permitido/verificado pelo seu provedor de e-mail.

## Fluxo para conferir o sistema

1. Abra o endereço do Render.
2. Cadastre um docente.
3. Faça login.
4. Crie uma turma.
5. Atualize a página.
6. Confira se a turma continua aparecendo.
7. Adicione um aluno.
8. Atualize a página novamente.
9. Abra notas e atividades do aluno.
10. Lance uma frequência.
11. Confira no Neon as tabelas `turmas`, `alunos`, `notas` e `frequencias`.

## Arquitetura do banco

Esta versão usa exclusivamente `pg` + PostgreSQL/Neon. Prisma não faz parte do runtime nem do deploy deste projeto.

Arquivos de console/exportação ou configurações antigas do Prisma não devem ser enviados para produção.

## Segurança

Nunca publique `.env` ou credenciais de banco/e-mail no GitHub. Como credenciais reais já apareceram no material anterior do projeto, é recomendado gerar novas credenciais antes do próximo deploy.
