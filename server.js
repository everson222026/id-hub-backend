// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname)));

const recoveryCodes = new Map();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'idhub2026@gmail.com',
    pass: 'wvcxtplejmhrvcnl'
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
      from: '"ID HUB" <idhub2026@gmail.com>',
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

// --- ROTAS DE DADOS ---

app.get('/api/turmas', async (req, res) => {
  try {
    const turmas = await db.query('SELECT * FROM turmas');
    res.json(turmas.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar turmas.' });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const { nome, turma_id } = req.body;
    const novoAluno = await db.query(
      'INSERT INTO alunos (nome, turma_id) VALUES ($1, $2) RETURNING *',
      [nome, turma_id]
    );
    res.status(201).json(novoAluno.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});
app.post('/api/frequencias', async (req, res) => {
  try {
    const { aluno_id, turma_id, data, status } = req.body;
    const novaFreq = await db.query(
      'INSERT INTO frequencias (aluno_id, turma_id, data, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [aluno_id, turma_id, data, status]
    );
    res.status(201).json(novaFreq.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar frequência.' });
  }
});
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});