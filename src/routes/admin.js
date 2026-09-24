const express = require('express');
const db = require('../db');
const { requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.get('/courses', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.code, c.name, COUNT(e.student_roll_number)::int AS student_count
     FROM courses c
     LEFT JOIN enrollments e ON e.course_id = c.id
     GROUP BY c.id
     ORDER BY c.code`
  );
  res.json(rows);
}));

router.post('/courses', asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();
  if (!code || !name) return res.status(400).json({ error: 'Course code and name are required.' });
  if (code.length > 50 || name.length > 200) return res.status(400).json({ error: 'Course code or name is too long.' });

  const result = await db.query(
    `INSERT INTO courses (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING RETURNING id, code, name`,
    [code, name]
  );
  if (!result.rowCount) return res.status(409).json({ error: 'A course with that code already exists.' });
  res.status(201).json(result.rows[0]);
}));

router.get('/courses/:courseId/students', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });
  const { rows } = await db.query(
    `SELECT s.roll_number, s.name, (s.password_hash IS NOT NULL) AS password_set
     FROM students s
     JOIN enrollments e ON e.student_roll_number = s.roll_number
     WHERE e.course_id = $1
     ORDER BY s.roll_number`,
    [courseId]
  );
  res.json(rows);
}));

router.post('/courses/:courseId/roster', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });
  if (!(await db.maybeOne('SELECT 1 FROM courses WHERE id = $1', [courseId]))) {
    return res.status(404).json({ error: 'Course not found.' });
  }

  const rows = Array.isArray(req.body.students) ? req.body.students : [];
  if (!rows.length) return res.status(400).json({ error: 'No students provided.' });
  if (rows.length > 2_000) return res.status(400).json({ error: 'Upload at most 2,000 students at a time.' });

  let added = 0;
  let enrolled = 0;
  const errors = [];
  await db.withTransaction(async (client) => {
    for (const row of rows) {
      const rollNumber = String(row.roll_number || '').trim();
      const name = String(row.name || '').trim();
      if (!rollNumber || !name || rollNumber.length > 100 || name.length > 200) {
        errors.push(`Skipped invalid row: ${JSON.stringify(row)}`);
        continue;
      }
      const studentResult = await client.query(
        `INSERT INTO students (roll_number, name) VALUES ($1, $2)
         ON CONFLICT (roll_number) DO NOTHING RETURNING roll_number`,
        [rollNumber, name]
      );
      added += studentResult.rowCount;
      const enrollmentResult = await client.query(
        `INSERT INTO enrollments (student_roll_number, course_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [rollNumber, courseId]
      );
      enrolled += enrollmentResult.rowCount;
    }
  });

  res.json({ added, enrolled, total_submitted: rows.length, errors });
}));

router.post('/students/:rollNumber/reset-password', asyncHandler(async (req, res) => {
  const rollNumber = String(req.params.rollNumber || '').trim();
  const result = await db.query(
    `UPDATE students SET password_hash = NULL
     WHERE roll_number = $1 RETURNING roll_number`,
    [rollNumber]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Student not found.' });
  res.json({ ok: true });
}));

router.get('/courses/:courseId/assessments', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });
  const { rows } = await db.query(
    `SELECT id, type, title, max_score FROM assessments
     WHERE course_id = $1 ORDER BY created_at, id`,
    [courseId]
  );
  res.json(rows);
}));

router.post('/courses/:courseId/assessments', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });
  if (!(await db.maybeOne('SELECT 1 FROM courses WHERE id = $1', [courseId]))) {
    return res.status(404).json({ error: 'Course not found.' });
  }

  const type = ['assignment', 'quiz'].includes(req.body.type) ? req.body.type : null;
  const title = String(req.body.title || '').trim();
  const maxScore = Number(req.body.max_score);
  if (!type) return res.status(400).json({ error: 'Type must be "assignment" or "quiz".' });
  if (!title || title.length > 200) return res.status(400).json({ error: 'A title under 200 characters is required.' });
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return res.status(400).json({ error: 'Max score must be a positive number.' });
  }

  const result = await db.query(
    `INSERT INTO assessments (course_id, type, title, max_score)
     VALUES ($1, $2, $3, $4) RETURNING id, type, title, max_score`,
    [courseId, type, title, maxScore]
  );
  res.status(201).json(result.rows[0]);
}));

router.get('/assessments/:assessmentId/marks', asyncHandler(async (req, res) => {
  const assessmentId = positiveId(req.params.assessmentId);
  if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment.' });
  const assessment = await db.maybeOne(
    'SELECT id, course_id, title, max_score FROM assessments WHERE id = $1',
    [assessmentId]
  );
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

  const { rows } = await db.query(
    `SELECT s.roll_number, s.name, m.score
     FROM students s
     JOIN enrollments e ON e.student_roll_number = s.roll_number
     LEFT JOIN marks m ON m.student_roll_number = s.roll_number AND m.assessment_id = $1
     WHERE e.course_id = $2
     ORDER BY s.roll_number`,
    [assessmentId, assessment.course_id]
  );
  res.json({ assessment, rows });
}));

router.post('/assessments/:assessmentId/marks', asyncHandler(async (req, res) => {
  const assessmentId = positiveId(req.params.assessmentId);
  if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment.' });
  const assessment = await db.maybeOne(
    'SELECT id, course_id, max_score FROM assessments WHERE id = $1',
    [assessmentId]
  );
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

  const entries = Array.isArray(req.body.marks) ? req.body.marks : [];
  if (entries.length > 2_000) return res.status(400).json({ error: 'Save at most 2,000 marks at a time.' });

  const normalized = [];
  for (const entry of entries) {
    const rollNumber = String(entry.roll_number || '').trim();
    if (!rollNumber) continue;
    const score = entry.score === '' || entry.score === null || entry.score === undefined
      ? null
      : Number(entry.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > assessment.max_score)) {
      return res.status(400).json({ error: `Score for ${rollNumber} must be between 0 and ${assessment.max_score}.` });
    }
    normalized.push({ rollNumber, score });
  }

  let saved = 0;
  await db.withTransaction(async (client) => {
    for (const entry of normalized) {
      const result = await client.query(
        `INSERT INTO marks (assessment_id, student_roll_number, score, updated_at)
         SELECT $1, $2, $3, NOW()
         WHERE EXISTS (
           SELECT 1 FROM enrollments WHERE student_roll_number = $2 AND course_id = $4
         )
         ON CONFLICT (assessment_id, student_roll_number)
         DO UPDATE SET score = EXCLUDED.score, updated_at = NOW()`,
        [assessmentId, entry.rollNumber, entry.score, assessment.course_id]
      );
      if (!result.rowCount) throw Object.assign(new Error(`${entry.rollNumber} is not enrolled in this course.`), { status: 400 });
      saved += 1;
    }
  });
  res.json({ saved });
}));

module.exports = router;
