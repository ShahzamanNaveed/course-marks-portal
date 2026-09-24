const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  issueAdminToken,
  clearAdminToken,
  requireAdmin,
  loginLimiter,
  asyncHandler,
} = require('../middleware/auth');

const router = express.Router();

router.post(
  '/login',
  loginLimiter((req) => `adminlogin:${req.ip}`),
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const admin = await db.maybeOne(
      'SELECT id, username, password_hash FROM admins WHERE username = $1',
      [username]
    );
    const genericError = { error: 'Incorrect username or password.' };
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json(genericError);
    }

    issueAdminToken(res, admin.id, admin.username);
    res.json({ ok: true });
  })
);

router.post('/logout', (req, res) => {
  clearAdminToken(res);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

module.exports = router;
