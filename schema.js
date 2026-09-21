const db = require('./db');

async function ensureDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(30),
      senha VARCHAR(255) NOT NULL,
      role VARCHAR(50),
      perfil VARCHAR(50),
      especialidade VARCHAR(255),
      foto TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(50);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil VARCHAR(50);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS especialidade VARCHAR(255);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE usuarios
       SET role = COALESCE(NULLIF(role, ''), NULLIF(perfil, ''), 'discente')
     WHERE role IS NULL OR role = '';

    UPDATE usuarios
       SET perfil = COALESCE(NULLIF(perfil, ''), NULLIF(role, ''), 'discente')
     WHERE perfil IS NULL OR perfil = '';

    CREATE TABLE IF NOT EXISTS turmas (
      id SERIAL PRIMARY KEY,
      client_id VARCHAR(100) UNIQUE,
      nome VARCHAR(100) NOT NULL,
      turno VARCHAR(50),
      badge_class VARCHAR(50),
      descricao TEXT,
      tipo_periodo VARCHAR(50) DEFAULT '4_bimestres',
      media_aprovacao NUMERIC(5,2) DEFAULT 6.00,
      professor_nome VARCHAR(255),
      professor_foto TEXT,
      professor_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS client_id VARCHAR(100);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS turno VARCHAR(50);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS badge_class VARCHAR(50);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS descricao TEXT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS tipo_periodo VARCHAR(50) DEFAULT '4_bimestres';
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS media_aprovacao NUMERIC(5,2) DEFAULT 6.00;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_nome VARCHAR(255);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_foto TEXT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_id INT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE turmas SET client_id = 'legacy_turma_' || id WHERE client_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS turmas_client_id_uidx
      ON turmas(client_id);

    CREATE TABLE IF NOT EXISTS alunos (
      id SERIAL PRIMARY KEY,
      client_id VARCHAR(100) UNIQUE,
      turma_id INT NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
      nome VARCHAR(255) NOT NULL,
      matricula VARCHAR(100),
      nascimento VARCHAR(100),
      telefone VARCHAR(50),
      email VARCHAR(255),
      endereco TEXT,
      observacoes TEXT,
      foto TEXT,
      faltas INT DEFAULT 0,
      atividades JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS client_id VARCHAR(100);
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS turma_id INT;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS matricula VARCHAR(100);
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS nascimento VARCHAR(100);
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS telefone VARCHAR(50);
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS endereco TEXT;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS observacoes TEXT;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS foto TEXT;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS faltas INT DEFAULT 0;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS atividades JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE alunos SET client_id = 'legacy_aluno_' || id WHERE client_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS alunos_client_id_uidx
      ON alunos(client_id);

    CREATE TABLE IF NOT EXISTS notas (
      id SERIAL PRIMARY KEY,
      aluno_id INT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      materia VARCHAR(100) NOT NULL,
      valor NUMERIC(7,2) NOT NULL,
      bimestre VARCHAR(50),
      atividade VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE notas ADD COLUMN IF NOT EXISTS bimestre VARCHAR(50);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS atividade VARCHAR(255);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS frequencias (
      id SERIAL PRIMARY KEY,
      aluno_id INT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      data DATE NOT NULL,
      presente BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (aluno_id, data)
    );

    CREATE INDEX IF NOT EXISTS turmas_professor_idx ON turmas(professor_id);
    CREATE INDEX IF NOT EXISTS alunos_turma_idx ON alunos(turma_id);
    CREATE INDEX IF NOT EXISTS notas_aluno_idx ON notas(aluno_id);
    CREATE INDEX IF NOT EXISTS frequencias_aluno_idx ON frequencias(aluno_id);
  `);

  // Migração da FK das turmas caso a tabela tenha sido criada pelo init-db antigo.
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'turmas_professor_id_fkey'
      ) THEN
        BEGIN
          ALTER TABLE turmas
            ADD CONSTRAINT turmas_professor_id_fkey
            FOREIGN KEY (professor_id) REFERENCES usuarios(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END IF;
    END $$;
  `);

  // Normaliza as chaves estrangeiras de estruturas antigas.
  await db.query(`
    UPDATE turmas
       SET professor_id = NULL
     WHERE professor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM usuarios WHERE usuarios.id = turmas.professor_id);

    ALTER TABLE turmas DROP CONSTRAINT IF EXISTS turmas_professor_id_fkey;
    ALTER TABLE turmas
      ADD CONSTRAINT turmas_professor_id_fkey
      FOREIGN KEY (professor_id) REFERENCES usuarios(id) ON DELETE CASCADE;

    ALTER TABLE alunos DROP CONSTRAINT IF EXISTS alunos_turma_id_fkey;
    ALTER TABLE alunos
      ADD CONSTRAINT alunos_turma_id_fkey
      FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE;

    ALTER TABLE notas DROP CONSTRAINT IF EXISTS notas_aluno_id_fkey;
    ALTER TABLE notas
      ADD CONSTRAINT notas_aluno_id_fkey
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE;

    ALTER TABLE frequencias DROP CONSTRAINT IF EXISTS frequencias_aluno_id_fkey;
    ALTER TABLE frequencias
      ADD CONSTRAINT frequencias_aluno_id_fkey
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE;
  `);

  // Se já existirem turmas antigas sem dono, entrega-as ao primeiro docente existente.
  await db.query(`
    UPDATE turmas t
       SET professor_id = u.id
      FROM (
        SELECT id
          FROM usuarios
         WHERE role = 'docente' OR perfil = 'docente'
         ORDER BY id
         LIMIT 1
      ) u
     WHERE t.professor_id IS NULL;
  `);
}

module.exports = { ensureDatabase };
