const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'change_this_to_a_long_random_string') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('A strong JWT_SECRET is required in production.');
  }
  console.warn(
    '[warning] JWT_SECRET is missing or still set to the example value. ' +
    'Set a real random secret in .env before deploying.'
  );
}

const STUDENT_COOKIE = 'student_session';
const ADMIN_COOKIE = 'admin_session';
const TOKEN_TTL = '12h';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 12 * 60 * 60 * 1000,
  path: '/',
};

function issueStudentToken(res, rollNumber) {
  const token = jwt.sign({ type: 'student', roll_number: rollNumber }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie(STUDENT_COOKIE, token, cookieOptions);
}

function issueAdminToken(res, adminId, username) {
  const token = jwt.sign({ type: 'admin', id: adminId, username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie(ADMIN_COOKIE, token, cookieOptions);
}

function clearStudentToken(res) {
  res.clearCookie(STUDENT_COOKIE, { ...cookieOptions, maxAge: undefined });
}

function clearAdminToken(res) {
  res.clearCookie(ADMIN_COOKIE, { ...cookieOptions, maxAge: undefined });
}

function requireStudent(req, res, next) {
  const token = req.cookies[STUDENT_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'student') throw new Error('wrong token type');
    req.student = { roll_number: payload.roll_number };
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'admin') throw new Error('wrong token type');
    req.admin = { id: payload.id, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

// Small in-memory limiter to slow down password-guessing.
// For a single-server class-sized deployment this is enough; if you ever run
// multiple server instances behind a load balancer, replace with a shared
// store (e.g. Redis) instead.
const attempts = new Map(); // key -> { count, resetAt }
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 10;

function loginLimiter(keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }
    if (entry.count >= MAX_ATTEMPTS) {
      const waitMin = Math.ceil((entry.resetAt - now) / 60000);
      return res.status(429).json({ error: `Too many attempts. Try again in about ${waitMin} minute(s).` });
    }
    entry.count += 1;
    next();
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  issueStudentToken,
  issueAdminToken,
  clearStudentToken,
  clearAdminToken,
  requireStudent,
  requireAdmin,
  loginLimiter,
  asyncHandler,
};
