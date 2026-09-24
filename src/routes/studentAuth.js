const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sendStudentOtp } = require('../email');
const {
  issueStudentToken,
  issuePasswordSetupToken,
  readPasswordSetupToken,
  clearPasswordSetupToken,
  clearStudentToken,
  requireStudent,
  loginLimiter,
  asyncHandler,
} = require('../middleware/auth');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const PURPOSES = new Set(['password_setup', 'password_reset']);

function cleanRoll(roll) {
  return String(roll || '').trim().toUpperCase();
}

function rollVariants(rollNumber) {
  const normalized = cleanRoll(rollNumber);
  const match = normalized.match(/^F(\d{2})-(\d{4})$/) || normalized.match(/^(\d{2})F-(\d{4})$/);
  if (!match) return [normalized, normalized];
  return [`${match[1]}F-${match[2]}`, `F${match[1]}-${match[2]}`];
}

function rollToEmail(rollNumber) {
  const normalized = String(rollNumber || '').trim().toUpperCase();
  const match = normalized.match(/^F(\d{2})-(\d{4})$/) || normalized.match(/^(\d{2})F-(\d{4})$/);
  if (!match) {
    const error = new Error('Use the roll-number format 23F-0871.');
    error.status = 400;
    throw error;
  }
  return `f${match[1]}${match[2]}@cfd.nu.edu.pk`;
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 3)}${'*'.repeat(Math.max(4, local.length - 3))}@${domain}`;
}

function otpSecret() {
  const secret = String(process.env.OTP_SECRET || '').trim();
  if (!secret || secret === 'replace_with_another_long_random_secret') {
    const error = new Error('OTP verification is not configured. Ask your TA to configure OTP_SECRET.');
    error.status = 503;
    throw error;
  }
  return secret;
}

function hashOtp(rollNumber, purpose, code) {
  return crypto
    .createHmac('sha256', otpSecret())
    .update(`${rollNumber}|${purpose}|${code}`)
    .digest('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function findStudent(rollNumber, client = db) {
  const [canonicalRoll, alternateRoll] = rollVariants(rollNumber);
  const result = await client.query(
    `SELECT roll_number, name, password_hash
     FROM students
     WHERE UPPER(roll_number) IN (UPPER($1), UPPER($2))
     ORDER BY CASE WHEN UPPER(roll_number) = UPPER($1) THEN 0 ELSE 1 END
     LIMIT 1`,
    [canonicalRoll, alternateRoll]
  );
  return result.rows[0] || null;
}

router.post(
  '/check-roll',
  loginLimiter((req) => `check:${req.ip}:${cleanRoll(req.body.roll_number)}`),
  asyncHandler(async (req, res) => {
    const requestedRoll = cleanRoll(req.body.roll_number);
    if (!requestedRoll) return res.status(400).json({ error: 'Enter your roll number.' });

    const student = await findStudent(requestedRoll);
    if (!student) {
      return res.status(404).json({ error: 'That roll number isn’t on file. Check with your TA if you think this is a mistake.' });
    }
    const email = rollToEmail(cleanRoll(student.roll_number));
    res.json({
      name: student.name,
      roll_number: student.roll_number,
      needs_password_setup: !student.password_hash,
      email_hint: maskEmail(email),
    });
  })
);

router.post(
  '/send-otp',
  loginLimiter((req) => `sendotp:${req.ip}:${cleanRoll(req.body.roll_number)}`),
  asyncHandler(async (req, res) => {
    const requestedRoll = cleanRoll(req.body.roll_number);
    const purpose = String(req.body.purpose || '');
    if (!requestedRoll || !PURPOSES.has(purpose)) {
      return res.status(400).json({ error: 'A valid roll number and verification purpose are required.' });
    }

    const student = await findStudent(requestedRoll);
    if (!student) return res.status(404).json({ error: 'That roll number isn’t on file.' });
    if (purpose === 'password_setup' && student.password_hash) {
      return res.status(409).json({ error: 'A password is already set. Sign in or use Forgot password.' });
    }

    const rollNumber = student.roll_number;
    const email = rollToEmail(cleanRoll(rollNumber));
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashOtp(rollNumber, purpose, code);

    const otpId = await db.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${rollNumber}:${purpose}`]);
      const latest = await client.query(
        `SELECT created_at FROM student_email_otps
         WHERE roll_number = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [rollNumber, purpose]
      );
      if (latest.rows[0]) {
        const ageMs = Date.now() - new Date(latest.rows[0].created_at).getTime();
        if (ageMs < OTP_RESEND_SECONDS * 1000) {
          const error = new Error(`Please wait ${Math.ceil((OTP_RESEND_SECONDS * 1000 - ageMs) / 1000)} seconds before requesting another code.`);
          error.status = 429;
          throw error;
        }
      }

      await client.query(
        `UPDATE student_email_otps SET consumed_at = NOW()
         WHERE roll_number = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [rollNumber, purpose]
      );
      const inserted = await client.query(
        `INSERT INTO student_email_otps (roll_number, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4::integer * INTERVAL '1 minute')) RETURNING id`,
        [rollNumber, purpose, codeHash, OTP_TTL_MINUTES]
      );
      await client.query(
        `DELETE FROM student_email_otps
         WHERE expires_at < NOW() - INTERVAL '1 day'`
      );
      return inserted.rows[0].id;
    });

    try {
      await sendStudentOtp({ to: email, code, purpose });
    } catch (error) {
      await db.query('DELETE FROM student_email_otps WHERE id = $1', [otpId]);
      console.error('Could not send student OTP email:', error.message);
      return res.status(error.status || 502).json({
        error: error.status ? error.message : 'The verification email could not be sent. Please try again later.',
      });
    }

    res.status(202).json({ ok: true, email_hint: maskEmail(email), expires_in_minutes: OTP_TTL_MINUTES });
  })
);

router.post(
  '/verify-otp',
  loginLimiter((req) => `verifyotp:${req.ip}:${cleanRoll(req.body.roll_number)}`),
  asyncHandler(async (req, res) => {
    const requestedRoll = cleanRoll(req.body.roll_number);
    const purpose = String(req.body.purpose || '');
    const code = String(req.body.code || '').trim();
    if (!requestedRoll || !PURPOSES.has(purpose) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the six-digit verification code.' });
    }

    const student = await findStudent(requestedRoll);
    if (!student) return res.status(400).json({ error: 'The verification code is invalid or expired.' });
    const rollNumber = student.roll_number;
    const enteredHash = hashOtp(rollNumber, purpose, code);

    const result = await db.withTransaction(async (client) => {
      const otp = await client.query(
        `SELECT id, code_hash, attempts, expires_at
         FROM student_email_otps
         WHERE roll_number = $1 AND purpose = $2 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [rollNumber, purpose]
      );
      const row = otp.rows[0];
      if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= OTP_MAX_ATTEMPTS) {
        return { ok: false };
      }
      if (!safeHashEqual(row.code_hash, enteredHash)) {
        await client.query('UPDATE student_email_otps SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        return { ok: false };
      }
      await client.query('UPDATE student_email_otps SET consumed_at = NOW() WHERE id = $1', [row.id]);
      return { ok: true };
    });

    if (!result.ok) return res.status(400).json({ error: 'The verification code is invalid or expired.' });
    issuePasswordSetupToken(res, rollNumber, purpose);
    res.json({ ok: true });
  })
);

router.post(
  '/set-password',
  loginLimiter((req) => `setpw:${req.ip}`),
  asyncHandler(async (req, res) => {
    const setup = readPasswordSetupToken(req);
    const password = String(req.body.password || '');
    if (!setup) return res.status(401).json({ error: 'Verify your university email before setting a password.' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const hash = await bcrypt.hash(password, 10);
    const condition = setup.purpose === 'password_setup' ? 'AND password_hash IS NULL' : '';
    const result = await db.query(
      `UPDATE students SET password_hash = $1
       WHERE roll_number = $2 ${condition}
       RETURNING roll_number`,
      [hash, setup.roll_number]
    );
    if (!result.rowCount) {
      return res.status(409).json({ error: 'The account changed while you were setting the password. Please start again.' });
    }

    clearPasswordSetupToken(res);
    issueStudentToken(res, setup.roll_number);
    res.json({ ok: true });
  })
);

router.post(
  '/login',
  loginLimiter((req) => `login:${req.ip}:${cleanRoll(req.body.roll_number)}`),
  asyncHandler(async (req, res) => {
    const rollNumber = cleanRoll(req.body.roll_number);
    const password = String(req.body.password || '');
    const student = await findStudent(rollNumber);
    const genericError = { error: 'Incorrect roll number or password.' };
    if (!student || !student.password_hash || !(await bcrypt.compare(password, student.password_hash))) {
      return res.status(401).json(genericError);
    }

    issueStudentToken(res, student.roll_number);
    res.json({ ok: true });
  })
);

router.post('/logout', (req, res) => {
  clearStudentToken(res);
  clearPasswordSetupToken(res);
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
