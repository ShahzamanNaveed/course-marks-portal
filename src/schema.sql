CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  roll_number   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_email_otps (
  id          BIGSERIAL PRIMARY KEY,
  roll_number TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('password_setup', 'password_reset')),
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  quiz_weightage       DOUBLE PRECISION NOT NULL DEFAULT 50,
  assignment_weightage DOUBLE PRECISION NOT NULL DEFAULT 50,
  best_quizzes         INTEGER NOT NULL DEFAULT 0,
  best_assignments     INTEGER NOT NULL DEFAULT 0,
  quiz_total_abs       DOUBLE PRECISION NOT NULL DEFAULT 10,
  assignment_total_abs DOUBLE PRECISION NOT NULL DEFAULT 10,
  lab_total_abs        DOUBLE PRECISION NOT NULL DEFAULT 0,
  cp_total_abs         DOUBLE PRECISION NOT NULL DEFAULT 0,
  other_total_abs      DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS quiz_weightage DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS assignment_weightage DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS best_quizzes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS best_assignments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS quiz_total_abs DOUBLE PRECISION NOT NULL DEFAULT 10;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS assignment_total_abs DOUBLE PRECISION NOT NULL DEFAULT 10;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_total_abs DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cp_total_abs DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS other_total_abs DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS enrollments (
  student_roll_number TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  course_id            INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (student_roll_number, course_id)
);

CREATE TABLE IF NOT EXISTS assessments (
  id         SERIAL PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('assignment', 'quiz')),
  title      TEXT NOT NULL,
  max_score  DOUBLE PRECISION NOT NULL CHECK (max_score > 0),
  absolute_score DOUBLE PRECISION NOT NULL DEFAULT 2 CHECK (absolute_score > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS absolute_score DOUBLE PRECISION NOT NULL DEFAULT 2;
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_type_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_type_check CHECK (type IN ('assignment', 'quiz', 'lab', 'cp', 'other'));

CREATE TABLE IF NOT EXISTS marks (
  assessment_id        INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_roll_number  TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  score                DOUBLE PRECISION,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, student_roll_number)
);

CREATE TABLE IF NOT EXISTS notifications (
  id                    BIGSERIAL PRIMARY KEY,
  student_roll_number   TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assessment_id         INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  old_score             DOUBLE PRECISION,
  new_score             DOUBLE PRECISION,
  message               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  read_at               TIMESTAMPTZ,
  approved_by           INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at           TIMESTAMPTZ,
  UNIQUE (student_roll_number, assessment_id, old_score, new_score)
);

CREATE TABLE IF NOT EXISTS queries (
  id                    BIGSERIAL PRIMARY KEY,
  student_roll_number   TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  category              TEXT NOT NULL CHECK (category IN ('quiz', 'assignment', 'assessment_marks', 'attendance', 'other')),
  subject               TEXT NOT NULL,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  admin_response        TEXT,
  responded_by          INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS query_notifications (
  id                    BIGSERIAL PRIMARY KEY,
  query_id              BIGINT NOT NULL UNIQUE REFERENCES queries(id) ON DELETE CASCADE,
  student_roll_number   TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  message               TEXT NOT NULL,
  read_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments(course_id);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_roll_number);
CREATE INDEX IF NOT EXISTS idx_student_otps_lookup
  ON student_email_otps(roll_number, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_student
  ON notifications(student_roll_number, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status
  ON notifications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_student
  ON queries(student_roll_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_filter
  ON queries(course_id, status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_notifications_student
  ON query_notifications(student_roll_number, created_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
