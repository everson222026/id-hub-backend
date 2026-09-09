const db = require('./db');

async function setupDatabase() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        senha VARCHAR(255) NOT NULL,
        perfil VARCHAR(50) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turmas (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alunos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        turma_id INT REFERENCES turmas(id)
      );

      CREATE TABLE IF NOT EXISTS notas (
        id SERIAL PRIMARY KEY,
        aluno_id INT REFERENCES alunos(id),
        materia VARCHAR(100) NOT NULL,
        valor NUMERIC(5,2) NOT NULL
      );
    `);
    console.log("Tabelas criadas com sucesso no Neon!");
    process.exit(0);
  } catch (err) {
    console.error("Erro ao criar tabelas:", err);
    process.exit(1);
  }
}

setupDatabase();