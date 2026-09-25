const express = require('express');
const db = require('../db');
const { requireStudent, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireStudent);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const QUERY_CATEGORIES = new Set(['quiz', 'assignment', 'assessment_marks', 'attendance', 'other']);

router.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT c.id, c.code, c.name
       FROM courses c
       JOIN enrollments e ON e.course_id = c.id
       WHERE e.student_roll_number = $1
       ORDER BY c.code`,
      [req.student.roll_number]
    );
    res.json(rows);
  })
);

router.get(
  '/courses/:courseId/marks',
  asyncHandler(async (req, res) => {
    const courseId = positiveId(req.params.courseId);
    if (!courseId) return res.status(400).json({ error: 'Invalid course.' });

    const enrolled = await db.maybeOne(
      'SELECT 1 FROM enrollments WHERE student_roll_number = $1 AND course_id = $2',
      [req.student.roll_number, courseId]
    );
    if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });

    const course = await db.maybeOne('SELECT id, code, name FROM courses WHERE id = $1', [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const { rows: items } = await db.query(
      `SELECT a.id, a.type, a.title, a.max_score, m.score
       FROM assessments a
       LEFT JOIN marks m ON m.assessment_id = a.id AND m.student_roll_number = $1
       WHERE a.course_id = $2
       ORDER BY a.created_at, a.id`,
      [req.student.roll_number, courseId]
    );
    res.json({ course, items });
  })
);

router.get('/notifications', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.id, n.course_id, c.code AS course_code, c.name AS course_name,
            a.title AS assessment_title, n.message, n.status, n.created_at,
            (n.read_at IS NOT NULL) AS is_read
     FROM notifications n
     JOIN courses c ON c.id = n.course_id
     JOIN assessments a ON a.id = n.assessment_id
     WHERE n.student_roll_number = $1 AND n.status = 'sent'
     ORDER BY n.created_at DESC`,
    [req.student.roll_number]
  );
  res.json(rows);
}));

router.post('/notifications/:notificationId/read', asyncHandler(async (req, res) => {
  const notificationId = positiveId(req.params.notificationId);
  if (!notificationId) return res.status(400).json({ error: 'Invalid notification.' });
  const result = await db.query(
    `UPDATE notifications SET read_at = NOW()
     WHERE id = $1 AND student_roll_number = $2 AND status = 'sent'
     RETURNING id`, [notificationId, req.student.roll_number]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ ok: true });
}));

router.get('/queries', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT q.id, q.course_id, c.code AS course_code, c.name AS course_name,
            q.category, q.subject, q.description, q.status, q.admin_response,
            q.created_at, q.updated_at
     FROM queries q JOIN courses c ON c.id = q.course_id
     WHERE q.student_roll_number = $1 ORDER BY q.created_at DESC`,
    [req.student.roll_number]
  );
  res.json(rows);
}));

router.post('/queries', asyncHandler(async (req, res) => {
  const courseId = positiveId(req.body.course_id);
  const category = String(req.body.category || '');
  const subject = String(req.body.subject || '').trim();
  const description = String(req.body.description || '').trim();
  if (!courseId || !QUERY_CATEGORIES.has(category) || !subject || !description || subject.length > 200 || description.length > 4_000) {
    return res.status(400).json({ error: 'Choose a course and category, then provide a subject and description.' });
  }
  const enrolled = await db.maybeOne(
    'SELECT 1 FROM enrollments WHERE student_roll_number = $1 AND course_id = $2',
    [req.student.roll_number, courseId]
  );
  if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course.' });
  const result = await db.query(
    `INSERT INTO queries (student_roll_number, course_id, category, subject, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, course_id, category, subject, description, status, created_at`,
    [req.student.roll_number, courseId, category, subject, description]
  );
  res.status(201).json(result.rows[0]);
}));

module.exports = router;
