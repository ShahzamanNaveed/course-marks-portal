require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');

const sourcePath = path.resolve(process.env.SQLITE_PATH || './data/marks.db');
const sqlite = new DatabaseSync(sourcePath, { readOnly: true });

function all(table) {
  return sqlite.prepare(`SELECT * FROM ${table}`).all();
}

async function main() {
  const source = {
    admins: all('admins'),
    students: all('students'),
    courses: all('courses'),
    enrollments: all('enrollments'),
    assessments: all('assessments'),
    marks: all('marks'),
  };

  await db.withTransaction(async (client) => {
    for (const row of source.admins) {
      await client.query(
        `INSERT INTO admins (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
        [row.id, row.username, row.password_hash, row.created_at]
      );
    }
    for (const row of source.students) {
      const existing = await client.query(
        'SELECT password_hash FROM students WHERE roll_number = $1',
        [row.roll_number]
      );
      const passwordHash = existing.rows[0]?.password_hash || row.password_hash || null;
      await client.query(
        `INSERT INTO students (roll_number, name, password_hash, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (roll_number) DO UPDATE SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash`,
        [row.roll_number, row.name, passwordHash, row.created_at]
      );
    }
    for (const row of source.courses) {
      await client.query(
        `INSERT INTO courses (id, code, name, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
        [row.id, row.code, row.name, row.created_at]
      );
    }
    for (const row of source.enrollments) {
      await client.query(
        `INSERT INTO enrollments (student_roll_number, course_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [row.student_roll_number, row.course_id]
      );
    }
    for (const row of source.assessments) {
      await client.query(
        `INSERT INTO assessments (id, course_id, type, title, max_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET course_id = EXCLUDED.course_id, type = EXCLUDED.type,
           title = EXCLUDED.title, max_score = EXCLUDED.max_score`,
        [row.id, row.course_id, row.type, row.title, row.max_score, row.created_at]
      );
    }
    for (const row of source.marks) {
      await client.query(
        `INSERT INTO marks (assessment_id, student_roll_number, score, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (assessment_id, student_roll_number)
         DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at`,
        [row.assessment_id, row.student_roll_number, row.score, row.updated_at]
      );
    }
    await client.query(`SELECT setval(pg_get_serial_sequence('admins', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM admins`);
    await client.query(`SELECT setval(pg_get_serial_sequence('courses', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM courses`);
    await client.query(`SELECT setval(pg_get_serial_sequence('assessments', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM assessments`);
  });

  console.log('SQLite migration complete:');
  for (const [table, rows] of Object.entries(source)) console.log(`  ${table}: ${rows.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
    return db.pool.end();
  });
