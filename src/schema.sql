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

CREATE TABLE IF NOT EXISTS courses (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marks (
  assessment_id        INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_roll_number  TEXT NOT NULL REFERENCES students(roll_number) ON DELETE CASCADE,
  score                DOUBLE PRECISION,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, student_roll_number)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments(course_id);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_roll_number);
