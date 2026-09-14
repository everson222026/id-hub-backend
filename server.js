// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname)));

const recoveryCodes = new Map();

// Configuração do Nodemailer usando exclusivamente variáveis de ambiente
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  logger: true,
  debug: true
});

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/cadastro', async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    const senhaUser = req.body.senha || req.body.password;

    if (!senhaUser) {
      return res.status(400).json({ error: 'A senha é obrigatória.' });
    }

    const userExists = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }

    const hashedPassword = await bcrypt.hash(senhaUser, 10);

    const novoUsuario = await db.query(
      'INSERT INTO usuarios (name, email, phone, senha, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role',
      [name, email, phone, hashedPassword, role || 'discente']
    );

    res.status(201).json({ message: 'Usuário cadastrado com sucesso!', user: novoUsuario.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email } = req.body;
    const senhaUser = req.body.senha || req.body.password;

    if (!senhaUser) {
      return res.status(400).json({ error: 'A senha é obrigatória.' });
    }

    const resultado = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ error: 'E-mail ou senha inválidos.' });
    }

    const usuario = resultado.rows[0];
    const senhaValida = await bcrypt.compare(senhaUser, usuario.senha);

    if (!senhaValida) {
      return res.status(400).json({ error: 'E-mail ou senha inválidos.' });
    }

    res.json({ message: 'Login realizado com sucesso!', perfil: usuario.role, email: usuario.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- ROTAS DE RECUPERAÇÃO E REDEFINIÇÃO DE SENHA ---

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const resultado = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ message: 'E-mail não encontrado no sistema.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    recoveryCodes.set(email, code);

    const mailOptions = {
      from: `"ID HUB" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Código de Recuperação de Senha',
      text: `Olá! Seu código de validação para redefinir a senha no ID HUB é: ${code}. Este código é válido por tempo limitado.`
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: 'Código de recuperação gerado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res.status(400).json({ message: 'E-mail, código e nova senha são obrigatórios.' });
    }

    const savedCode = recoveryCodes.get(email);
    if (!savedCode || savedCode !== code) {
      return res.status(400).json({ message: 'Código de verificação inválido ou expirado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const atualizado = await db.query(
      'UPDATE usuarios SET senha = $1 WHERE email = $2 RETURNING email',
      [hashedPassword, email]
    );

    if (atualizado.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    recoveryCodes.delete(email);

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

// --- ROTAS DE DADOS (Turmas, Alunos, Frequências) ---

// Listar Turmas
app.get('/api/turmas', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM turmas');
    const turmas = result.rows.map(row => ({
      id: row.id,
      nome: row.nome,
      turno: row.turno,
      badgeClass: row.badge_class || row.badgeClass,
      descricao: row.descricao,
      tipoPeriodo: row.tipo_periodo || row.tipoPeriodo,
      mediaAprovacao: parseFloat(row.media_aprovacao || row.mediaAprovacao || 6.0),
      professorNome: row.professor_nome || row.professorNome,
      professorFoto: row.professor_foto || row.professorFoto,
      alunos: typeof row.alunos === 'string' ? JSON.parse(row.alunos) : (row.alunos || [])
    }));
    res.json(turmas);
  } catch (err) {
    console.error('Erro ao buscar turmas:', err);
    res.status(500).json({ error: 'Erro ao buscar turmas.' });
  }
});

// Cadastrar/Salvar Turmas
app.post('/api/turmas', async (req, res) => {
  try {
    const list = Array.isArray(req.body) ? req.body : [req.body];

    for (const turma of list) {
      const {
        id,
        nome,
        turno,
        badgeClass,
        descricao,
        tipoPeriodo,
        mediaAprovacao,
        professorNome,
        professorFoto,
        alunos
      } = turma;

      await db.query(`
        INSERT INTO turmas (
          id, nome, turno, badge_class, descricao, tipo_periodo, media_aprovacao, professor_nome, professor_foto, alunos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome,
          turno = EXCLUDED.turno,
          badge_class = EXCLUDED.badge_class,
          descricao = EXCLUDED.descricao,
          tipo_periodo = EXCLUDED.tipo_periodo,
          media_aprovacao = EXCLUDED.media_aprovacao,
          professor_nome = EXCLUDED.professor_nome,
          professor_foto = EXCLUDED.professor_foto,
          alunos = EXCLUDED.alunos
      `, [
        id || `turma_${Date.now()}`,
        nome,
        turno,
        badgeClass || (turno ? turno.toLowerCase() : 'matutino'),
        descricao || '',
        tipoPeriodo || '4_bimestres',
        mediaAprovacao || 6.0,
        professorNome || 'Professor não informado',
        professorFoto || null,
        JSON.stringify(alunos || [])
      ]);
    }

    res.status(201).json({ message: 'Turmas salvas com sucesso no banco de dados Neon!' });
  } catch (err) {
    console.error('Erro ao salvar turma:', err);
    res.status(500).json({ error: 'Erro ao salvar turma no banco de dados.' });
  }
});

// Deletar Turma
app.delete('/api/turmas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM turmas WHERE id = $1', [id]);
    res.json({ message: 'Turma excluída com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir turma:', err);
    res.status(500).json({ error: 'Erro ao excluir turma do banco de dados.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});