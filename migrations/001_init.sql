-- gezyspv-pro — migrasi 001: skema awal (Fase 0)
-- Dialek MariaDB. Dijalankan berurutan oleh src/db.ts; setiap berkas
-- dicatat di tabel `migrations` sehingga migrasi idempotent.
-- Sumber: implementation plan bagian 5.

CREATE TABLE IF NOT EXISTS migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY CHECK (id = 1),
  school_name VARCHAR(255) NOT NULL DEFAULT 'SMPN 1 Punggur',
  school_address VARCHAR(255),
  principal_name VARCHAR(255),
  signature_place VARCHAR(255) NOT NULL DEFAULT 'Seputih Agung'
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  nip VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'supervisor', 'guru')),
  is_principal TINYINT(1) NOT NULL DEFAULT 0,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  starts_on DATE, ends_on DATE,
  is_active TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  level_label VARCHAR(100),
  UNIQUE (period_id, name),
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

CREATE TABLE IF NOT EXISTS class_teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT NOT NULL,
  user_id INT NOT NULL,
  subject_label VARCHAR(100),
  UNIQUE (class_id, user_id, subject_label),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS supervisor_assignments (
  supervisor_id INT NOT NULL,
  teacher_id INT NOT NULL,
  PRIMARY KEY (supervisor_id, teacher_id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT,
  title VARCHAR(255) NOT NULL,
  basis VARCHAR(255),
  version_label VARCHAR(50),
  score_scale TINYINT NOT NULL DEFAULT 4
    CHECK (score_scale IN (4, 10, 100)),
  status VARCHAR(20) NOT NULL DEFAULT 'draf'
    CHECK (status IN ('draf', 'aktif', 'arsip')),
  is_seed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS template_predicates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  min_score DECIMAL(5,2) NOT NULL,
  max_score DECIMAL(5,2) NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_principles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_elements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  code VARCHAR(10) NOT NULL,
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_indicators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  element_id INT NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (element_id) REFERENCES template_elements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_scale_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  v INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  UNIQUE (template_id, v),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('pra', 'pasca')),
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS template_rtl_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT,
  supervisor_id INT NOT NULL,
  teacher_id INT NOT NULL,
  class_id INT NOT NULL,
  period_id INT NOT NULL,
  subject_theme VARCHAR(255),
  phase_semester VARCHAR(100),
  observed_at DATE NOT NULL,
  observed_time VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pra'
    CHECK (status IN ('pra', 'observasi', 'pasca', 'tindak_lanjut', 'selesai')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id),
  FOREIGN KEY (teacher_id) REFERENCES users(id),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

CREATE TABLE IF NOT EXISTS session_principles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_indicators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_indicator_id INT,
  element_code VARCHAR(10) NOT NULL,
  element_title VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_indicator_id) REFERENCES template_indicators(id)
);

CREATE TABLE IF NOT EXISTS session_scale_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  v INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  UNIQUE (session_id, v),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_predicates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  min_score DECIMAL(5,2) NOT NULL,
  max_score DECIMAL(5,2) NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_question_id INT,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('pra', 'pasca')),
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_question_id) REFERENCES template_questions(id)
);

CREATE TABLE IF NOT EXISTS session_rtl_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_rtl_item_id INT,
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_rtl_item_id) REFERENCES template_rtl_items(id)
);

CREATE TABLE IF NOT EXISTS pra_responses (
  session_id INT NOT NULL,
  session_question_id INT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_question_id) REFERENCES session_questions(id)
);

CREATE TABLE IF NOT EXISTS observation_scores (
  session_id INT NOT NULL,
  session_indicator_id INT NOT NULL,
  value INT,
  evidence TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_indicator_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_indicator_id) REFERENCES session_indicators(id)
);

CREATE TABLE IF NOT EXISTS pasca_responses (
  session_id INT NOT NULL,
  session_question_id INT NOT NULL,
  guru_note TEXT NOT NULL DEFAULT '',
  supervisor_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_question_id) REFERENCES session_questions(id)
);

CREATE TABLE IF NOT EXISTS growth_plan (
  session_id INT NOT NULL,
  session_rtl_item_id INT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_rtl_item_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_rtl_item_id) REFERENCES session_rtl_items(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('foto', 'video_url')),
  path VARCHAR(255),
  url VARCHAR(500),
  caption VARCHAR(200),
  mime VARCHAR(100), bytes INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'foto' AND path IS NOT NULL) OR (kind = 'video_url' AND url IS NOT NULL)),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_narratives (
  session_id INT PRIMARY KEY,
  narrative TEXT NOT NULL,
  edited_by INT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (edited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(50), entity_id INT,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_teacher ON sessions(teacher_id, observed_at);
CREATE INDEX idx_sessions_period ON sessions(period_id, observed_at);
CREATE INDEX idx_sessions_class ON sessions(class_id, observed_at);
