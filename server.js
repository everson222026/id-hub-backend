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

const PORT = process.env.PORT || 3000;

const JWT_SECRET =
  process.env.JWT_SECRET || 'id-hub-secret-local';

// =========================================================
// CONFIGURAÇÃO DO BREVO SMTP
// =========================================================

const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// =========================================================
// MIDDLEWARES
// =========================================================

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Arquivos públicos
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// BANCO
// =========================================================

const { ensureDatabase } = require('./schema');

// =========================================================
// FUNÇÕES AUXILIARES
// =========================================================

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );
}

function auth(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({
        erro: 'Token não informado.'
      });
    }

    const partes = header.split(' ');

    if (partes.length !== 2 || partes[0] !== 'Bearer') {
      return res.status(401).json({
        erro: 'Formato de token inválido.'
      });
    }

    const token = partes[1];

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.usuario = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      erro: 'Token inválido ou expirado.'
    });
  }
}

function normalizarEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizarTexto(texto) {
  return String(texto || '').trim();
}

function gerarCodigoRecuperacao() {
  return String(
    Math.floor(
      100000 + Math.random() * 900000
    )
  );
}

function hashCodigo(codigo) {
  return crypto
    .createHash('sha256')
    .update(String(codigo))
    .digest('hex');
}

// =========================================================
// BUSCAR TURMAS DO DOCENTE
// =========================================================

async function getTurmasDoDocente(
  docenteId
) {
  const result = await db.query(
    `
      SELECT
        t.id,
        t.nome,
        t.descricao,
        t.created_at,
        COUNT(a.id)::int AS quantidade_alunos
      FROM turmas t
      LEFT JOIN alunos a
        ON a.turma_id = t.id
      WHERE t.docente_id = $1
      GROUP BY
        t.id,
        t.nome,
        t.descricao,
        t.created_at
      ORDER BY t.created_at DESC
    `,
    [docenteId]
  );

  return result.rows;
}

// =========================================================
// HEALTH CHECK
// =========================================================

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');

    res.json({
      ok: true,
      mensagem: 'API funcionando.',
      banco: 'conectado'
    });
  } catch (error) {
    console.error(
      '[HEALTH]',
      error
    );

    res.status(500).json({
      ok: false,
      mensagem: 'API funcionando, mas banco indisponível.'
    });
  }
});

// =========================================================
// CADASTRO
// =========================================================

app.post(
  '/api/cadastro',
  async (req, res) => {
    try {
      const {
        nome,
        email,
        senha,
        tipo
      } = req.body;

      const nomeNormalizado =
        normalizarTexto(nome);

      const emailNormalizado =
        normalizarEmail(email);

      const senhaNormalizada =
        String(senha || '');

      const tipoNormalizado =
        normalizarTexto(tipo || 'docente')
          .toLowerCase();

      if (
        !nomeNormalizado ||
        !emailNormalizado ||
        !senhaNormalizada
      ) {
        return res.status(400).json({
          erro:
            'Nome, e-mail e senha são obrigatórios.'
        });
      }

      if (senhaNormalizada.length < 6) {
        return res.status(400).json({
          erro:
            'A senha deve possuir pelo menos 6 caracteres.'
        });
      }

      const existente =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
          `,
          [emailNormalizado]
        );

      if (existente.rows.length > 0) {
        return res.status(409).json({
          erro:
            'Já existe uma conta com este e-mail.'
        });
      }

      const senhaHash =
        await bcrypt.hash(
          senhaNormalizada,
          10
        );

      const result =
        await db.query(
          `
            INSERT INTO usuarios
              (
                nome,
                email,
                senha,
                tipo
              )
            VALUES
              ($1, $2, $3, $4)
            RETURNING
              id,
              nome,
              email,
              tipo,
              created_at
          `,
          [
            nomeNormalizado,
            emailNormalizado,
            senhaHash,
            tipoNormalizado
          ]
        );

      const usuario =
        result.rows[0];

      const token =
        gerarToken(usuario);

      return res.status(201).json({
        mensagem:
          'Cadastro realizado com sucesso.',
        token,
        usuario
      });
    } catch (error) {
      console.error(
        '[CADASTRO]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro interno ao realizar cadastro.'
      });
    }
  }
);

// =========================================================
// LOGIN
// =========================================================

app.post(
  '/api/login',
  async (req, res) => {
    try {
      const {
        email,
        senha
      } = req.body;

      const emailNormalizado =
        normalizarEmail(email);

      const senhaNormalizada =
        String(senha || '');

      if (
        !emailNormalizado ||
        !senhaNormalizada
      ) {
        return res.status(400).json({
          erro:
            'E-mail e senha são obrigatórios.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              id,
              nome,
              email,
              senha,
              tipo,
              created_at
            FROM usuarios
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
          `,
          [emailNormalizado]
        );

      if (result.rows.length === 0) {
        return res.status(401).json({
          erro:
            'E-mail ou senha incorretos.'
        });
      }

      const usuario =
        result.rows[0];

      const senhaCorreta =
        await bcrypt.compare(
          senhaNormalizada,
          usuario.senha
        );

      if (!senhaCorreta) {
        return res.status(401).json({
          erro:
            'E-mail ou senha incorretos.'
        });
      }

      delete usuario.senha;

      const token =
        gerarToken(usuario);

      return res.json({
        mensagem:
          'Login realizado com sucesso.',
        token,
        usuario
      });
    } catch (error) {
      console.error(
        '[LOGIN]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro interno ao realizar login.'
      });
    }
  }
);

// =========================================================
// USUÁRIO LOGADO
// =========================================================

app.get(
  '/api/me',
  auth,
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
            SELECT
              id,
              nome,
              email,
              tipo,
              created_at
            FROM usuarios
            WHERE id = $1
            LIMIT 1
          `,
          [req.usuario.id]
        );

      if (result.rows.length === 0) {
        return res.status(404).json({
          erro:
            'Usuário não encontrado.'
        });
      }

      return res.json({
        usuario:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        '[ME]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao buscar usuário.'
      });
    }
  }
);

// =========================================================
// ATUALIZAR USUÁRIO
// =========================================================

app.patch(
  '/api/me',
  auth,
  async (req, res) => {
    try {
      const {
        nome,
        email
      } = req.body;

      const nomeNormalizado =
        normalizarTexto(nome);

      const emailNormalizado =
        normalizarEmail(email);

      if (
        !nomeNormalizado ||
        !emailNormalizado
      ) {
        return res.status(400).json({
          erro:
            'Nome e e-mail são obrigatórios.'
        });
      }

      const emailExistente =
        await db.query(
          `
            SELECT id
            FROM usuarios
            WHERE LOWER(email) = LOWER($1)
              AND id <> $2
            LIMIT 1
          `,
          [
            emailNormalizado,
            req.usuario.id
          ]
        );

      if (
        emailExistente.rows.length > 0
      ) {
        return res.status(409).json({
          erro:
            'Este e-mail já está sendo usado.'
        });
      }

      const result =
        await db.query(
          `
            UPDATE usuarios
            SET
              nome = $1,
              email = $2
            WHERE id = $3
            RETURNING
              id,
              nome,
              email,
              tipo,
              created_at
          `,
          [
            nomeNormalizado,
            emailNormalizado,
            req.usuario.id
          ]
        );

      return res.json({
        mensagem:
          'Perfil atualizado com sucesso.',
        usuario:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        '[ME PATCH]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao atualizar perfil.'
      });
    }
  }
);

// =========================================================
// LISTAR TURMAS
// =========================================================

app.get(
  '/api/turmas',
  auth,
  async (req, res) => {
    try {
      const turmas =
        await getTurmasDoDocente(
          req.usuario.id
        );

      return res.json({
        turmas
      });
    } catch (error) {
      console.error(
        '[TURMAS GET]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao buscar turmas.'
      });
    }
  }
);

// =========================================================
// CRIAR TURMA
// =========================================================

app.post(
  '/api/turmas',
  auth,
  async (req, res) => {
    const client =
      await db.pool.connect();

    try {
      const {
        nome,
        descricao,
        alunos
      } = req.body;

      const nomeNormalizado =
        normalizarTexto(nome);

      const descricaoNormalizada =
        normalizarTexto(descricao);

      if (!nomeNormalizado) {
        client.release();

        return res.status(400).json({
          erro:
            'O nome da turma é obrigatório.'
        });
      }

      await client.query(
        'BEGIN'
      );

      const turmaResult =
        await client.query(
          `
            INSERT INTO turmas
              (
                nome,
                descricao,
                docente_id
              )
            VALUES
              ($1, $2, $3)
            RETURNING *
          `,
          [
            nomeNormalizado,
            descricaoNormalizada || null,
            req.usuario.id
          ]
        );

      const turma =
        turmaResult.rows[0];

      const listaAlunos =
        Array.isArray(alunos)
          ? alunos
          : [];

      for (
        const aluno of listaAlunos
      ) {
        const nomeAluno =
          normalizarTexto(
            aluno.nome
          );

        if (!nomeAluno) {
          continue;
        }

        const alunoResult =
          await client.query(
            `
              INSERT INTO alunos
                (
                  turma_id,
                  nome,
                  matricula
                )
              VALUES
                ($1, $2, $3)
              RETURNING id
            `,
            [
              turma.id,
              nomeAluno,
              normalizarTexto(
                aluno.matricula
              ) || null
            ]
          );

        const alunoId =
          alunoResult.rows[0].id;

        // =========================
        // NOTAS
        // =========================

        if (
          Array.isArray(aluno.notas)
        ) {
          for (
            const nota of aluno.notas
          ) {
            await client.query(
              `
                INSERT INTO notas
                  (
                    aluno_id,
                    disciplina,
                    nota,
                    descricao
                  )
                VALUES
                  ($1, $2, $3, $4)
              `,
              [
                alunoId,
                normalizarTexto(
                  nota.disciplina
                ) || null,
                nota.nota ?? null,
                normalizarTexto(
                  nota.descricao
                ) || null
              ]
            );
          }
        }

        // =========================
        // FREQUÊNCIAS
        // =========================

        if (
          Array.isArray(
            aluno.frequencias
          )
        ) {
          for (
            const frequencia of aluno.frequencias
          ) {
            await client.query(
              `
                INSERT INTO frequencias
                  (
                    aluno_id,
                    data,
                    presente
                  )
                VALUES
                  ($1, $2, $3)
              `,
              [
                alunoId,
                frequencia.data,
                Boolean(
                  frequencia.presente
                )
              ]
            );
          }
        }
      }

      await client.query(
        'COMMIT'
      );

      return res.status(201).json({
        mensagem:
          'Turma criada com sucesso.',
        turma
      });
    } catch (error) {
      await client.query(
        'ROLLBACK'
      );

      console.error(
        '[TURMAS POST]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao criar turma.',
        detalhe:
          process.env.NODE_ENV ===
          'development'
            ? error.message
            : undefined
      });
    } finally {
      client.release();
    }
  }
);

// =========================================================
// EXCLUIR TURMA
// =========================================================

app.delete(
  '/api/turmas/:id',
  auth,
  async (req, res) => {
    try {
      const turmaId =
        Number(req.params.id);

      if (!Number.isInteger(turmaId)) {
        return res.status(400).json({
          erro:
            'ID da turma inválido.'
        });
      }

      const result =
        await db.query(
          `
            DELETE FROM turmas
            WHERE id = $1
              AND docente_id = $2
            RETURNING id
          `,
          [
            turmaId,
            req.usuario.id
          ]
        );

      if (result.rows.length === 0) {
        return res.status(404).json({
          erro:
            'Turma não encontrada.'
        });
      }

      return res.json({
        mensagem:
          'Turma excluída com sucesso.'
      });
    } catch (error) {
      console.error(
        '[TURMAS DELETE]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao excluir turma.'
      });
    }
  }
);

// =========================================================
// NOTAS DO ALUNO
// =========================================================

app.get(
  '/api/alunos/:id/notas',
  auth,
  async (req, res) => {
    try {
      const alunoId =
        Number(req.params.id);

      if (!Number.isInteger(alunoId)) {
        return res.status(400).json({
          erro:
            'ID do aluno inválido.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              n.*
            FROM notas n
            INNER JOIN alunos a
              ON a.id = n.aluno_id
            INNER JOIN turmas t
              ON t.id = a.turma_id
            WHERE
              a.id = $1
              AND t.docente_id = $2
            ORDER BY n.id DESC
          `,
          [
            alunoId,
            req.usuario.id
          ]
        );

      return res.json({
        notas:
          result.rows
      });
    } catch (error) {
      console.error(
        '[NOTAS]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao buscar notas.'
      });
    }
  }
);

// =========================================================
// FREQUÊNCIAS DO ALUNO
// =========================================================

app.get(
  '/api/alunos/:id/frequencias',
  auth,
  async (req, res) => {
    try {
      const alunoId =
        Number(req.params.id);

      if (!Number.isInteger(alunoId)) {
        return res.status(400).json({
          erro:
            'ID do aluno inválido.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              f.*
            FROM frequencias f
            INNER JOIN alunos a
              ON a.id = f.aluno_id
            INNER JOIN turmas t
              ON t.id = a.turma_id
            WHERE
              a.id = $1
              AND t.docente_id = $2
            ORDER BY f.data DESC
          `,
          [
            alunoId,
            req.usuario.id
          ]
        );

      return res.json({
        frequencias:
          result.rows
      });
    } catch (error) {
      console.error(
        '[FREQUENCIAS]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao buscar frequências.'
      });
    }
  }
);

// =========================================================
// ESQUECI A SENHA
// =========================================================

app.post(
  '/api/forgot-password',
  async (req, res) => {
    try {
      const email =
        normalizarEmail(
          req.body.email
        );

      if (!email) {
        return res.status(400).json({
          erro:
            'Informe seu e-mail.'
        });
      }

      const result =
        await db.query(
          `
            SELECT
              id,
              nome,
              email
            FROM usuarios
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
          `,
          [email]
        );

      /*
       * Mesmo quando o e-mail não existe,
       * retornamos uma resposta genérica.
       * Isso evita revelar quais e-mails
       * possuem cadastro.
       */

      if (result.rows.length === 0) {
        return res.json({
          mensagem:
            'Se o e-mail estiver cadastrado, você receberá um código de recuperação.'
        });
      }

      const usuario =
        result.rows[0];

      const codigo =
        gerarCodigoRecuperacao();

      const codigoHash =
        hashCodigo(codigo);

      // Código válido por 15 minutos
      const expiracao =
        new Date(
          Date.now() +
            15 * 60 * 1000
        );

      await db.query(
        `
          DELETE FROM password_reset_tokens
          WHERE usuario_id = $1
        `,
        [usuario.id]
      );

      await db.query(
        `
          INSERT INTO password_reset_tokens
            (
              usuario_id,
              token,
              expires_at
            )
          VALUES
            ($1, $2, $3)
        `,
        [
          usuario.id,
          codigoHash,
          expiracao
        ]
      );

      // =====================================================
      // ENVIO DO E-MAIL PELO BREVO
      // =====================================================

      await smtpTransporter.sendMail({
        from:
          process.env.EMAIL_FROM ||
          process.env.SMTP_USER,

        to:
          usuario.email,

        subject:
          'ID HUB - Código para redefinir sua senha',

        text:
`Olá, ${usuario.nome}!

Recebemos uma solicitação para redefinir a senha da sua conta no ID HUB.

Seu código de recuperação é:

${codigo}

Esse código é válido por 15 minutos.

Se você não solicitou a redefinição de senha, ignore este e-mail.

ID HUB`,

        html:
`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">

  <title>
    Recuperação de senha - ID HUB
  </title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background:#f4f6f8;
    font-family:Arial,Helvetica,sans-serif;
  "
>

  <div
    style="
      max-width:600px;
      margin:40px auto;
      background:#ffffff;
      border-radius:16px;
      padding:35px;
      box-sizing:border-box;
    "
  >

    <h1
      style="
        margin-top:0;
        color:#222222;
      "
    >
      ID HUB
    </h1>

    <h2
      style="
        color:#333333;
      "
    >
      Recuperação de senha
    </h2>

    <p
      style="
        color:#555555;
        font-size:16px;
        line-height:1.6;
      "
    >
      Olá, ${usuario.nome}!
    </p>

    <p
      style="
        color:#555555;
        font-size:16px;
        line-height:1.6;
      "
    >
      Recebemos uma solicitação para
      redefinir a senha da sua conta no
      <strong>ID HUB</strong>.
    </p>

    <p
      style="
        color:#555555;
        font-size:16px;
        line-height:1.6;
      "
    >
      Seu código de recuperação é:
    </p>

    <div
      style="
        text-align:center;
        margin:30px 0;
      "
    >

      <span
        style="
          display:inline-block;
          padding:18px 30px;
          background:#f1f3f5;
          border-radius:12px;
          font-size:32px;
          font-weight:bold;
          letter-spacing:8px;
          color:#222222;
        "
      >
        ${codigo}
      </span>

    </div>

    <p
      style="
        color:#777777;
        font-size:14px;
        line-height:1.6;
      "
    >
      Esse código é válido por
      <strong>15 minutos</strong>.
    </p>

    <p
      style="
        color:#777777;
        font-size:14px;
        line-height:1.6;
      "
    >
      Se você não solicitou a redefinição
      de senha, basta ignorar este e-mail.
    </p>

    <hr
      style="
        border:none;
        border-top:1px solid #eeeeee;
        margin:30px 0;
      "
    >

    <p
      style="
        color:#999999;
        font-size:12px;
        text-align:center;
      "
    >
      ID HUB
    </p>

  </div>

</body>
</html>
`
      });

      console.log(
        `[EMAIL] Código de recuperação enviado para ${usuario.email}`
      );

      return res.json({
        mensagem:
          'Se o e-mail estiver cadastrado, você receberá um código de recuperação.'
      });
    } catch (error) {
      console.error(
        '[FORGOT PASSWORD]',
        error
      );

      return res.status(500).json({
        erro:
          'Não foi possível enviar o código de recuperação.'
      });
    }
  }
);

// =========================================================
// REDEFINIR SENHA
// =========================================================

app.post(
  '/api/reset-password',
  async (req, res) => {
    const client =
      await db.pool.connect();

    try {
      const {
        email,
        codigo,
        novaSenha
      } = req.body;

      const emailNormalizado =
        normalizarEmail(email);

      const codigoNormalizado =
        String(codigo || '')
          .trim();

      const senhaNormalizada =
        String(novaSenha || '');

      if (
        !emailNormalizado ||
        !codigoNormalizado ||
        !senhaNormalizada
      ) {
        return res.status(400).json({
          erro:
            'E-mail, código e nova senha são obrigatórios.'
        });
      }

      if (
        senhaNormalizada.length < 6
      ) {
        return res.status(400).json({
          erro:
            'A nova senha deve possuir pelo menos 6 caracteres.'
        });
      }

      const usuarioResult =
        await client.query(
          `
            SELECT
              id,
              email
            FROM usuarios
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
          `,
          [emailNormalizado]
        );

      if (
        usuarioResult.rows.length === 0
      ) {
        return res.status(400).json({
          erro:
            'Código inválido ou expirado.'
        });
      }

      const usuario =
        usuarioResult.rows[0];

      const codigoHash =
        hashCodigo(
          codigoNormalizado
        );

      const tokenResult =
        await client.query(
          `
            SELECT
              id,
              expires_at
            FROM password_reset_tokens
            WHERE
              usuario_id = $1
              AND token = $2
            ORDER BY id DESC
            LIMIT 1
          `,
          [
            usuario.id,
            codigoHash
          ]
        );

      if (
        tokenResult.rows.length === 0
      ) {
        return res.status(400).json({
          erro:
            'Código inválido ou expirado.'
        });
      }

      const token =
        tokenResult.rows[0];

      if (
        new Date(token.expires_at)
          .getTime() < Date.now()
      ) {
        await client.query(
          `
            DELETE FROM password_reset_tokens
            WHERE id = $1
          `,
          [token.id]
        );

        return res.status(400).json({
          erro:
            'Código inválido ou expirado.'
        });
      }

      const novaSenhaHash =
        await bcrypt.hash(
          senhaNormalizada,
          10
        );

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
          novaSenhaHash,
          usuario.id
        ]
      );

      // Código só pode ser utilizado uma vez
      await client.query(
        `
          DELETE FROM password_reset_tokens
          WHERE id = $1
        `,
        [token.id]
      );

      await client.query(
        'COMMIT'
      );

      return res.json({
        mensagem:
          'Senha redefinida com sucesso.'
      });
    } catch (error) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch (_) {}

      console.error(
        '[RESET PASSWORD]',
        error
      );

      return res.status(500).json({
        erro:
          'Erro ao redefinir senha.'
      });
    } finally {
      client.release();
    }
  }
);

// =========================================================
// ROTA PRINCIPAL
// =========================================================

app.get('/', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );
});

// =========================================================
// 404 DA API
// =========================================================

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      erro:
        'Rota da API não encontrada.'
    });
  }
);

// =========================================================
// TRATAMENTO DE ERRO
// =========================================================

app.use(
  (error, req, res, next) => {
    console.error(
      '[SERVER ERROR]',
      error
    );

    res.status(500).json({
      erro:
        'Erro interno do servidor.'
    });
  }
);

// =========================================================
// INICIAR SERVIDOR
// =========================================================

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