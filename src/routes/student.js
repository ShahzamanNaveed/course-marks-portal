const express = require('express');
const db = require('../db');
const { requireStudent, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireStudent);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

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

module.exports = router;
