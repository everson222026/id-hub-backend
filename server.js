require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const db = require('./db');
const { ensureDatabase } = require('./schema');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? null
    : 'id-hub-secret-local'
);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não está configurado para produção.');
}

const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Os HTML/JS do projeto ficam na raiz do repositório.
const publicPages = [
  'index.html',
  'login.html',
  'cadastro.html',
  'docente.html',
  'notas-atividades-docente.html',
  'sobre.html'
];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

publicPages.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, page));
  });
});

app.get('/api.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'api.js'));
});

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token não informado ou inválido.' });
  }

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizarTexto(texto) {
  return String(texto ?? '').trim();
}

function clientIdOrNew(value, prefix) {
  const text = normalizarTexto(value);
  if (text) return text.slice(0, 100);
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function num(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function gerarCodigoRecuperacao() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCodigo(codigo) {
  return crypto.createHash('sha256').update(String(codigo)).digest('hex');
}

function enviarErro(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

async function getTurmasDoDocente(docenteId) {
  const turmaResult = await db.query(
    `
      SELECT
        t.id,
        t.client_id,
        t.nome,
        t.turno,
        t.badge_class,
        t.descricao,
        t.tipo_periodo,
        t.qtd_periodo,
        t.media_aprovacao,
        t.materias,
        t.professor_nome,
        t.professor_foto,
        t.created_at
      FROM turmas t
      WHERE t.docente_id = $1
      ORDER BY t.created_at DESC, t.id DESC
    `,
    [docenteId]
  );

  if (!turmaResult.rows.length) return [];

  const turmaIds = turmaResult.rows.map((row) => row.id);

  const alunoResult = await db.query(
    `
      SELECT
        a.id,
        a.client_id,
        a.turma_id,
        a.nome,
        a.matricula,
        a.nascimento,
        a.telefone,
        a.email,
        a.endereco,
        a.observacoes,
        a.foto,
        a.faltas,
        a.atividades,
        a.created_at
      FROM alunos a
      INNER JOIN turmas t ON t.id = a.turma_id
      WHERE t.docente_id = $1
      ORDER BY a.created_at ASC, a.id ASC
    `,
    [docenteId]
  );

  const alunoIds = alunoResult.rows.map((row) => row.id);
  const notasPorAluno = new Map();
  const frequenciasPorAluno = new Map();

  if (alunoIds.length) {
    const notas = await db.query(
      `
        SELECT id, aluno_id, materia, valor, bimestre, atividade, created_at
        FROM notas
        WHERE aluno_id = ANY($1::int[])
        ORDER BY id ASC
      `,
      [alunoIds]
    );

    for (const row of notas.rows) {
      if (!notasPorAluno.has(row.aluno_id)) notasPorAluno.set(row.aluno_id, {});
      const materia = row.materia || row.disciplina;
      if (!materia) continue;
      const periodo = row.bimestre || 'B1';
      if (!notasPorAluno.get(row.aluno_id)[materia]) {
        notasPorAluno.get(row.aluno_id)[materia] = {};
      }
      notasPorAluno.get(row.aluno_id)[materia][periodo] = String(row.valor ?? row.nota ?? '');
    }

    const frequencias = await db.query(
      `
        SELECT id, aluno_id, data, presente, created_at
        FROM frequencias
        WHERE aluno_id = ANY($1::int[])
        ORDER BY data ASC, id ASC
      `,
      [alunoIds]
    );

    for (const row of frequencias.rows) {
      if (!frequenciasPorAluno.has(row.aluno_id)) frequenciasPorAluno.set(row.aluno_id, {});
      const data = row.data instanceof Date
        ? row.data.toISOString().slice(0, 10)
        : String(row.data).slice(0, 10);
      frequenciasPorAluno.get(row.aluno_id)[data] = Boolean(row.presente);
    }
  }

  const alunosPorTurma = new Map();
  for (const turmaId of turmaIds) alunosPorTurma.set(turmaId, []);

  for (const row of alunoResult.rows) {
    alunosPorTurma.get(row.turma_id)?.push({
      id: row.client_id,
      nome: row.nome,
      matricula: row.matricula || 'Não informado',
      nascimento: row.nascimento || 'Não informado',
      telefone: row.telefone || 'Não informado',
      email: row.email || 'Não informado',
      endereco: row.endereco || 'Não informado',
      observacoes: row.observacoes || '',
      foto: row.foto || 'https://via.placeholder.com/150',
      faltas: Number(row.faltas || 0),
      historicoFrequencia: frequenciasPorAluno.get(row.id) || {},
      notas: notasPorAluno.get(row.id) || {},
      atividades: Array.isArray(row.atividades) ? row.atividades : []
    });
  }

  return turmaResult.rows.map((row) => ({
    id: row.client_id,
    nome: row.nome,
    turno: row.turno || 'Matutino',
    badgeClass: row.badge_class || String(row.turno || 'matutino').toLowerCase(),
    descricao: row.descricao || '',
    tipoPeriodo: row.tipo_periodo || 'bimestre',
    qtdPeriodo: Number(row.qtd_periodo || 4),
    mediaAprovacao: Number(row.media_aprovacao || 6),
    materias: Array.isArray(row.materias) ? row.materias : [],
    professorNome: row.professor_nome || '',
    professorFoto: row.professor_foto || null,
    alunos: alunosPorTurma.get(row.id) || []
  }));
}

async function obterAlunoDoDocente(client, docenteId, identificador) {
  const valor = normalizarTexto(identificador);
  const numericId = /^\d+$/.test(valor) ? Number(valor) : null;

  const result = await client.query(
    `
      SELECT
        a.id,
        a.client_id,
        a.turma_id
      FROM alunos a
      INNER JOIN turmas t ON t.id = a.turma_id
      WHERE t.docente_id = $1
        AND (a.client_id = $2 OR ($3::int IS NOT NULL AND a.id = $3))
      LIMIT 1
    `,
    [docenteId, valor, numericId]
  );

  return result.rows[0] || null;
}

async function salvarTurmasDoDocente(docenteId, turmasInput) {
  const turmas = Array.isArray(turmasInput) ? turmasInput : [];
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const incomingTurmaIds = [];
    const incomingTurmaDbIds = [];

    for (const turmaInput of turmas) {
      const clientId = clientIdOrNew(turmaInput.id || turmaInput.client_id, 'turma');
      const nome = normalizarTexto(turmaInput.nome);
      if (!nome) continue;

      const turno = normalizarTexto(turmaInput.turno) || 'Matutino';
      const badgeClass = normalizarTexto(turmaInput.badgeClass || turmaInput.badge_class) || turno.toLowerCase();
      const descricao = normalizarTexto(turmaInput.descricao) || null;
      const tipoPeriodo = normalizarTexto(turmaInput.tipoPeriodo || turmaInput.tipo_periodo) || 'bimestre';
      const qtdPeriodo = Math.max(1, Math.trunc(num(turmaInput.qtdPeriodo ?? turmaInput.qtd_periodo, 4)) || 4);
      const mediaAprovacao = num(turmaInput.mediaAprovacao ?? turmaInput.media_aprovacao, 6);
      const materias = Array.isArray(turmaInput.materias) ? turmaInput.materias.map(normalizarTexto).filter(Boolean) : [];
      const professorNome = normalizarTexto(turmaInput.professorNome || turmaInput.professor_nome) || null;
      const professorFoto = turmaInput.professorFoto || turmaInput.professor_foto || null;

      const existing = await client.query(
        `SELECT id, docente_id FROM turmas WHERE client_id = $1 LIMIT 1`,
        [clientId]
      );

      if (existing.rows.length && Number(existing.rows[0].docente_id) !== Number(docenteId)) {
        const err = new Error('Uma das turmas pertence a outro docente.');
        err.status = 409;
        throw err;
      }

      const turmaResult = await client.query(
        `
          INSERT INTO turmas
            (
              client_id,
              nome,
              turno,
              badge_class,
              descricao,
              tipo_periodo,
              qtd_periodo,
              media_aprovacao,
              materias,
              professor_nome,
              professor_foto,
              docente_id,
              professor_id
            )
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $12)
          ON CONFLICT (client_id)
          DO UPDATE SET
            nome = EXCLUDED.nome,
            turno = EXCLUDED.turno,
            badge_class = EXCLUDED.badge_class,
            descricao = EXCLUDED.descricao,
            tipo_periodo = EXCLUDED.tipo_periodo,
            qtd_periodo = EXCLUDED.qtd_periodo,
            media_aprovacao = EXCLUDED.media_aprovacao,
            materias = EXCLUDED.materias,
            professor_nome = EXCLUDED.professor_nome,
            professor_foto = EXCLUDED.professor_foto,
            docente_id = EXCLUDED.docente_id,
            professor_id = EXCLUDED.professor_id
          WHERE turmas.docente_id = EXCLUDED.docente_id
          RETURNING id, client_id
        `,
        [
          clientId,
          nome,
          turno,
          badgeClass,
          descricao,
          tipoPeriodo,
          qtdPeriodo,
          mediaAprovacao,
          JSON.stringify(materias),
          professorNome,
          professorFoto,
          docenteId
        ]
      );

      if (!turmaResult.rows.length) {
        const err = new Error('Não foi possível atualizar a turma.');
        err.status = 409;
        throw err;
      }

      const turmaDbId = turmaResult.rows[0].id;
      incomingTurmaIds.push(clientId);
      incomingTurmaDbIds.push(turmaDbId);

      const alunos = Array.isArray(turmaInput.alunos) ? turmaInput.alunos : [];
      const incomingAlunoIds = [];

      for (const alunoInput of alunos) {
        const alunoNome = normalizarTexto(alunoInput.nome);
        if (!alunoNome) continue;

        const alunoClientId = clientIdOrNew(alunoInput.id || alunoInput.client_id, 'aluno');
        const alunoExisting = await client.query(
          `
            SELECT a.id, t.docente_id, a.turma_id
            FROM alunos a
            INNER JOIN turmas t ON t.id = a.turma_id
            WHERE a.client_id = $1
            LIMIT 1
          `,
          [alunoClientId]
        );

        if (alunoExisting.rows.length && Number(alunoExisting.rows[0].docente_id) !== Number(docenteId)) {
          const err = new Error('Um dos alunos pertence a outro docente.');
          err.status = 409;
          throw err;
        }

        const nascimento = normalizarTexto(alunoInput.nascimento) || null;
        const telefone = normalizarTexto(alunoInput.telefone) || null;
        const email = normalizarTexto(alunoInput.email) || null;
        const matricula = normalizarTexto(alunoInput.matricula) || null;
        const endereco = normalizarTexto(alunoInput.endereco) || null;
        const observacoes = normalizarTexto(alunoInput.observacoes) || null;
        const foto = alunoInput.foto || null;
        const faltas = Math.max(0, Math.trunc(num(alunoInput.faltas, 0)) || 0);
        const atividades = Array.isArray(alunoInput.atividades) ? alunoInput.atividades : [];

        let alunoDbId;
        if (alunoExisting.rows.length) {
          const update = await client.query(
            `
              UPDATE alunos
              SET
                turma_id = $1,
                nome = $2,
                matricula = $3,
                nascimento = $4,
                telefone = $5,
                email = $6,
                endereco = $7,
                observacoes = $8,
                foto = $9,
                faltas = $10,
                atividades = $11::jsonb
              WHERE id = $12
              RETURNING id
            `,
            [turmaDbId, alunoNome, matricula, nascimento, telefone, email, endereco, observacoes, foto, faltas, JSON.stringify(atividades), alunoExisting.rows[0].id]
          );
          alunoDbId = update.rows[0].id;
        } else {
          const insert = await client.query(
            `
              INSERT INTO alunos
                (
                  client_id,
                  turma_id,
                  nome,
                  matricula,
                  nascimento,
                  telefone,
                  email,
                  endereco,
                  observacoes,
                  foto,
                  faltas,
                  atividades
                )
              VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
              RETURNING id
            `,
            [alunoClientId, turmaDbId, alunoNome, matricula, nascimento, telefone, email, endereco, observacoes, foto, faltas, JSON.stringify(atividades)]
          );
          alunoDbId = insert.rows[0].id;
        }

        incomingAlunoIds.push(alunoClientId);

        // O frontend trabalha com notas no formato:
        // { MATÉRIA: { B1: "8.5", B2: "7" } }
        await client.query('DELETE FROM notas WHERE aluno_id = $1', [alunoDbId]);
        const notas = alunoInput.notas && typeof alunoInput.notas === 'object' ? alunoInput.notas : {};
        for (const [materia, periodos] of Object.entries(notas)) {
          if (!materia || !periodos || typeof periodos !== 'object') continue;
          for (const [bimestre, valorRaw] of Object.entries(periodos)) {
            const valor = num(valorRaw, null);
            if (valor === null) continue;
            await client.query(
              `
                INSERT INTO notas
                  (aluno_id, materia, valor, bimestre, atividade, disciplina, nota, descricao)
                VALUES
                  ($1, $2, $3, $4, NULL, $2, $3, NULL)
              `,
              [alunoDbId, normalizarTexto(materia), valor, normalizarTexto(bimestre) || null]
            );
          }
        }

        // Frequência é normalizada no PostgreSQL.
        await client.query('DELETE FROM frequencias WHERE aluno_id = $1', [alunoDbId]);
        const historico = alunoInput.historicoFrequencia && typeof alunoInput.historicoFrequencia === 'object'
          ? alunoInput.historicoFrequencia
          : {};
        for (const [data, presenteRaw] of Object.entries(historico)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
          await client.query(
            `
              INSERT INTO frequencias (aluno_id, data, presente)
              VALUES ($1, $2, $3)
              ON CONFLICT (aluno_id, data)
              DO UPDATE SET presente = EXCLUDED.presente
            `,
            [alunoDbId, data, bool(presenteRaw)]
          );
        }
      }

      if (incomingAlunoIds.length) {
        await client.query(
          `
            DELETE FROM alunos
            WHERE turma_id = $1
              AND NOT (client_id = ANY($2::text[]))
          `,
          [turmaDbId, incomingAlunoIds]
        );
      } else {
        await client.query('DELETE FROM alunos WHERE turma_id = $1', [turmaDbId]);
      }
    }

    if (incomingTurmaIds.length) {
      await client.query(
        `
          DELETE FROM turmas
          WHERE docente_id = $1
            AND NOT (client_id = ANY($2::text[]))
        `,
        [docenteId, incomingTurmaIds]
      );
    } else {
      await client.query('DELETE FROM turmas WHERE docente_id = $1', [docenteId]);
    }

    await client.query('COMMIT');
    return await getTurmasDoDocente(docenteId);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ ok: true, mensagem: 'API funcionando.', banco: 'conectado', database: 'connected' });
  } catch (error) {
    console.error('[HEALTH]', error);
    return res.status(500).json({ ok: false, mensagem: 'API funcionando, mas banco indisponível.', database: 'disconnected' });
  }
});

app.post('/api/cadastro', async (req, res) => {
  try {
    const nome = normalizarTexto(req.body.nome ?? req.body.name);
    const email = normalizarEmail(req.body.email);
    const senha = String(req.body.senha ?? req.body.password ?? '');
    const telefone = normalizarTexto(req.body.telefone ?? req.body.phone) || null;
    const tipo = normalizarTexto(req.body.tipo ?? req.body.role ?? 'docente').toLowerCase() || 'docente';

    if (!nome || !email || !senha) return enviarErro(res, 400, 'Nome, e-mail e senha são obrigatórios.');
    if (senha.length < 6) return enviarErro(res, 400, 'A senha deve possuir pelo menos 6 caracteres.');
    if (!['docente', 'discente'].includes(tipo)) return enviarErro(res, 400, 'Tipo de usuário inválido.');

    const existente = await db.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (existente.rows.length) return enviarErro(res, 409, 'Já existe uma conta com este e-mail.');

    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await db.query(
      `
        INSERT INTO usuarios
          (nome, email, telefone, senha, tipo, name, phone, role, perfil)
        VALUES
          ($1, $2, $3, $4, $5, $1, $3, $5, $5)
        RETURNING id, nome, email, telefone, tipo, especialidade, foto, created_at
      `,
      [nome, email, telefone, senhaHash, tipo]
    );

    const usuario = result.rows[0];
    const token = gerarToken(usuario);
    return res.status(201).json({ mensagem: 'Cadastro realizado com sucesso.', token, usuario, perfil: usuario.tipo, email: usuario.email });
  } catch (error) {
    console.error('[CADASTRO]', error);
    return enviarErro(res, 500, 'Erro interno ao realizar cadastro.');
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = normalizarEmail(req.body.email);
    const senha = String(req.body.senha ?? req.body.password ?? '');
    if (!email || !senha) return enviarErro(res, 400, 'E-mail e senha são obrigatórios.');

    const result = await db.query(
      `
        SELECT id, nome, email, telefone, senha, tipo, especialidade, foto, created_at
        FROM usuarios
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email]
    );

    if (!result.rows.length) return enviarErro(res, 401, 'E-mail ou senha incorretos.');

    const usuario = result.rows[0];
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) return enviarErro(res, 401, 'E-mail ou senha incorretos.');

    delete usuario.senha;
    const token = gerarToken(usuario);
    return res.json({ mensagem: 'Login realizado com sucesso.', token, usuario, perfil: usuario.tipo, email: usuario.email });
  } catch (error) {
    console.error('[LOGIN]', error);
    return enviarErro(res, 500, 'Erro interno ao realizar login.');
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nome, email, telefone, tipo, especialidade, foto, created_at FROM usuarios WHERE id = $1 LIMIT 1`,
      [req.usuario.id]
    );
    if (!result.rows.length) return enviarErro(res, 404, 'Usuário não encontrado.');
    return res.json({ usuario: result.rows[0] });
  } catch (error) {
    console.error('[ME]', error);
    return enviarErro(res, 500, 'Erro ao buscar usuário.');
  }
});

app.patch('/api/me', auth, async (req, res) => {
  try {
    const nome = normalizarTexto(req.body.nome ?? req.body.name);
    const email = normalizarEmail(req.body.email);
    const telefone = normalizarTexto(req.body.telefone ?? req.body.phone) || null;
    const especialidade = normalizarTexto(req.body.especialidade) || null;
    const foto = req.body.foto || null;

    if (!nome || !email) return enviarErro(res, 400, 'Nome e e-mail são obrigatórios.');

    const emailExistente = await db.query(
      `SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
      [email, req.usuario.id]
    );
    if (emailExistente.rows.length) return enviarErro(res, 409, 'Este e-mail já está sendo usado.');

    const result = await db.query(
      `
        UPDATE usuarios
        SET
          nome = $1,
          email = $2,
          telefone = $3,
          especialidade = $4,
          foto = $5,
          name = $1,
          phone = $3,
          role = tipo,
          perfil = tipo
        WHERE id = $6
        RETURNING id, nome, email, telefone, tipo, especialidade, foto, created_at
      `,
      [nome, email, telefone, especialidade, foto, req.usuario.id]
    );

    const usuario = result.rows[0];
    const token = gerarToken(usuario);
    return res.json({ mensagem: 'Perfil atualizado com sucesso.', token, usuario });
  } catch (error) {
    console.error('[ME PATCH]', error);
    return enviarErro(res, 500, 'Erro ao atualizar perfil.');
  }
});

app.get('/api/turmas', auth, async (req, res) => {
  try {
    return res.json({ turmas: await getTurmasDoDocente(req.usuario.id) });
  } catch (error) {
    console.error('[TURMAS GET]', error);
    return enviarErro(res, 500, 'Erro ao buscar turmas.');
  }
});

app.post('/api/turmas', auth, async (req, res) => {
  try {
    if (Array.isArray(req.body.turmas)) {
      const turmas = await salvarTurmasDoDocente(req.usuario.id, req.body.turmas);
      return res.status(200).json({ mensagem: 'Dados sincronizados com sucesso.', turmas });
    }

    const atual = await getTurmasDoDocente(req.usuario.id);
    const novaTurma = {
      id: clientIdOrNew(null, 'turma'),
      nome: req.body.nome,
      turno: req.body.turno || 'Matutino',
      badgeClass: req.body.badgeClass || String(req.body.turno || 'matutino').toLowerCase(),
      descricao: req.body.descricao || '',
      tipoPeriodo: req.body.tipoPeriodo || 'bimestre',
      qtdPeriodo: req.body.qtdPeriodo || 4,
      mediaAprovacao: req.body.mediaAprovacao || 6,
      materias: Array.isArray(req.body.materias) ? req.body.materias : [],
      professorNome: req.body.professorNome || '',
      professorFoto: req.body.professorFoto || null,
      alunos: Array.isArray(req.body.alunos) ? req.body.alunos : []
    };
    atual.unshift(novaTurma);
    const turmas = await salvarTurmasDoDocente(req.usuario.id, atual);
    return res.status(201).json({ mensagem: 'Turma criada com sucesso.', turma: turmas.find((t) => t.id === novaTurma.id), turmas });
  } catch (error) {
    console.error('[TURMAS POST]', error);
    return enviarErro(res, error.status || 500, error.status ? error.message : 'Erro ao salvar turmas.');
  }
});

app.delete('/api/turmas/:id', auth, async (req, res) => {
  try {
    const turmas = await getTurmasDoDocente(req.usuario.id);
    const idx = turmas.findIndex((t) => t.id === req.params.id || String(t.id) === String(req.params.id));
    if (idx === -1) return enviarErro(res, 404, 'Turma não encontrada.');
    turmas.splice(idx, 1);
    await salvarTurmasDoDocente(req.usuario.id, turmas);
    return res.json({ mensagem: 'Turma excluída com sucesso.' });
  } catch (error) {
    console.error('[TURMAS DELETE]', error);
    return enviarErro(res, 500, 'Erro ao excluir turma.');
  }
});

app.get('/api/alunos/:id/notas', auth, async (req, res) => {
  try {
    const aluno = await obterAlunoDoDocente(db, req.usuario.id, req.params.id);
    if (!aluno) return enviarErro(res, 404, 'Aluno não encontrado.');
    const result = await db.query(
      `SELECT id, aluno_id, materia, valor, bimestre, atividade, created_at FROM notas WHERE aluno_id = $1 ORDER BY id DESC`,
      [aluno.id]
    );
    return res.json({ notas: result.rows });
  } catch (error) {
    console.error('[NOTAS GET]', error);
    return enviarErro(res, 500, 'Erro ao buscar notas.');
  }
});

app.post('/api/alunos/:id/notas', auth, async (req, res) => {
  try {
    const aluno = await obterAlunoDoDocente(db, req.usuario.id, req.params.id);
    if (!aluno) return enviarErro(res, 404, 'Aluno não encontrado.');
    const materia = normalizarTexto(req.body.materia || req.body.disciplina);
    const valor = num(req.body.valor ?? req.body.nota, null);
    const bimestre = normalizarTexto(req.body.bimestre) || null;
    const atividade = normalizarTexto(req.body.atividade || req.body.descricao) || null;
    if (!materia || valor === null) return enviarErro(res, 400, 'Matéria e nota são obrigatórias.');

    const result = await db.query(
      `
        INSERT INTO notas (aluno_id, materia, valor, bimestre, atividade, disciplina, nota, descricao)
        VALUES ($1, $2, $3, $4, $5, $2, $3, $5)
        RETURNING id, aluno_id, materia, valor, bimestre, atividade, created_at
      `,
      [aluno.id, materia, valor, bimestre, atividade]
    );
    return res.status(201).json({ nota: result.rows[0] });
  } catch (error) {
    console.error('[NOTAS POST]', error);
    return enviarErro(res, 500, 'Erro ao salvar nota.');
  }
});

app.get('/api/alunos/:id/frequencias', auth, async (req, res) => {
  try {
    const aluno = await obterAlunoDoDocente(db, req.usuario.id, req.params.id);
    if (!aluno) return enviarErro(res, 404, 'Aluno não encontrado.');
    const result = await db.query(
      `SELECT id, aluno_id, data, presente, created_at FROM frequencias WHERE aluno_id = $1 ORDER BY data DESC, id DESC`,
      [aluno.id]
    );
    return res.json({ frequencias: result.rows });
  } catch (error) {
    console.error('[FREQUENCIAS GET]', error);
    return enviarErro(res, 500, 'Erro ao buscar frequências.');
  }
});

app.post('/api/alunos/:id/frequencias', auth, async (req, res) => {
  try {
    const aluno = await obterAlunoDoDocente(db, req.usuario.id, req.params.id);
    if (!aluno) return enviarErro(res, 404, 'Aluno não encontrado.');
    const data = normalizarTexto(req.body.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return enviarErro(res, 400, 'Data inválida.');

    const presente = bool(req.body.presente);
    const result = await db.query(
      `
        INSERT INTO frequencias (aluno_id, data, presente)
        VALUES ($1, $2, $3)
        ON CONFLICT (aluno_id, data)
        DO UPDATE SET presente = EXCLUDED.presente
        RETURNING id, aluno_id, data, presente, created_at
      `,
      [aluno.id, data, presente]
    );
    return res.status(201).json({ frequencia: result.rows[0] });
  } catch (error) {
    console.error('[FREQUENCIA POST]', error);
    return enviarErro(res, 500, 'Erro ao salvar frequência.');
  }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const email = normalizarEmail(req.body.email);
    if (!email) return enviarErro(res, 400, 'Informe seu e-mail.');

    const result = await db.query(
      `SELECT id, nome, email FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );

    if (!result.rows.length) {
      return res.json({ mensagem: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.EMAIL_FROM) {
      console.error('[FORGOT PASSWORD] SMTP não configurado.');
      return enviarErro(res, 500, 'O envio de e-mail ainda não está configurado no servidor.');
    }

    const usuario = result.rows[0];
    const codigo = gerarCodigoRecuperacao();
    const codigoHash = hashCodigo(codigo);
    const expiracao = new Date(Date.now() + 15 * 60 * 1000);

    await db.query('DELETE FROM password_reset_tokens WHERE usuario_id = $1', [usuario.id]);
    await db.query(
      `INSERT INTO password_reset_tokens (usuario_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [usuario.id, codigoHash, expiracao]
    );

    await smtpTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: usuario.email,
      subject: 'ID HUB - Código para redefinir sua senha',
      text: `Olá, ${usuario.nome}!\n\nSeu código de recuperação do ID HUB é: ${codigo}\n\nO código é válido por 15 minutos.\n\nSe você não solicitou a redefinição, ignore este e-mail.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;padding:32px;background:#fff;border-radius:16px;color:#222;">
          <h1>ID HUB</h1>
          <h2>Recuperação de senha</h2>
          <p>Olá, ${usuario.nome}!</p>
          <p>Seu código de recuperação é:</p>
          <div style="text-align:center;margin:28px 0;font-size:32px;font-weight:bold;letter-spacing:8px;">${codigo}</div>
          <p>O código é válido por <strong>15 minutos</strong>.</p>
          <p>Se você não solicitou a redefinição, ignore este e-mail.</p>
        </div>
      `
    });

    return res.json({ mensagem: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' });
  } catch (error) {
    console.error('[FORGOT PASSWORD]', error);
    return enviarErro(res, 500, 'Não foi possível enviar o código de recuperação.');
  }
});

app.post('/api/reset-password', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const email = normalizarEmail(req.body.email);
    const codigo = normalizarTexto(req.body.codigo ?? req.body.code);
    const novaSenha = String(req.body.novaSenha ?? req.body.password ?? '');

    if (!email || !codigo || !novaSenha) return enviarErro(res, 400, 'E-mail, código e nova senha são obrigatórios.');
    if (novaSenha.length < 6) return enviarErro(res, 400, 'A nova senha deve possuir pelo menos 6 caracteres.');

    const usuarioResult = await client.query(
      `SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (!usuarioResult.rows.length) return enviarErro(res, 400, 'Código inválido ou expirado.');

    const usuarioId = usuarioResult.rows[0].id;
    const codigoHash = hashCodigo(codigo);
    const tokenResult = await client.query(
      `
        SELECT id, expires_at
        FROM password_reset_tokens
        WHERE usuario_id = $1 AND code_hash = $2
        LIMIT 1
      `,
      [usuarioId, codigoHash]
    );
    if (!tokenResult.rows.length) return enviarErro(res, 400, 'Código inválido ou expirado.');

    if (new Date(tokenResult.rows[0].expires_at).getTime() < Date.now()) {
      await client.query('DELETE FROM password_reset_tokens WHERE id = $1', [tokenResult.rows[0].id]);
      return enviarErro(res, 400, 'Código inválido ou expirado.');
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    await client.query('BEGIN');
    await client.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [novaSenhaHash, usuarioId]);
    await client.query('DELETE FROM password_reset_tokens WHERE id = $1', [tokenResult.rows[0].id]);
    await client.query('COMMIT');

    return res.json({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[RESET PASSWORD]', error);
    return enviarErro(res, 500, 'Erro ao redefinir senha.');
  } finally {
    client.release();
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Rota da API não encontrada.' });
});

app.use((error, req, res, next) => {
  console.error('[SERVER ERROR]', error);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

async function start() {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não está configurada.');
    await ensureDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[IDHUB] Servidor online na porta ${PORT}`);
      console.log('[IDHUB] Banco PostgreSQL/Neon conferido.');
      console.log('[IDHUB] Recuperação de senha: Nodemailer + Brevo SMTP.');
    });
  } catch (error) {
    console.error('[IDHUB] Falha ao iniciar:', error);
    process.exit(1);
  }
}

start();
