require('dotenv').config();
const db = require('./db');
const { ensureDatabase } = require('./schema');

async function setupDatabase() {
  try {
    await ensureDatabase();
    console.log('Estrutura do ID HUB criada/conferida com sucesso no PostgreSQL/Neon.');
  } catch (err) {
    console.error('Erro ao preparar o banco:', err);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

setupDatabase();
