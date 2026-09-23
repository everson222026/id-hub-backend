# ID HUB — Revisão final

Data: 23/09/2026

Arquitetura ativa: Express + `pg` + PostgreSQL/Neon.

## Verificações executadas

- `node --check` em `server.js`, `schema.js`, `db.js` e `api.js`.
- `node --check` em todos os blocos JavaScript embutidos dos HTML principais.
- Conferência estrutural dos HTML e dos IDs DOM usados pelo JavaScript.
- Conferência dos contratos de API usados pelo frontend contra as rotas do `server.js`.
- Conferência de que o frontend não aponta mais para o backend Render antigo.
- Conferência de que não há credenciais de banco/e-mail no pacote.

## Persistência revisada

- Turmas são carregadas do banco autenticado do docente.
- Alunos são criados pela rota específica `/api/turmas/:id/alunos` e permanecem no Neon após recarregar.
- Edição e exclusão de aluno usam rotas específicas.
- Notas usam `/api/alunos/:id/notas`.
- Frequência usa as rotas próprias da turma/aluno.
- Atividade individual usa `PATCH /api/alunos/:id`.
- Atividade para a turma inteira usa `POST /api/turmas/:id/atividades-gerais`, com atualização transacional no PostgreSQL.

## Observação

Não foi feita uma conexão ao Neon real nesta revisão porque as credenciais de produção não devem ser embutidas no pacote. A validação de banco foi feita por inspeção do código, esquema, consultas, rotas e contratos do frontend/backend.
