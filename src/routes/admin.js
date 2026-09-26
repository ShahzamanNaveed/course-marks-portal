const express = require('express');
const db = require('../db');
const { requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const ROLL_PATTERN = /^\d{2}[A-Z]-\d{4}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;
const QUERY_CATEGORIES = new Set(['quiz', 'assignment', 'assessment_marks', 'attendance', 'other']);
const QUERY_STATUSES = new Set(['pending', 'in_progress', 'resolved', 'closed']);

function cleanRoll(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanCourseName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function absoluteSettings(body) {
  const total = (value, fallback) => value === '' || value === null || value === undefined ? fallback : Number(value);
  const settings = {
    quizTotalAbs: total(body.quiz_total_abs, 10),
    assignmentTotalAbs: total(body.assignment_total_abs, 10),
    labTotalAbs: total(body.lab_total_abs, 0),
    cpTotalAbs: total(body.cp_total_abs, 0),
    otherTotalAbs: total(body.other_total_abs, 0),
  };
  if (Object.values(settings).some((value) => !Number.isFinite(value) || value < 0)) return null;
  return settings;
}

function assessmentTotals(value) {
  if (!Array.isArray(value)) return {};
  const totals = {};
  for (const entry of value) {
    if (!['assignment', 'quiz', 'lab', 'cp', 'other'].includes(entry.type)) continue;
    const total = Number(entry.total_abs);
    if (Number.isFinite(total) && total >= 0) totals[entry.type] = total;
  }
  return totals;
}

function settingsFromAssessmentTotals(body) {
  const totals = assessmentTotals(body.assessment_totals);
  return absoluteSettings({
    quiz_total_abs: totals.quiz ?? 0,
    assignment_total_abs: totals.assignment ?? 0,
    lab_total_abs: totals.lab ?? 0,
    cp_total_abs: totals.cp ?? 0,
    other_total_abs: totals.other ?? 0,
  });
}

router.get('/courses', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
        `SELECT c.id, c.code, c.name,
          CASE WHEN EXISTS (SELECT 1 FROM assessments ax WHERE ax.course_id = c.id)
            THEN COALESCE((SELECT SUM(a.absolute_score) FROM assessments a WHERE a.course_id = c.id AND a.type = 'quiz'), 0)
            ELSE c.quiz_total_abs END AS quiz_total_abs,
          CASE WHEN EXISTS (SELECT 1 FROM assessments ax WHERE ax.course_id = c.id)
            THEN COALESCE((SELECT SUM(a.absolute_score) FROM assessments a WHERE a.course_id = c.id AND a.type = 'assignment'), 0)
            ELSE c.assignment_total_abs END AS assignment_total_abs,
          CASE WHEN EXISTS (SELECT 1 FROM assessments ax WHERE ax.course_id = c.id)
            THEN COALESCE((SELECT SUM(a.absolute_score) FROM assessments a WHERE a.course_id = c.id AND a.type = 'lab'), 0)
            ELSE c.lab_total_abs END AS lab_total_abs,
          CASE WHEN EXISTS (SELECT 1 FROM assessments ax WHERE ax.course_id = c.id)
            THEN COALESCE((SELECT SUM(a.absolute_score) FROM assessments a WHERE a.course_id = c.id AND a.type = 'cp'), 0)
            ELSE c.cp_total_abs END AS cp_total_abs,
          CASE WHEN EXISTS (SELECT 1 FROM assessments ax WHERE ax.course_id = c.id)
            THEN COALESCE((SELECT SUM(a.absolute_score) FROM assessments a WHERE a.course_id = c.id AND a.type = 'other'), 0)
            ELSE c.other_total_abs END AS other_total_abs,
          COUNT(e.student_roll_number)::int AS student_count
     FROM courses c
     LEFT JOIN enrollments e ON e.course_id = c.id
     GROUP BY c.id
     ORDER BY c.code`
  );
  res.json(rows);
}));

router.post('/courses', asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim();
  const name = cleanCourseName(req.body.name);
  const settings = Array.isArray(req.body.assessment_totals)
    ? settingsFromAssessmentTotals(req.body) : absoluteSettings(req.body);
  if (!code || !name) return res.status(400).json({ error: 'Course code and name are required.' });
  if (!settings) return res.status(400).json({ error: 'Quiz and assignment absolute totals must be positive numbers.' });
  if (code.length > 50 || name.length > 200) return res.status(400).json({ error: 'Course code or name is too long.' });

  let course;
  await db.withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO courses (code, name, quiz_total_abs, assignment_total_abs, lab_total_abs, cp_total_abs, other_total_abs)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO NOTHING RETURNING id, code, name`,
      [code, name, settings.quizTotalAbs, settings.assignmentTotalAbs, settings.labTotalAbs, settings.cpTotalAbs, settings.otherTotalAbs]
    );
    if (!result.rowCount) throw Object.assign(new Error('A course with that code already exists.'), { status: 409 });
    course = result.rows[0];
  });
  res.status(201).json(course);
}));

router.patch('/courses/:courseId', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  const code = String(req.body.code || '').trim();
  const name = cleanCourseName(req.body.name);
  const currentCourse = await db.maybeOne('SELECT quiz_total_abs, assignment_total_abs, lab_total_abs, cp_total_abs, other_total_abs FROM courses WHERE id = $1', [courseId]);
  const requestedTotals = Array.isArray(req.body.assessment_totals) ? assessmentTotals(req.body.assessment_totals) : {};
  const settings = absoluteSettings({
    lab_total_abs: requestedTotals.lab ?? req.body.lab_total_abs ?? currentCourse?.lab_total_abs,
    cp_total_abs: requestedTotals.cp ?? req.body.cp_total_abs ?? currentCourse?.cp_total_abs,
    other_total_abs: requestedTotals.other ?? req.body.other_total_abs ?? currentCourse?.other_total_abs,
    quiz_total_abs: requestedTotals.quiz ?? req.body.quiz_total_abs ?? currentCourse?.quiz_total_abs,
    assignment_total_abs: requestedTotals.assignment ?? req.body.assignment_total_abs ?? currentCourse?.assignment_total_abs,
  });
  if (!courseId || !code || !name) return res.status(400).json({ error: 'Valid course code and name are required.' });
  if (!settings) return res.status(400).json({ error: 'Quiz and assignment absolute totals must be positive numbers.' });
  if (code.length > 50 || name.length > 200) return res.status(400).json({ error: 'Course code or name is too long.' });
  if (await db.maybeOne('SELECT 1 FROM courses WHERE LOWER(code) = LOWER($1) AND id <> $2', [code, courseId])) {
    return res.status(409).json({ error: 'A course with that code already exists.' });
  }
  const result = await db.query(
    `UPDATE courses SET code = $1, name = $2, quiz_total_abs = $3, assignment_total_abs = $4,
       lab_total_abs = $5, cp_total_abs = $6, other_total_abs = $7
     WHERE id = $8 RETURNING id, code, name, quiz_total_abs, assignment_total_abs, lab_total_abs, cp_total_abs, other_total_abs`,
     [code, name, settings.quizTotalAbs, settings.assignmentTotalAbs, settings.labTotalAbs, settings.cpTotalAbs, settings.otherTotalAbs, courseId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Course not found.' });
  res.json(result.rows[0]);
}));

router.delete('/courses/:courseId', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });

  const result = await db.query(
    'DELETE FROM courses WHERE id = $1 RETURNING id, code, name',
    [courseId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Course not found.' });
  res.json({ ok: true, course: result.rows[0] });
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
      const rollNumber = cleanRoll(row.roll_number);
      const name = cleanName(row.name);
      if (!ROLL_PATTERN.test(rollNumber) || !NAME_PATTERN.test(name) || name.length > 200) {
        errors.push(`${rollNumber || 'Student'}: use roll format 23F-0615 and a name beginning with a letter.`);
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

router.delete('/students/:rollNumber', asyncHandler(async (req, res) => {
  const rollNumber = String(req.params.rollNumber || '').trim();
  if (!rollNumber) return res.status(400).json({ error: 'Invalid student.' });

  const result = await db.query(
    'DELETE FROM students WHERE roll_number = $1 RETURNING roll_number, name',
    [rollNumber]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Student not found.' });
  res.json({ ok: true, student: result.rows[0] });
}));

router.get('/courses/:courseId/assessments', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: 'Invalid course.' });
  const { rows } = await db.query(
    `SELECT id, type, title, max_score, absolute_score FROM assessments
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

  const type = ['assignment', 'quiz', 'lab', 'cp', 'other'].includes(req.body.type) ? req.body.type : null;
  const title = String(req.body.title || '').trim();
  const maxScore = Number(req.body.max_score);
  const absoluteScore = Number(req.body.absolute_score ?? 2);
  if (!type) return res.status(400).json({ error: 'Select a valid assessment type.' });
  if (!title || title.length > 200) return res.status(400).json({ error: 'A title under 200 characters is required.' });
  if (!Number.isFinite(maxScore) || maxScore <= 0 || !Number.isFinite(absoluteScore) || absoluteScore <= 0) {
    return res.status(400).json({ error: 'Max score and absolute value must be positive numbers.' });
  }

  const result = await db.query(
    `INSERT INTO assessments (course_id, type, title, max_score, absolute_score)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, type, title, max_score, absolute_score`,
    [courseId, type, title, maxScore, absoluteScore]
  );
  res.status(201).json(result.rows[0]);
}));

router.patch('/assessments/:assessmentId', asyncHandler(async (req, res) => {
  const assessmentId = positiveId(req.params.assessmentId);
  if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment.' });
  const type = ['assignment', 'quiz', 'lab', 'cp', 'other'].includes(req.body.type) ? req.body.type : null;
  const title = String(req.body.title || '').trim();
  const maxScore = Number(req.body.max_score);
  const absoluteScore = Number(req.body.absolute_score ?? 2);
  if (!type || !title || title.length > 200 || !Number.isFinite(maxScore) || maxScore <= 0 || !Number.isFinite(absoluteScore) || absoluteScore <= 0) {
    return res.status(400).json({ error: 'Provide a valid type, title, max score, and absolute value.' });
  }
  if (await db.maybeOne('SELECT 1 FROM marks WHERE assessment_id = $1 AND score > $2', [assessmentId, maxScore])) {
    return res.status(409).json({ error: 'Max score cannot be lower than an existing student mark.' });
  }
  const result = await db.query(
    `UPDATE assessments SET type = $1, title = $2, max_score = $3, absolute_score = $4
     WHERE id = $5 RETURNING id, course_id, type, title, max_score, absolute_score`,
    [type, title, maxScore, absoluteScore, assessmentId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Assessment not found.' });
  res.json(result.rows[0]);
}));

router.delete('/assessments/:assessmentId', asyncHandler(async (req, res) => {
  const assessmentId = positiveId(req.params.assessmentId);
  if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment.' });

  const result = await db.query(
    'DELETE FROM assessments WHERE id = $1 RETURNING id, course_id, type, title',
    [assessmentId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Assessment not found.' });
  res.json({ ok: true, assessment: result.rows[0] });
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
  const notificationIds = [];
  await db.withTransaction(async (client) => {
    for (const entry of normalized) {
      const existing = await client.query(
        'SELECT score FROM marks WHERE assessment_id = $1 AND student_roll_number = $2',
        [assessmentId, entry.rollNumber]
      );
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
      const oldScore = existing.rows[0]?.score ?? null;
      if (oldScore !== entry.score) {
        const student = await client.query(
          `SELECT s.name, c.code, a.title FROM students s
           JOIN enrollments e ON e.student_roll_number = s.roll_number AND e.course_id = $2
           JOIN courses c ON c.id = e.course_id
           JOIN assessments a ON a.id = $1
           WHERE s.roll_number = $3`,
          [assessmentId, assessment.course_id, entry.rollNumber]
        );
        if (student.rowCount) {
          const notificationResult = await client.query(
            `INSERT INTO notifications
              (student_roll_number, course_id, assessment_id, old_score, new_score, message)
             SELECT $1, $2, $3, $4, $5, $6
             WHERE NOT EXISTS (
               SELECT 1 FROM notifications
               WHERE student_roll_number = $1 AND assessment_id = $3
                 AND old_score IS NOT DISTINCT FROM $4 AND new_score IS NOT DISTINCT FROM $5
             )
             RETURNING id`,
            [entry.rollNumber, assessment.course_id, assessmentId, oldScore, entry.score,
              `${student.rows[0].code} · ${student.rows[0].title} marks changed from ${oldScore ?? 'not released'} to ${entry.score ?? 'not released'}.`]
          );
          if (notificationResult.rowCount) {
            notificationIds.push(notificationResult.rows[0].id);
          } else {
            const pendingNotification = await client.query(
              `SELECT id FROM notifications
               WHERE student_roll_number = $1 AND assessment_id = $2
                 AND old_score IS NOT DISTINCT FROM $3
                 AND new_score IS NOT DISTINCT FROM $4
                 AND status = 'pending'
               ORDER BY created_at DESC LIMIT 1`,
              [entry.rollNumber, assessmentId, oldScore, entry.score]
            );
            if (pendingNotification.rowCount) notificationIds.push(pendingNotification.rows[0].id);
          }
        }
      }
      saved += 1;
    }
  });
  res.json({ saved, notification_ids: notificationIds });
}));

router.get('/notifications', asyncHandler(async (req, res) => {
  const status = ['pending', 'sent'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await db.query(
    `SELECT * FROM (
  SELECT n.id, 'mark' AS notification_type, n.id AS notification_id,
    n.student_roll_number, s.name AS student_name, n.course_id,
    c.code AS course_code, a.title AS assessment_title,
    n.message, n.status, n.created_at, n.approved_at,
    NULL::bigint AS query_id, NULL::text AS query_status,
    NULL::text AS description, NULL::text AS admin_response
  FROM notifications n
  JOIN students s ON s.roll_number = n.student_roll_number
  JOIN courses c ON c.id = n.course_id
  JOIN assessments a ON a.id = n.assessment_id
  WHERE ($1::text IS NULL OR n.status = $1)
  UNION ALL
  SELECT q.id, 'query' AS notification_type, q.id AS notification_id,
    q.student_roll_number, s.name AS student_name, q.course_id,
    c.code AS course_code, q.subject AS assessment_title,
    'Student Query' AS message,
    CASE WHEN q.status = 'pending' THEN 'pending' ELSE 'sent' END AS status,
    q.created_at, NULL::timestamptz AS approved_at,
    q.id AS query_id, q.status AS query_status,
    q.description, q.admin_response
  FROM queries q
  JOIN students s ON s.roll_number = q.student_roll_number
  JOIN courses c ON c.id = q.course_id
  WHERE ($1::text IS NULL OR CASE WHEN q.status = 'pending' THEN 'pending' ELSE 'sent' END = $1)
     ) AS unified_notifications
     ORDER BY created_at DESC`, [status]
  );
  res.json(rows);
}));

router.post('/notifications/:notificationId/approve', asyncHandler(async (req, res) => {
  const notificationId = Number(req.params.notificationId);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) return res.status(400).json({ error: 'Invalid notification.' });
  const result = await db.query(
    `UPDATE notifications SET status = 'sent', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND status = 'pending'
     RETURNING id, status, approved_at`, [req.admin.id, notificationId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Pending notification not found.' });
  res.json(result.rows[0]);
}));

router.get('/queries', asyncHandler(async (req, res) => {
  const filters = [];
  const values = [];
  if (req.query.status && QUERY_STATUSES.has(req.query.status)) { values.push(req.query.status); filters.push(`q.status = $${values.length}`); }
  if (req.query.category && QUERY_CATEGORIES.has(req.query.category)) { values.push(req.query.category); filters.push(`q.category = $${values.length}`); }
  const courseId = positiveId(req.query.course_id);
  if (courseId) { values.push(courseId); filters.push(`q.course_id = $${values.length}`); }
  const { rows } = await db.query(
    `SELECT q.id, q.student_roll_number, s.name AS student_name, q.course_id,
            c.code AS course_code, c.name AS course_name, q.category, q.subject,
            q.description, q.status, q.admin_response, q.created_at, q.updated_at
     FROM queries q JOIN students s ON s.roll_number = q.student_roll_number
     JOIN courses c ON c.id = q.course_id
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY q.created_at DESC`, values
  );
  res.json(rows);
}));

router.patch('/queries/:queryId', asyncHandler(async (req, res) => {
  const queryId = Number(req.params.queryId);
  const status = String(req.body.status || '');
  const response = String(req.body.admin_response || '').trim();
  if (!Number.isSafeInteger(queryId) || queryId <= 0 || !QUERY_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid query status.' });
  const result = await db.query(
    `UPDATE queries SET status = $1, admin_response = $2, responded_by = $3, updated_at = NOW()
     WHERE id = $4 RETURNING id, student_roll_number, course_id, subject, status, admin_response, updated_at`,
    [status, response || null, req.admin.id, queryId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Query not found.' });
  const query = result.rows[0];
  if (response) {
    await db.query(
      `INSERT INTO query_notifications (query_id, student_roll_number, course_id, message)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (query_id) DO UPDATE SET message = EXCLUDED.message, read_at = NULL, created_at = NOW()`,
      [query.id, query.student_roll_number, query.course_id, `Your query about “${query.subject}” has received a response from the teaching team.`]
    );
  }
  res.json(result.rows[0]);
}));

router.delete('/queries/:queryId', asyncHandler(async (req, res) => {
  const queryId = Number(req.params.queryId);
  if (!Number.isSafeInteger(queryId) || queryId <= 0) return res.status(400).json({ error: 'Invalid query.' });
  const result = await db.withTransaction(async (client) => {
    await client.query('DELETE FROM query_notifications WHERE query_id = $1', [queryId]);
    return client.query('DELETE FROM queries WHERE id = $1 RETURNING id', [queryId]);
  });
  if (!result.rowCount) return res.status(404).json({ error: 'Query not found.' });
  res.json({ ok: true });
}));

router.delete('/queries/:queryId/response', asyncHandler(async (req, res) => {
  const queryId = Number(req.params.queryId);
  if (!Number.isSafeInteger(queryId) || queryId <= 0) return res.status(400).json({ error: 'Invalid query.' });
  const result = await db.query(
    `UPDATE queries SET status = 'pending', admin_response = NULL, responded_by = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING id`, [queryId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Query not found.' });
  await db.query('DELETE FROM query_notifications WHERE query_id = $1', [queryId]);
  res.json({ ok: true });
}));

module.exports = router;
