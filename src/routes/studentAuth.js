const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  issueStudentToken,
  clearStudentToken,
  requireStudent,
  loginLimiter,
  asyncHandler,
} = require('../middleware/auth');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

function cleanRoll(roll) {
  return String(roll || '').trim();
}

router.post(
  '/check-roll',
  loginLimiter((req) => `check:${req.ip}`),
  asyncHandler(async (req, res) => {
    const rollNumber = cleanRoll(req.body.roll_number);
    if (!rollNumber) return res.status(400).json({ error: 'Enter your roll number.' });

    const student = await db.maybeOne(
      'SELECT roll_number, name, password_hash FROM students WHERE roll_number = $1',
      [rollNumber]
    );
    if (!student) {
      return res.status(404).json({ error: 'That roll number isn\u2019t on file. Check with your TA if you think this is a mistake.' });
    }
    res.json({ name: student.name, needs_password_setup: !student.password_hash });
  })
);

router.post(
  '/set-password',
  loginLimiter((req) => `setpw:${req.ip}`),
  asyncHandler(async (req, res) => {
    const rollNumber = cleanRoll(req.body.roll_number);
    const password = String(req.body.password || '');
    if (!rollNumber || !password) {
      return res.status(400).json({ error: 'Roll number and password are required.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `UPDATE students SET password_hash = $1
       WHERE roll_number = $2 AND password_hash IS NULL
       RETURNING roll_number`,
      [hash, rollNumber]
    );
    if (!result.rowCount) {
      const exists = await db.maybeOne('SELECT 1 FROM students WHERE roll_number = $1', [rollNumber]);
      if (!exists) return res.status(404).json({ error: 'That roll number isn\u2019t on file.' });
      return res.status(400).json({ error: 'A password is already set. Please sign in instead.' });
    }

    issueStudentToken(res, rollNumber);
    res.json({ ok: true });
  })
);

router.post(
  '/login',
  loginLimiter((req) => `login:${req.ip}:${cleanRoll(req.body.roll_number)}`),
  asyncHandler(async (req, res) => {
    const rollNumber = cleanRoll(req.body.roll_number);
    const password = String(req.body.password || '');
    const student = await db.maybeOne(
      'SELECT roll_number, password_hash FROM students WHERE roll_number = $1',
      [rollNumber]
    );
    const genericError = { error: 'Incorrect roll number or password.' };
    if (!student || !student.password_hash || !(await bcrypt.compare(password, student.password_hash))) {
      return res.status(401).json(genericError);
    }

    issueStudentToken(res, rollNumber);
    res.json({ ok: true });
  })
);

router.post('/logout', (req, res) => {
  clearStudentToken(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  requireStudent,
  asyncHandler(async (req, res) => {
    const student = await db.maybeOne(
      'SELECT roll_number, name FROM students WHERE roll_number = $1',
      [req.student.roll_number]
    );
    if (!student) return res.status(404).json({ error: 'Account not found.' });
    res.json(student);
  })
);

module.exports = router;
