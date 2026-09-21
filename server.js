require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();

const PORT = Number(process.env.PORT || 3000);

const JWT_SECRET =
  process.env.JWT_SECRET || 'TROQUE_ESTA_CHAVE_EM_PRODUCAO';

if (JWT_SECRET === 'TROQUE_ESTA_CHAVE_EM_PRODUCAO') {
  console.warn(
    '[IDHUB] AVISO: defina JWT_SECRET nas variáveis de ambiente do Render.'
  );
}

/* =========================================================
   BREVO SMTP
   ========================================================= */

const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* =========================================================
   MIDDLEWARES
   ========================================================= */

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use(express.static(path.join(__dirname)));

/* =========================================================
   DATABASE
   ========================================================= */

const { ensureDatabase } = require('./schema');

/* =========================================================
   AUTENTICAÇÃO
   ========================================================= */

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: 'Sessão não encontrada. Faça login novamente.'
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Sessão expirada ou inválida. Faça login novamente.'
    });
  }
}

/* =========================================================
   NORMALIZAÇÕES
   ========================================================= */

function normalizeRole(role) {
  return role === 'docente' ? 'docente' : 'discente';
}

function normalizeStudent(student) {
  return {
    ...student,

    faltas: Number(student.faltas || 0),

    notas:
      student.notas && typeof student.notas === 'object'
        ? student.notas
        : {},

    historicoFrequencia:
      student.historicoFrequencia &&
      typeof student.historicoFrequencia === 'object'
        ? student.historicoFrequencia
        : {},

    atividades: Array.isArray(student.atividades)
      ? student.atividades
      : []
  };
}

function normalizeGradeEntries(notas) {
  if (!notas || typeof notas !== 'object') {
    return [];
  }

  const entries = [];

  for (const [materia, rawValue] of Object.entries(notas)) {
    if (
      rawValue === null ||
      rawValue === undefined ||
      rawValue === ''
    ) {
      continue;
    }

    if (
      typeof rawValue === 'number' ||
      (
        !Number.isNaN(Number(rawValue)) &&
        typeof rawValue !== 'object'
      )
    ) {
      const valor = Number(rawValue);

      if (Number.isFinite(valor)) {
        entries.push({
          materia,
          valor
        });
      }

      continue;
    }

    if (typeof rawValue === 'object') {
      const valor = Number(
        rawValue.valor ??
        rawValue.value ??
        rawValue.nota
      );

      if (Number.isFinite(valor)) {
        entries.push({
          materia,
          valor,
          bimestre:
            rawValue.bimestre ??
            rawValue.periodo ??
            null,
          atividade:
            rawValue.atividade ??
            rawValue.nome ??
            null
        });
      }
    }
  }

  return entries;
}

function buildUser(row) {
  return {
    id: row.id,
    name: row.name || '',
    email: row.email,
    phone: row.phone || '',

    role: normalizeRole(
      row.role || row.perfil
    ),

    perfil: normalizeRole(
      row.role || row.perfil
    ),

    especialidade: row.especialidade || '',
    foto: row.foto || null
  };
}

function buildTurma(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    nome: row.nome,
    turno: row.turno || 'Matutino',

    badgeClass:
      row.badge_class ||
      row.turno?.toLowerCase() ||
      'matutino',

    descricao: row.descricao || '',

    tipoPeriodo:
      row.tipo_periodo || '4_bimestres',

    mediaAprovacao:
      Number(row.media_aprovacao ?? 6),

    professorNome:
      row.professor_nome ||
      'Professor não informado',

    professorFoto:
      row.professor_foto || null,

    alunos: []
  };
}

/* =========================================================
   BUSCAR TURMAS DO DOCENTE
   ========================================================= */

async function getTurmasDoDocente(userId) {
  const turmaResult = await db.query(
    `
      SELECT *
      FROM turmas
      WHERE professor_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [userId]
  );

  if (turmaResult.rows.length === 0) {
    return [];
  }

  const turmaIds = turmaResult.rows.map(
    row => row.id
  );

  const alunoResult = await db.query(
    `
      SELECT *
      FROM alunos
      WHERE turma_id = ANY($1::int[])
      ORDER BY id ASC
    `,
    [turmaIds]
  );

  const alunoIds = alunoResult.rows.map(
    row => row.id
  );

  let notas = [];
  let frequencias = [];

  if (alunoIds.length > 0) {
    const [
      notasResult,
      freqResult
    ] = await Promise.all([
      db.query(
        `
          SELECT *
          FROM notas
          WHERE aluno_id = ANY($1::int[])
          ORDER BY id ASC
        `,
        [alunoIds]
      ),

      db.query(
        `
          SELECT *
          FROM frequencias
          WHERE aluno_id = ANY($1::int[])
          ORDER BY data ASC, id ASC
        `,
        [alunoIds]
      )
    ]);

    notas = notasResult.rows;
    frequencias = freqResult.rows;
  }

  const notasPorAluno = new Map();

  for (const nota of notas) {
    if (!notasPorAluno.has(nota.aluno_id)) {
      notasPorAluno.set(
        nota.aluno_id,
        {}
      );
    }

    const valor = Number(nota.valor);

    const baseKey =
      nota.materia || 'Nota';

    let key = baseKey;

    if (nota.bimestre || nota.atividade) {
      key = [
        baseKey,
        nota.bimestre,
        nota.atividade
      ]
        .filter(Boolean)
        .join(' - ');
    }

    notasPorAluno.get(
      nota.aluno_id
    )[key] = valor;
  }

  const freqPorAluno = new Map();

  for (const freq of frequencias) {
    if (!freqPorAluno.has(freq.aluno_id)) {
      freqPorAluno.set(
        freq.aluno_id,
        {}
      );
    }

    const iso = new Date(freq.data)
      .toISOString()
      .slice(0, 10);

    freqPorAluno.get(
      freq.aluno_id
    )[iso] = freq.presente;
  }

  const alunosPorTurma = new Map();

  for (const aluno of alunoResult.rows) {
    if (!alunosPorTurma.has(aluno.turma_id)) {
      alunosPorTurma.set(
        aluno.turma_id,
        []
      );
    }

    alunosPorTurma.get(
      aluno.turma_id
    ).push({
      id: aluno.id,

      clientId:
        aluno.client_id,

      nome:
        aluno.nome,

      matricula:
        aluno.matricula ||
        'Não informado',

      nascimento:
        aluno.nascimento ||
        'Não informado',

      telefone:
        aluno.telefone ||
        'Não informado',

      email:
        aluno.email ||
        'Não informado',

      endereco:
        aluno.endereco ||
        'Não informado',

      observacoes:
        aluno.observacoes || '',

      foto:
        aluno.foto ||
        'https://via.placeholder.com/150',

      faltas:
        Number(aluno.faltas || 0),

      historicoFrequencia:
        freqPorAluno.get(aluno.id) || {},

      notas:
        notasPorAluno.get(aluno.id) || {},

      atividades:
        Array.isArray(aluno.atividades)
          ? aluno.atividades
          : []
    });
  }

  return turmaResult.rows.map(row => ({
    ...buildTurma(row),

    alunos:
      alunosPorTurma.get(row.id) || []
  }));
}

/* =========================================================
   HEALTH
   ========================================================= */

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');

    res.json({
      ok: true,
      database: 'connected',
      service: 'ID HUB API'
    });
  } catch (error) {
    console.error('[HEALTH]', error);

    res.status(500).json({
      ok: false,
      database: 'disconnected'
    });
  }
});

/* =========================================================
   CADASTRO
   ========================================================= */

app.post('/api/cadastro', async (req, res) => {
  try {
    const {
      name,
      email,
      phone
    } = req.body;

    const role = normalizeRole(
      req.body.role ||
      req.body.perfil
    );

    const senha = String(
      req.body.senha ||
      req.body.password ||
      ''
    );

    if (!name || !email || !senha) {
      return res.status(400).json({
        error:
          'Nome, e-mail e senha são obrigatórios.'
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        error:
          'A senha deve ter pelo menos 6 caracteres.'
      });
    }

    const emailNormalizado =
      String(email)
        .trim()
        .toLowerCase();

    const exists = await db.query(
      `
        SELECT id
        FROM usuarios
        WHERE email = $1
      `,
      [emailNormalizado]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error: 'E-mail já cadastrado.'
      });
    }

    const hash = await bcrypt.hash(
      senha,
      12
    );

    const result = await db.query(
      `
        INSERT INTO usuarios
          (
            name,
            email,
            phone,
            senha,
            role,
            perfil
          )
        VALUES
          ($1, $2, $3, $4, $5, $5)
        RETURNING
          id,
          name,
          email,
          phone,
          role,
          perfil,
          especialidade,
          foto
      `,
      [
        String(name).trim(),
        emailNormalizado,
        phone || '',
        hash,
        role
      ]
    );

    res.status(201).json({
      message:
        'Usuário cadastrado com sucesso!',

      user:
        buildUser(result.rows[0])
    });
  } catch (error) {
    console.error(
      '[CADASTRO]',
      error
    );

    res.status(500).json({
      error:
        'Erro interno ao cadastrar usuário.'
    });
  }
});

/* =========================================================
   LOGIN
   ========================================================= */

app.post('/api/login', async (req, res) => {
  try {
    const email = String(
      req.body.email || ''
    )
      .trim()
      .toLowerCase();

    const senha = String(
      req.body.senha ||
      req.body.password ||
      ''
    );

    if (!email || !senha) {
      return res.status(400).json({
        error:
          'E-mail e senha são obrigatórios.'
      });
    }

    const result = await db.query(
      `
        SELECT *
        FROM usuarios
        WHERE email = $1
      `,
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error:
          'E-mail ou senha inválidos.'
      });
    }

    const usuario = result.rows[0];

    const ok = await bcrypt.compare(
      senha,
      usuario.senha
    );

    if (!ok) {
      return res.status(401).json({
        error:
          'E-mail ou senha inválidos.'
      });
    }

    const user =
      buildUser(usuario);

    const token =
      createToken(user);

    res.json({
      message:
        'Login realizado com sucesso!',

      token,

      perfil:
        user.role,

      email:
        user.email,

      user
    });
  } catch (error) {
    console.error(
      '[LOGIN]',
      error
    );

    res.status(500).json({
      error:
        'Erro interno no login.'
    });
  }
});

/* =========================================================
   ME
   ========================================================= */

app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          name,
          email,
          phone,
          role,
          perfil,
          especialidade,
          foto
        FROM usuarios
        WHERE id = $1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Usuário não encontrado.'
      });
    }

    res.json({
      user:
        buildUser(result.rows[0])
    });
  } catch (error) {
    console.error(
      '[ME]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao carregar perfil.'
    });
  }
});

app.patch('/api/me', auth, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      especialidade,
      foto
    } = req.body;

    const emailNormalizado =
      email
        ? String(email)
            .trim()
            .toLowerCase()
        : undefined;

    if (emailNormalizado) {
      const emailUsado =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE email = $1
              AND id <> $2
          `,
          [
            emailNormalizado,
            req.user.id
          ]
        );

      if (emailUsado.rows.length) {
        return res.status(409).json({
          error:
            'Esse e-mail já pertence a outro usuário.'
        });
      }
    }

    const result = await db.query(
      `
        UPDATE usuarios
        SET
          name =
            COALESCE($1, name),

          email =
            COALESCE($2, email),

          phone =
            COALESCE($3, phone),

          especialidade =
            COALESCE($4, especialidade),

          foto =
            COALESCE($5, foto),

          role =
            COALESCE(
              role,
              perfil,
              'discente'
            ),

          perfil =
            COALESCE(
              perfil,
              role,
              'discente'
            )

        WHERE id = $6

        RETURNING
          id,
          name,
          email,
          phone,
          role,
          perfil,
          especialidade,
          foto
      `,
      [
        name !== undefined
          ? String(name).trim()
          : null,

        emailNormalizado || null,

        phone !== undefined
          ? String(phone)
          : null,

        especialidade !== undefined
          ? String(especialidade)
          : null,

        foto !== undefined
          ? foto
          : null,

        req.user.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Usuário não encontrado.'
      });
    }

    const user =
      buildUser(result.rows[0]);

    const token =
      createToken(user);

    res.json({
      message:
        'Perfil atualizado com sucesso!',

      user,

      token
    });
  } catch (error) {
    console.error(
      '[PATCH ME]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao atualizar o perfil.'
    });
  }
});

/* =========================================================
   TURMAS
   ========================================================= */

app.get('/api/turmas', auth, async (req, res) => {
  try {
    const turmas =
      await getTurmasDoDocente(
        req.user.id
      );

    res.json(turmas);
  } catch (error) {
    console.error(
      '[GET TURMAS]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao buscar turmas.'
    });
  }
});

/* =========================================================
   SALVAR TURMAS / ALUNOS / NOTAS / FREQUÊNCIAS
   ========================================================= */

app.post('/api/turmas', auth, async (req, res) => {
  const turmas = Array.isArray(req.body)
    ? req.body
    : req.body.turmas;

  const replaceAll =
    Array.isArray(req.body)
      ? true
      : req.body.replaceAll === true;

  if (!Array.isArray(turmas)) {
    return res.status(400).json({
      error:
        'Envie um array de turmas ou { turmas: [...] }.'
    });
  }

  const client =
    await db.pool.connect();

  try {
    await client.query('BEGIN');

    const turmaIdsMantidas = [];

    for (const rawTurma of turmas) {
      const turma =
        rawTurma || {};

      const clientId =
        String(
          turma.clientId ||
          (
            typeof turma.id === 'string'
              ? turma.id
              : ''
          ) ||
          `turma_${crypto.randomUUID()}`
        ).slice(0, 100);

      const numericId =
        Number.isInteger(
          Number(turma.id)
        )
          ? Number(turma.id)
          : null;

      let existing = null;

      if (numericId !== null) {
        const r =
          await client.query(
            `
              SELECT id
              FROM turmas
              WHERE id = $1
                AND professor_id = $2
            `,
            [
              numericId,
              req.user.id
            ]
          );

        existing =
          r.rows[0] || null;
      }

      if (!existing) {
        const r =
          await client.query(
            `
              SELECT id
              FROM turmas
              WHERE client_id = $1
                AND professor_id = $2
            `,
            [
              clientId,
              req.user.id
            ]
          );

        existing =
          r.rows[0] || null;
      }

      let turmaId;

      if (existing) {
        turmaId =
          existing.id;

        await client.query(
          `
            UPDATE turmas
            SET
              nome = $1,
              turno = $2,
              badge_class = $3,
              descricao = $4,
              tipo_periodo = $5,
              media_aprovacao = $6,
              professor_nome = $7,
              professor_foto = $8,
              client_id = $9
            WHERE id = $10
              AND professor_id = $11
          `,
          [
            String(
              turma.nome ||
              'SEM NOME'
            ).slice(0, 100),

            turma.turno ||
              'Matutino',

            turma.badgeClass ||
              String(
                turma.turno ||
                'Matutino'
              ).toLowerCase(),

            turma.descricao ||
              '',

            turma.tipoPeriodo ||
              '4_bimestres',

            Number(
              turma.mediaAprovacao ?? 6
            ),

            turma.professorNome ||
              '',

            turma.professorFoto ||
              null,

            clientId,

            turmaId,

            req.user.id
          ]
        );
      } else {
        const r =
          await client.query(
            `
              INSERT INTO turmas
                (
                  client_id,
                  nome,
                  turno,
                  badge_class,
                  descricao,
                  tipo_periodo,
                  media_aprovacao,
                  professor_nome,
                  professor_foto,
                  professor_id
                )
              VALUES
                (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5,
                  $6,
                  $7,
                  $8,
                  $9,
                  $10
                )
              RETURNING id
            `,
            [
              clientId,

              String(
                turma.nome ||
                'SEM NOME'
              ).slice(0, 100),

              turma.turno ||
                'Matutino',

              turma.badgeClass ||
                String(
                  turma.turno ||
                  'Matutino'
                ).toLowerCase(),

              turma.descricao ||
                '',

              turma.tipoPeriodo ||
                '4_bimestres',

              Number(
                turma.mediaAprovacao ?? 6
              ),

              turma.professorNome ||
                '',

              turma.professorFoto ||
                null,

              req.user.id
            ]
          );

        turmaId =
          r.rows[0].id;
      }

      turmaIdsMantidas.push(
        turmaId
      );

      /* =====================================================
         ALUNOS
         ===================================================== */

      const incomingAlunoIds = [];

      const alunos =
        Array.isArray(turma.alunos)
          ? turma.alunos
          : [];

      for (const rawAluno of alunos) {
        const aluno =
          normalizeStudent(
            rawAluno
          );

        const alunoClientId =
          String(
            aluno.clientId ||
            (
              typeof aluno.id === 'string'
                ? aluno.id
                : ''
            ) ||
            `aluno_${crypto.randomUUID()}`
          ).slice(0, 100);

        const numericAlunoId =
          Number.isInteger(
            Number(aluno.id)
          )
            ? Number(aluno.id)
            : null;

        let existingAluno = null;

        if (numericAlunoId !== null) {
          const r =
            await client.query(
              `
                SELECT id
                FROM alunos
                WHERE id = $1
                  AND turma_id = $2
              `,
              [
                numericAlunoId,
                turmaId
              ]
            );

          existingAluno =
            r.rows[0] || null;
        }

        if (!existingAluno) {
          const r =
            await client.query(
              `
                SELECT id
                FROM alunos
                WHERE client_id = $1
                  AND turma_id = $2
              `,
              [
                alunoClientId,
                turmaId
              ]
            );

          existingAluno =
            r.rows[0] || null;
        }

        let alunoId;

        const alunoData = [
          alunoClientId,

          String(
            aluno.nome ||
            'SEM NOME'
          ).slice(0, 255),

          String(
            aluno.matricula ||
            'Não informado'
          ).slice(0, 100),

          String(
            aluno.nascimento ||
            'Não informado'
          ).slice(0, 100),

          String(
            aluno.telefone ||
            'Não informado'
          ).slice(0, 50),

          String(
            aluno.email ||
            'Não informado'
          ).slice(0, 255),

          String(
            aluno.endereco ||
            'Não informado'
          ),

          String(
            aluno.observacoes ||
            ''
          ),

          aluno.foto ||
            null,

          Math.max(
            0,
            Number(
              aluno.faltas || 0
            )
          ),

          JSON.stringify(
            aluno.atividades || []
          )
        ];

        if (existingAluno) {
          alunoId =
            existingAluno.id;

          await client.query(
            `
              UPDATE alunos
              SET
                client_id = $1,
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
                AND turma_id = $13
            `,
            [
              ...alunoData,
              alunoId,
              turmaId
            ]
          );
        } else {
          const r =
            await client.query(
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
                  (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12::jsonb
                  )
                RETURNING id
              `,
              [
                alunoClientId,
                turmaId,
                ...alunoData.slice(1)
              ]
            );

          alunoId =
            r.rows[0].id;
        }

        incomingAlunoIds.push(
          alunoId
        );

        /* ===================================================
           NOTAS
           =================================================== */

        await client.query(
          `
            DELETE FROM notas
            WHERE aluno_id = $1
          `,
          [alunoId]
        );

        for (
          const nota of normalizeGradeEntries(
            aluno.notas
          )
        ) {
          await client.query(
            `
              INSERT INTO notas
                (
                  aluno_id,
                  materia,
                  valor,
                  bimestre,
                  atividade
                )
              VALUES
                (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5
                )
            `,
            [
              alunoId,

              String(
                nota.materia
              ).slice(0, 100),

              nota.valor,

              nota.bimestre ||
                null,

              nota.atividade ||
                null
            ]
          );
        }

        /* ===================================================
           FREQUÊNCIAS
           =================================================== */

        await client.query(
          `
            DELETE FROM frequencias
            WHERE aluno_id = $1
          `,
          [alunoId]
        );

        for (
          const [
            data,
            presente
          ] of Object.entries(
            aluno.historicoFrequencia || {}
          )
        ) {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
              data
            )
          ) {
            continue;
          }

          await client.query(
            `
              INSERT INTO frequencias
                (
                  aluno_id,
                  data,
                  presente
                )
              VALUES
                (
                  $1,
                  $2,
                  $3
                )
              ON CONFLICT
                (aluno_id, data)
              DO UPDATE SET
                presente =
                  EXCLUDED.presente
            `,
            [
              alunoId,
              data,
              Boolean(presente)
            ]
          );
        }
      }

      /* =====================================================
         REMOVE ALUNOS QUE NÃO EXISTEM MAIS NO FRONT-END
         ===================================================== */

      if (
        incomingAlunoIds.length === 0
      ) {
        await client.query(
          `
            DELETE FROM alunos
            WHERE turma_id = $1
          `,
          [turmaId]
        );
      } else {
        await client.query(
          `
            DELETE FROM alunos
            WHERE turma_id = $1
              AND NOT (
                id = ANY($2::int[])
              )
          `,
          [
            turmaId,
            incomingAlunoIds
          ]
        );
      }
    }

    /* =======================================================
       RECONCILIA TURMAS REMOVIDAS NO FRONT-END
       ======================================================= */

    if (replaceAll) {
      if (
        turmaIdsMantidas.length === 0
      ) {
        await client.query(
          `
            DELETE FROM turmas
            WHERE professor_id = $1
          `,
          [req.user.id]
        );
      } else {
        await client.query(
          `
            DELETE FROM turmas
            WHERE professor_id = $1
              AND NOT (
                id = ANY($2::int[])
              )
          `,
          [
            req.user.id,
            turmaIdsMantidas
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    console.error(
      '[SYNC TURMAS]',
      error
    );

    return res.status(500).json({
      error:
        'Erro ao salvar turmas, alunos, notas e frequências.'
    });
  } finally {
    client.release();
  }

  try {
    const saved =
      await getTurmasDoDocente(
        req.user.id
      );

    res.status(200).json({
      message:
        'Dados salvos no Neon!',

      turmas: saved
    });
  } catch (error) {
    console.error(
      '[SYNC RESPONSE]',
      error
    );

    res.status(500).json({
      error:
        'Dados salvos, mas não foi possível recarregar a lista.'
    });
  }
});

/* =========================================================
   EXCLUIR TURMA
   ========================================================= */

app.delete('/api/turmas/:id', auth, async (req, res) => {
  try {
    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error:
          'ID da turma inválido.'
      });
    }

    const result =
      await db.query(
        `
          DELETE FROM turmas
          WHERE id = $1
            AND professor_id = $2
          RETURNING id
        `,
        [
          id,
          req.user.id
        ]
      );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Turma não encontrada.'
      });
    }

    res.json({
      message:
        'Turma excluída com sucesso!'
    });
  } catch (error) {
    console.error(
      '[DELETE TURMA]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao excluir turma.'
    });
  }
});

/* =========================================================
   NOTAS DO ALUNO
   ========================================================= */

app.get('/api/alunos/:id/notas', auth, async (req, res) => {
  try {
    const id =
      Number(req.params.id);

    const result =
      await db.query(
        `
          SELECT n.*
          FROM notas n
          JOIN alunos a
            ON a.id = n.aluno_id
          JOIN turmas t
            ON t.id = a.turma_id
          WHERE n.aluno_id = $1
            AND t.professor_id = $2
          ORDER BY n.id ASC
        `,
        [
          id,
          req.user.id
        ]
      );

    res.json(
      result.rows
    );
  } catch (error) {
    console.error(
      '[GET NOTAS]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao buscar notas.'
    });
  }
});

/* =========================================================
   FREQUÊNCIAS DO ALUNO
   ========================================================= */

app.get(
  '/api/alunos/:id/frequencias',
  auth,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const result =
        await db.query(
          `
            SELECT f.*
            FROM frequencias f
            JOIN alunos a
              ON a.id = f.aluno_id
            JOIN turmas t
              ON t.id = a.turma_id
            WHERE f.aluno_id = $1
              AND t.professor_id = $2
            ORDER BY f.data ASC
          `,
          [
            id,
            req.user.id
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        '[GET FREQUENCIAS]',
        error
      );

      res.status(500).json({
        error:
          'Erro ao buscar frequências.'
      });
    }
  }
);

/* =========================================================
   RECUPERAÇÃO DE SENHA
   BREVO SMTP
   ========================================================= */

app.post(
  '/api/forgot-password',
  async (req, res) => {
    try {
      const email =
        String(
          req.body.email || ''
        )
          .trim()
          .toLowerCase();

      if (!email) {
        return res.status(400).json({
          message:
            'Informe um e-mail válido.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              id,
              name,
              email
            FROM usuarios
            WHERE email = $1
          `,
          [email]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          message:
            'E-mail não encontrado no sistema.'
        });
      }

      /* =====================================================
         VERIFICA CONFIGURAÇÃO SMTP
         ===================================================== */

      if (
        !process.env.SMTP_USER ||
        !process.env.SMTP_PASS
      ) {
        console.error(
          '[FORGOT PASSWORD] SMTP_USER ou SMTP_PASS não configurados.'
        );

        return res.status(500).json({
          message:
            'O serviço de e-mail não está configurado no servidor.'
        });
      }

      if (!process.env.EMAIL_FROM) {
        console.error(
          '[FORGOT PASSWORD] EMAIL_FROM não configurado.'
        );

        return res.status(500).json({
          message:
            'O remetente do e-mail não está configurado.'
        });
      }

      const user =
        result.rows[0];

      /* =====================================================
         GERA CÓDIGO
         ===================================================== */

      const code =
        String(
          crypto.randomInt(
            100000,
            1000000
          )
        );

      const codeHash =
        crypto
          .createHash('sha256')
          .update(code)
          .digest('hex');

      /* =====================================================
         SALVA CÓDIGO NO NEON
         ===================================================== */

      await db.query(
        `
          INSERT INTO password_reset_tokens
            (
              usuario_id,
              code_hash,
              expires_at
            )
          VALUES
            (
              $1,
              $2,
              NOW() + INTERVAL '10 minutes'
            )
          ON CONFLICT (usuario_id)
          DO UPDATE SET
            code_hash =
              EXCLUDED.code_hash,

            expires_at =
              EXCLUDED.expires_at,

            created_at =
              NOW()
        `,
        [
          user.id,
          codeHash
        ]
      );

      /* =====================================================
         CONTEÚDO DO E-MAIL
         ===================================================== */

      const html = `
        <div
          style="
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 24px;
            color: #1f2937;
          "
        >
          <h2 style="margin-bottom: 8px;">
            ID HUB
          </h2>

          <p>
            Olá${user.name ? `, ${user.name}` : ''}!
          </p>

          <p>
            Recebemos uma solicitação para
            redefinir a sua senha.
          </p>

          <div
            style="
              font-size: 32px;
              font-weight: 700;
              letter-spacing: 8px;
              text-align: center;
              padding: 18px 0;
            "
          >
            ${code}
          </div>

          <p>
            Este código expira em
            <strong>10 minutos</strong>.
          </p>

          <p
            style="
              color: #6b7280;
              font-size: 13px;
            "
          >
            Se você não solicitou a redefinição,
            ignore este e-mail.
          </p>
        </div>
      `;

      const text = `
Seu código de recuperação do ID HUB é: ${code}

Este código expira em 10 minutos.

Se você não solicitou a redefinição de senha,
ignore este e-mail.
`;

      /* =====================================================
         ENVIA PELA BREVO SMTP
         ===================================================== */

      const info =
        await smtpTransporter.sendMail({
          from:
            process.env.EMAIL_FROM,

          to:
            email,

          subject:
            'Código de recuperação de senha - ID HUB',

          html,

          text
        });

      console.log(
        `[FORGOT PASSWORD] E-mail enviado para ${email}. ID: ${
          info.messageId || 'sem-id'
        }`
      );

      return res.json({
        message:
          'Código de recuperação enviado para seu e-mail.'
      });
    } catch (error) {
      console.error(
        '[FORGOT PASSWORD]',
        error
      );

      return res.status(500).json({
        message:
          'Não foi possível enviar o código de recuperação.'
      });
    }
  }
);

/* =========================================================
   REDEFINIR SENHA
   ========================================================= */

app.post(
  '/api/reset-password',
  async (req, res) => {
    try {
      const email =
        String(
          req.body.email || ''
        )
          .trim()
          .toLowerCase();

      const code =
        String(
          req.body.code || ''
        ).trim();

      const password =
        String(
          req.body.password || ''
        );

      if (
        !email ||
        !/^\d{6}$/.test(code) ||
        password.length < 6
      ) {
        return res.status(400).json({
          message:
            'E-mail, código de 6 dígitos e nova senha são obrigatórios.'
        });
      }

      const userResult =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE email = $1
          `,
          [email]
        );

      if (!userResult.rows.length) {
        return res.status(404).json({
          message:
            'Usuário não encontrado.'
        });
      }

      const userId =
        userResult.rows[0].id;

      const codeHash =
        crypto
          .createHash('sha256')
          .update(code)
          .digest('hex');

      const tokenResult =
        await db.query(
          `
            SELECT id
            FROM password_reset_tokens
            WHERE usuario_id = $1
              AND code_hash = $2
              AND expires_at > NOW()
          `,
          [
            userId,
            codeHash
          ]
        );

      if (!tokenResult.rows.length) {
        return res.status(400).json({
          message:
            'Código de verificação inválido ou expirado.'
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      /*
       * Usa uma conexão dedicada para garantir
       * que UPDATE e DELETE estejam na mesma transação.
       */

      const client =
        await db.pool.connect();

      try {
        await client.query(
          'BEGIN'
        );

        await client.query(
          `
            UPDATE usuarios
            SET senha = $1
            WHERE id = $2
          `,
          [
            hash,
            userId
          ]
        );

        await client.query(
          `
            DELETE FROM password_reset_tokens
            WHERE usuario_id = $1
          `,
          [userId]
        );

        await client.query(
          'COMMIT'
        );
      } catch (transactionError) {
        await client.query(
          'ROLLBACK'
        );

        throw transactionError;
      } finally {
        client.release();
      }

      res.json({
        message:
          'Senha redefinida com sucesso!'
      });
    } catch (error) {
      console.error(
        '[RESET PASSWORD]',
        error
      );

      res.status(500).json({
        message:
          'Erro interno ao redefinir a senha.'
      });
    }
  }
);

/* =========================================================
   INICIAR SERVIDOR
   ========================================================= */

async function start() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL não está configurada.'
      );
    }

    await ensureDatabase();

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `[IDHUB] API online na porta ${PORT}`
        );

        console.log(
          '[IDHUB] Banco de dados inicializado/conferido.'
        );

        console.log(
          '[IDHUB] Sistema de e-mail: Brevo SMTP'
        );
      }
    );
  } catch (error) {
    console.error(
      '[IDHUB] Falha ao iniciar:',
      error
    );

    process.exit(1);
  }
}

start();============================ */

app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          name,
          email,
          phone,
          role,
          perfil,
          especialidade,
          foto
        FROM usuarios
        WHERE id = $1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Usuário não encontrado.'
      });
    }

    res.json({
      user:
        buildUser(result.rows[0])
    });

  } catch (error) {
    console.error(
      '[ME]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao carregar perfil.'
    });
  }
});

app.patch('/api/me', auth, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      especialidade,
      foto
    } = req.body;

    const emailNormalizado =
      email
        ? String(email)
            .trim()
            .toLowerCase()
        : undefined;

    if (emailNormalizado) {
      const emailUsado =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE email = $1
              AND id <> $2
          `,
          [
            emailNormalizado,
            req.user.id
          ]
        );

      if (emailUsado.rows.length) {
        return res.status(409).json({
          error:
            'Esse e-mail já pertence a outro usuário.'
        });
      }
    }

    const result = await db.query(
      `
        UPDATE usuarios
        SET
          name =
            COALESCE($1, name),

          email =
            COALESCE($2, email),

          phone =
            COALESCE($3, phone),

          especialidade =
            COALESCE($4, especialidade),

          foto =
            COALESCE($5, foto),

          role =
            COALESCE(
              role,
              perfil,
              'discente'
            ),

          perfil =
            COALESCE(
              perfil,
              role,
              'discente'
            )

        WHERE id = $6

        RETURNING
          id,
          name,
          email,
          phone,
          role,
          perfil,
          especialidade,
          foto
      `,
      [
        name !== undefined
          ? String(name).trim()
          : null,

        emailNormalizado || null,

        phone !== undefined
          ? String(phone)
          : null,

        especialidade !== undefined
          ? String(especialidade)
          : null,

        foto !== undefined
          ? foto
          : null,

        req.user.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Usuário não encontrado.'
      });
    }

    const user =
      buildUser(result.rows[0]);

    const token =
      createToken(user);

    res.json({
      message:
        'Perfil atualizado com sucesso!',

      user,

      token
    });

  } catch (error) {
    console.error(
      '[PATCH ME]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao atualizar o perfil.'
    });
  }
});

/* =========================================================
   TURMAS
   ========================================================= */

app.get('/api/turmas', auth, async (req, res) => {
  try {
    const turmas =
      await getTurmasDoDocente(
        req.user.id
      );

    res.json(turmas);

  } catch (error) {
    console.error(
      '[GET TURMAS]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao buscar turmas.'
    });
  }
});

/* =========================================================
   SALVAR TURMAS / ALUNOS / NOTAS / FREQUÊNCIAS
   ========================================================= */

app.post('/api/turmas', auth, async (req, res) => {
  const turmas = Array.isArray(req.body)
    ? req.body
    : req.body.turmas;

  const replaceAll =
    Array.isArray(req.body)
      ? true
      : req.body.replaceAll === true;

  if (!Array.isArray(turmas)) {
    return res.status(400).json({
      error:
        'Envie um array de turmas ou { turmas: [...] }.'
    });
  }

  const client =
    await db.pool.connect();

  try {
    await client.query('BEGIN');

    const turmaIdsMantidas = [];

    for (const rawTurma of turmas) {
      const turma =
        rawTurma || {};

      const clientId =
        String(
          turma.clientId ||
          (
            typeof turma.id === 'string'
              ? turma.id
              : ''
          ) ||
          `turma_${crypto.randomUUID()}`
        ).slice(0, 100);

      const numericId =
        Number.isInteger(
          Number(turma.id)
        )
          ? Number(turma.id)
          : null;

      let existing = null;

      if (numericId !== null) {
        const r =
          await client.query(
            `
              SELECT id
              FROM turmas
              WHERE id = $1
                AND professor_id = $2
            `,
            [
              numericId,
              req.user.id
            ]
          );

        existing =
          r.rows[0] || null;
      }

      if (!existing) {
        const r =
          await client.query(
            `
              SELECT id
              FROM turmas
              WHERE client_id = $1
                AND professor_id = $2
            `,
            [
              clientId,
              req.user.id
            ]
          );

        existing =
          r.rows[0] || null;
      }

      let turmaId;

      if (existing) {
        turmaId =
          existing.id;

        await client.query(
          `
            UPDATE turmas
            SET
              nome = $1,
              turno = $2,
              badge_class = $3,
              descricao = $4,
              tipo_periodo = $5,
              media_aprovacao = $6,
              professor_nome = $7,
              professor_foto = $8,
              client_id = $9

            WHERE id = $10
              AND professor_id = $11
          `,
          [
            String(
              turma.nome ||
              'SEM NOME'
            ).slice(0, 100),

            turma.turno ||
              'Matutino',

            turma.badgeClass ||
              String(
                turma.turno ||
                'Matutino'
              ).toLowerCase(),

            turma.descricao ||
              '',

            turma.tipoPeriodo ||
              '4_bimestres',

            Number(
              turma.mediaAprovacao ?? 6
            ),

            turma.professorNome ||
              '',

            turma.professorFoto ||
              null,

            clientId,

            turmaId,

            req.user.id
          ]
        );

      } else {
        const r =
          await client.query(
            `
              INSERT INTO turmas
                (
                  client_id,
                  nome,
                  turno,
                  badge_class,
                  descricao,
                  tipo_periodo,
                  media_aprovacao,
                  professor_nome,
                  professor_foto,
                  professor_id
                )

              VALUES
                (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5,
                  $6,
                  $7,
                  $8,
                  $9,
                  $10
                )

              RETURNING id
            `,
            [
              clientId,

              String(
                turma.nome ||
                'SEM NOME'
              ).slice(0, 100),

              turma.turno ||
                'Matutino',

              turma.badgeClass ||
                String(
                  turma.turno ||
                  'Matutino'
                ).toLowerCase(),

              turma.descricao ||
                '',

              turma.tipoPeriodo ||
                '4_bimestres',

              Number(
                turma.mediaAprovacao ?? 6
              ),

              turma.professorNome ||
                '',

              turma.professorFoto ||
                null,

              req.user.id
            ]
          );

        turmaId =
          r.rows[0].id;
      }

      turmaIdsMantidas.push(
        turmaId
      );

      /* =====================================================
         ALUNOS
         ===================================================== */

      const incomingAlunoIds = [];

      const alunos =
        Array.isArray(turma.alunos)
          ? turma.alunos
          : [];

      for (const rawAluno of alunos) {
        const aluno =
          normalizeStudent(
            rawAluno
          );

        const alunoClientId =
          String(
            aluno.clientId ||
            (
              typeof aluno.id === 'string'
                ? aluno.id
                : ''
            ) ||
            `aluno_${crypto.randomUUID()}`
          ).slice(0, 100);

        const numericAlunoId =
          Number.isInteger(
            Number(aluno.id)
          )
            ? Number(aluno.id)
            : null;

        let existingAluno = null;

        if (numericAlunoId !== null) {
          const r =
            await client.query(
              `
                SELECT id
                FROM alunos
                WHERE id = $1
                  AND turma_id = $2
              `,
              [
                numericAlunoId,
                turmaId
              ]
            );

          existingAluno =
            r.rows[0] || null;
        }

        if (!existingAluno) {
          const r =
            await client.query(
              `
                SELECT id
                FROM alunos
                WHERE client_id = $1
                  AND turma_id = $2
              `,
              [
                alunoClientId,
                turmaId
              ]
            );

          existingAluno =
            r.rows[0] || null;
        }

        let alunoId;

        const alunoData = [
          alunoClientId,

          String(
            aluno.nome ||
            'SEM NOME'
          ).slice(0, 255),

          String(
            aluno.matricula ||
            'Não informado'
          ).slice(0, 100),

          String(
            aluno.nascimento ||
            'Não informado'
          ).slice(0, 100),

          String(
            aluno.telefone ||
            'Não informado'
          ).slice(0, 50),

          String(
            aluno.email ||
            'Não informado'
          ).slice(0, 255),

          String(
            aluno.endereco ||
            'Não informado'
          ),

          String(
            aluno.observacoes ||
            ''
          ),

          aluno.foto ||
            null,

          Math.max(
            0,
            Number(
              aluno.faltas || 0
            )
          ),

          JSON.stringify(
            aluno.atividades || []
          )
        ];

        if (existingAluno) {
          alunoId =
            existingAluno.id;

          await client.query(
            `
              UPDATE alunos
              SET
                client_id = $1,
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
                AND turma_id = $13
            `,
            [
              ...alunoData,
              alunoId,
              turmaId
            ]
          );

        } else {
          const r =
            await client.query(
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
                  (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12::jsonb
                  )

                RETURNING id
              `,
              [
                alunoClientId,
                turmaId,
                ...alunoData.slice(1)
              ]
            );

          alunoId =
            r.rows[0].id;
        }

        incomingAlunoIds.push(
          alunoId
        );

        /* ===================================================
           NOTAS
           =================================================== */

        await client.query(
          `
            DELETE FROM notas
            WHERE aluno_id = $1
          `,
          [alunoId]
        );

        for (
          const nota of normalizeGradeEntries(
            aluno.notas
          )
        ) {
          await client.query(
            `
              INSERT INTO notas
                (
                  aluno_id,
                  materia,
                  valor,
                  bimestre,
                  atividade
                )

              VALUES
                (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5
                )
            `,
            [
              alunoId,

              String(
                nota.materia
              ).slice(0, 100),

              nota.valor,

              nota.bimestre ||
                null,

              nota.atividade ||
                null
            ]
          );
        }

        /* ===================================================
           FREQUÊNCIAS
           =================================================== */

        await client.query(
          `
            DELETE FROM frequencias
            WHERE aluno_id = $1
          `,
          [alunoId]
        );

        for (
          const [
            data,
            presente
          ] of Object.entries(
            aluno.historicoFrequencia || {}
          )
        ) {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
              data
            )
          ) {
            continue;
          }

          await client.query(
            `
              INSERT INTO frequencias
                (
                  aluno_id,
                  data,
                  presente
                )

              VALUES
                (
                  $1,
                  $2,
                  $3
                )

              ON CONFLICT
                (aluno_id, data)

              DO UPDATE SET
                presente =
                  EXCLUDED.presente
            `,
            [
              alunoId,
              data,
              Boolean(presente)
            ]
          );
        }
      }

      /* =====================================================
         REMOVE ALUNOS QUE NÃO EXISTEM MAIS NO FRONT-END
         ===================================================== */

      if (
        incomingAlunoIds.length === 0
      ) {
        await client.query(
          `
            DELETE FROM alunos
            WHERE turma_id = $1
          `,
          [turmaId]
        );

      } else {
        await client.query(
          `
            DELETE FROM alunos
            WHERE turma_id = $1
              AND NOT (
                id = ANY($2::int[])
              )
          `,
          [
            turmaId,
            incomingAlunoIds
          ]
        );
      }
    }

    /* =======================================================
       RECONCILIA TURMAS REMOVIDAS NO FRONT-END
       ======================================================= */

    if (replaceAll) {
      if (
        turmaIdsMantidas.length === 0
      ) {
        await client.query(
          `
            DELETE FROM turmas
            WHERE professor_id = $1
          `,
          [req.user.id]
        );

      } else {
        await client.query(
          `
            DELETE FROM turmas
            WHERE professor_id = $1
              AND NOT (
                id = ANY($2::int[])
              )
          `,
          [
            req.user.id,
            turmaIdsMantidas
          ]
        );
      }
    }

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');

    console.error(
      '[SYNC TURMAS]',
      error
    );

    return res.status(500).json({
      error:
        'Erro ao salvar turmas, alunos, notas e frequências.'
    });

  } finally {
    client.release();
  }

  try {
    const saved =
      await getTurmasDoDocente(
        req.user.id
      );

    res.status(200).json({
      message:
        'Dados salvos no Neon!',

      turmas: saved
    });

  } catch (error) {
    console.error(
      '[SYNC RESPONSE]',
      error
    );

    res.status(500).json({
      error:
        'Dados salvos, mas não foi possível recarregar a lista.'
    });
  }
});

/* =========================================================
   EXCLUIR TURMA
   ========================================================= */

app.delete('/api/turmas/:id', auth, async (req, res) => {
  try {
    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error:
          'ID da turma inválido.'
      });
    }

    const result =
      await db.query(
        `
          DELETE FROM turmas
          WHERE id = $1
            AND professor_id = $2
          RETURNING id
        `,
        [
          id,
          req.user.id
        ]
      );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          'Turma não encontrada.'
      });
    }

    res.json({
      message:
        'Turma excluída com sucesso!'
    });

  } catch (error) {
    console.error(
      '[DELETE TURMA]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao excluir turma.'
    });
  }
});

/* =========================================================
   NOTAS DO ALUNO
   ========================================================= */

app.get('/api/alunos/:id/notas', auth, async (req, res) => {
  try {
    const id =
      Number(req.params.id);

    const result =
      await db.query(
        `
          SELECT n.*
          FROM notas n

          JOIN alunos a
            ON a.id = n.aluno_id

          JOIN turmas t
            ON t.id = a.turma_id

          WHERE n.aluno_id = $1
            AND t.professor_id = $2

          ORDER BY n.id ASC
        `,
        [
          id,
          req.user.id
        ]
      );

    res.json(
      result.rows
    );

  } catch (error) {
    console.error(
      '[GET NOTAS]',
      error
    );

    res.status(500).json({
      error:
        'Erro ao buscar notas.'
    });
  }
});

/* =========================================================
   FREQUÊNCIAS DO ALUNO
   ========================================================= */

app.get(
  '/api/alunos/:id/frequencias',
  auth,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const result =
        await db.query(
          `
            SELECT f.*
            FROM frequencias f

            JOIN alunos a
              ON a.id = f.aluno_id

            JOIN turmas t
              ON t.id = a.turma_id

            WHERE f.aluno_id = $1
              AND t.professor_id = $2

            ORDER BY f.data ASC
          `,
          [
            id,
            req.user.id
          ]
        );

      res.json(
        result.rows
      );

    } catch (error) {
      console.error(
        '[GET FREQUENCIAS]',
        error
      );

      res.status(500).json({
        error:
          'Erro ao buscar frequências.'
      });
    }
  }
);

/* =========================================================
   RECUPERAÇÃO DE SENHA
   BREVO SMTP
   ========================================================= */

app.post(
  '/api/forgot-password',
  async (req, res) => {
    try {
      const email =
        String(
          req.body.email || ''
        )
          .trim()
          .toLowerCase();

      if (!email) {
        return res.status(400).json({
          message:
            'Informe um e-mail válido.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              id,
              name,
              email
            FROM usuarios
            WHERE email = $1
          `,
          [email]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          message:
            'E-mail não encontrado no sistema.'
        });
      }

      /* =====================================================
         VERIFICA CONFIGURAÇÃO SMTP
         ===================================================== */

      if (
        !process.env.SMTP_USER ||
        !process.env.SMTP_PASS
      ) {
        console.error(
          '[FORGOT PASSWORD] SMTP_USER ou SMTP_PASS não configurados.'
        );

        return res.status(500).json({
          message:
            'O serviço de e-mail não está configurado no servidor.'
        });
      }

      if (!process.env.EMAIL_FROM) {
        console.error(
          '[FORGOT PASSWORD] EMAIL_FROM não configurado.'
        );

        return res.status(500).json({
          message:
            'O remetente do e-mail não está configurado.'
        });
      }

      const user =
        result.rows[0];

      /* =====================================================
         GERA CÓDIGO
         ===================================================== */

      const code =
        String(
          crypto.randomInt(
            100000,
            1000000
          )
        );

      const codeHash =
        crypto
          .createHash('sha256')
          .update(code)
          .digest('hex');

      /* =====================================================
         SALVA CÓDIGO NO NEON
         ===================================================== */

      await db.query(
        `
          INSERT INTO password_reset_tokens
            (
              usuario_id,
              code_hash,
              expires_at
            )

          VALUES
            (
              $1,
              $2,
              NOW() + INTERVAL '10 minutes'
            )

          ON CONFLICT (usuario_id)

          DO UPDATE SET
            code_hash =
              EXCLUDED.code_hash,

            expires_at =
              EXCLUDED.expires_at,

            created_at =
              NOW()
        `,
        [
          user.id,
          codeHash
        ]
      );

      /* =====================================================
         CONTEÚDO DO E-MAIL
         ===================================================== */

      const html = `
        <div
          style="
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 24px;
            color: #1f2937;
          "
        >

          <h2 style="margin-bottom: 8px;">
            ID HUB
          </h2>

          <p>
            Olá${user.name ? `, ${user.name}` : ''}!
          </p>

          <p>
            Recebemos uma solicitação para
            redefinir a sua senha.
          </p>

          <div
            style="
              font-size: 32px;
              font-weight: 700;
              letter-spacing: 8px;
              text-align: center;
              padding: 18px 0;
            "
          >
            ${code}
          </div>

          <p>
            Este código expira em
            <strong>10 minutos</strong>.
          </p>

          <p
            style="
              color: #6b7280;
              font-size: 13px;
            "
          >
            Se você não solicitou a redefinição,
            ignore este e-mail.
          </p>

        </div>
      `;

      const text = `
Seu código de recuperação do ID HUB é: ${code}

Este código expira em 10 minutos.

Se você não solicitou a redefinição de senha,
ignore este e-mail.
`;

      /* =====================================================
         ENVIA PELA BREVO SMTP
         ===================================================== */

      const info =
        await smtpTransporter.sendMail({
          from:
            process.env.EMAIL_FROM,

          to:
            email,

          subject:
            'Código de recuperação de senha - ID HUB',

          html,

          text
        });

      console.log(
        `[FORGOT PASSWORD] E-mail enviado para ${email}. ID: ${
          info.messageId || 'sem-id'
        }`
      );

      return res.json({
        message:
          'Código de recuperação enviado para seu e-mail.'
      });

    } catch (error) {
      console.error(
        '[FORGOT PASSWORD]',
        error
      );

      return res.status(500).json({
        message:
          'Não foi possível enviar o código de recuperação.'
      });
    }
  }
);

/* =========================================================
   REDEFINIR SENHA
   ========================================================= */

app.post(
  '/api/reset-password',
  async (req, res) => {
    try {
      const email =
        String(
          req.body.email || ''
        )
          .trim()
          .toLowerCase();

      const code =
        String(
          req.body.code || ''
        ).trim();

      const password =
        String(
          req.body.password || ''
        );

      if (
        !email ||
        !/^\d{6}$/.test(code) ||
        password.length < 6
      ) {
        return res.status(400).json({
          message:
            'E-mail, código de 6 dígitos e nova senha são obrigatórios.'
        });
      }

      const userResult =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE email = $1
          `,
          [email]
        );

      if (!userResult.rows.length) {
        return res.status(404).json({
          message:
            'Usuário não encontrado.'
        });
      }

      const userId =
        userResult.rows[0].id;

      const codeHash =
        crypto
          .createHash('sha256')
          .update(code)
          .digest('hex');

      const tokenResult =
        await db.query(
          `
            SELECT id
            FROM password_reset_tokens

            WHERE usuario_id = $1
              AND code_hash = $2
              AND expires_at > NOW()
          `,
          [
            userId,
            codeHash
          ]
        );

      if (!tokenResult.rows.length) {
        return res.status(400).json({
          message:
            'Código de verificação inválido ou expirado.'
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      /*
       * Usa uma conexão dedicada para garantir
       * que UPDATE e DELETE estejam na mesma transação.
       */

      const client =
        await db.pool.connect();

      try {
        await client.query(
          'BEGIN'
        );

        await client.query(
          `
            UPDATE usuarios
            SET senha = $1
            WHERE id = $2
          `,
          [
            hash,
            userId
          ]
        );

        await client.query(
          `
            DELETE FROM password_reset_tokens
            WHERE usuario_id = $1
          `,
          [userId]
        );

        await client.query(
          'COMMIT'
        );

      } catch (transactionError) {
        await client.query(
          'ROLLBACK'
        );

        throw transactionError;

      } finally {
        client.release();
      }

      res.json({
        message:
          'Senha redefinida com sucesso!'
      });

    } catch (error) {
      console.error(
        '[RESET PASSWORD]',
        error
      );

      res.status(500).json({
        message:
          'Erro interno ao redefinir a senha.'
      });
    }
  }
);

/* =========================================================
   INICIAR SERVIDOR
   ========================================================= */

async function start() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL não está configurada.'
      );
    }

    await ensureDatabase();

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `[IDHUB] API online na porta ${PORT}`
        );

        console.log(
          '[IDHUB] Banco de dados inicializado/conferido.'
        );

        console.log(
          '[IDHUB] Sistema de e-mail: Brevo SMTP'
        );
      }
    );

  } catch (error) {
    console.error(
      '[IDHUB] Falha ao iniciar:',
      error
    );

    process.exit(1);
  }
}

start();
```
