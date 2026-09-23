const db = require('./db');

async function ensureDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      telefone VARCHAR(30),
      senha VARCHAR(255) NOT NULL,
      tipo VARCHAR(50) DEFAULT 'docente',
      especialidade VARCHAR(255),
      foto TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),

      -- Colunas legadas mantidas para compatibilidade com versões antigas.
      name VARCHAR(255),
      phone VARCHAR(30),
      role VARCHAR(50),
      perfil VARCHAR(50)
    );

    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome VARCHAR(255);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone VARCHAR(30);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS especialidade VARCHAR(255);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(50);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil VARCHAR(50);

    UPDATE usuarios
       SET nome = COALESCE(NULLIF(nome, ''), NULLIF(name, ''), 'Usuário')
     WHERE nome IS NULL OR nome = '';

    UPDATE usuarios
       SET telefone = COALESCE(NULLIF(telefone, ''), NULLIF(phone, ''))
     WHERE telefone IS NULL OR telefone = '';

    UPDATE usuarios
       SET tipo = COALESCE(NULLIF(tipo, ''), NULLIF(role, ''), NULLIF(perfil, ''), 'docente')
     WHERE tipo IS NULL OR tipo = '';

    UPDATE usuarios SET name = COALESCE(NULLIF(name, ''), nome);
    UPDATE usuarios SET phone = COALESCE(NULLIF(phone, ''), telefone);
    UPDATE usuarios SET role = COALESCE(NULLIF(role, ''), tipo);
    UPDATE usuarios SET perfil = COALESCE(NULLIF(perfil, ''), tipo);

    CREATE TABLE IF NOT EXISTS turmas (
      id SERIAL PRIMARY KEY,
      client_id VARCHAR(100) UNIQUE,
      nome VARCHAR(100) NOT NULL,
      turno VARCHAR(50),
      badge_class VARCHAR(50),
      descricao TEXT,
      tipo_periodo VARCHAR(50) DEFAULT 'bimestre',
      qtd_periodo INT DEFAULT 4,
      media_aprovacao NUMERIC(5,2) DEFAULT 6.00,
      materias JSONB NOT NULL DEFAULT '[]'::jsonb,
      professor_nome VARCHAR(255),
      professor_foto TEXT,
      docente_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),

      -- Coluna legada.
      professor_id INT
    );

    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS client_id VARCHAR(100);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS turno VARCHAR(50);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS badge_class VARCHAR(50);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS descricao TEXT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS tipo_periodo VARCHAR(50) DEFAULT 'bimestre';
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS qtd_periodo INT DEFAULT 4;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS media_aprovacao NUMERIC(5,2) DEFAULT 6.00;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS materias JSONB;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_nome VARCHAR(255);
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_foto TEXT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS docente_id INT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS professor_id INT;
    ALTER TABLE turmas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE turmas SET client_id = 'legacy_turma_' || id WHERE client_id IS NULL OR client_id = '';
    UPDATE turmas SET docente_id = professor_id WHERE docente_id IS NULL AND professor_id IS NOT NULL;
    UPDATE turmas SET materias = '[]'::jsonb WHERE materias IS NULL;
    UPDATE turmas SET tipo_periodo = COALESCE(NULLIF(tipo_periodo, ''), 'bimestre');
    UPDATE turmas SET qtd_periodo = COALESCE(qtd_periodo, 4);
    UPDATE turmas SET media_aprovacao = COALESCE(media_aprovacao, 6.00);

    CREATE UNIQUE INDEX IF NOT EXISTS turmas_client_id_uidx ON turmas(client_id);
    CREATE INDEX IF NOT EXISTS turmas_docente_idx ON turmas(docente_id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'turmas_docente_id_fkey'
      ) THEN
        ALTER TABLE turmas
          ADD CONSTRAINT turmas_docente_id_fkey
          FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END $$;

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
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS atividades JSONB;
    ALTER TABLE alunos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE alunos SET client_id = 'legacy_aluno_' || id WHERE client_id IS NULL OR client_id = '';
    UPDATE alunos SET atividades = '[]'::jsonb WHERE atividades IS NULL;
    UPDATE alunos SET faltas = COALESCE(faltas, 0);

    CREATE UNIQUE INDEX IF NOT EXISTS alunos_client_id_uidx ON alunos(client_id);
    CREATE INDEX IF NOT EXISTS alunos_turma_idx ON alunos(turma_id);

    CREATE TABLE IF NOT EXISTS notas (
      id SERIAL PRIMARY KEY,
      aluno_id INT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      materia VARCHAR(100),
      valor NUMERIC(7,2),
      bimestre VARCHAR(50),
      atividade VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),

      -- Colunas legadas de versões anteriores.
      disciplina VARCHAR(100),
      nota NUMERIC(7,2),
      descricao VARCHAR(255)
    );

    ALTER TABLE notas ADD COLUMN IF NOT EXISTS materia VARCHAR(100);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS valor NUMERIC(7,2);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS bimestre VARCHAR(50);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS atividade VARCHAR(255);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS disciplina VARCHAR(100);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS nota NUMERIC(7,2);
    ALTER TABLE notas ADD COLUMN IF NOT EXISTS descricao VARCHAR(255);

    UPDATE notas SET materia = COALESCE(NULLIF(materia, ''), disciplina) WHERE materia IS NULL OR materia = '';
    UPDATE notas SET valor = COALESCE(valor, nota) WHERE valor IS NULL;
    UPDATE notas SET disciplina = COALESCE(NULLIF(disciplina, ''), materia) WHERE disciplina IS NULL OR disciplina = '';
    UPDATE notas SET nota = COALESCE(nota, valor) WHERE nota IS NULL;
    UPDATE notas SET atividade = COALESCE(NULLIF(atividade, ''), descricao) WHERE atividade IS NULL OR atividade = '';

    CREATE INDEX IF NOT EXISTS notas_aluno_idx ON notas(aluno_id);

    CREATE TABLE IF NOT EXISTS frequencias (
      id SERIAL PRIMARY KEY,
      aluno_id INT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      data DATE NOT NULL,
      presente BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS frequencias_aluno_data_uidx
      ON frequencias(aluno_id, data);
    CREATE INDEX IF NOT EXISTS frequencias_aluno_idx ON frequencias(aluno_id);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      usuario_id INT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
      code_hash CHAR(64),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS code_hash CHAR(64);
    ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
      ON password_reset_tokens(expires_at);
  `);

  // Garante que as FKs de estruturas antigas continuem corretas.
  await db.query(`
    UPDATE turmas
       SET docente_id = NULL
     WHERE docente_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM usuarios WHERE usuarios.id = turmas.docente_id);

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

  // Turmas antigas sem dono ficam associadas ao primeiro docente existente.
  await db.query(`
    UPDATE turmas t
       SET docente_id = u.id,
           professor_id = u.id
      FROM (
        SELECT id
        FROM usuarios
        WHERE tipo = 'docente' OR role = 'docente' OR perfil = 'docente'
        ORDER BY id
        LIMIT 1
      ) u
     WHERE t.docente_id IS NULL;
  `);
}

module.exports = { ensureDatabase };
