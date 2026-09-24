const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.JWT_SECRET = 'local-test-jwt-secret-that-is-long-and-not-used-in-production';
process.env.OTP_SECRET = 'local-test-otp-secret-that-is-also-not-used-in-production';

const student = { roll_number: 'F23-0871', name: 'Test Student', password_hash: null };
const otps = [];
let deliveredCode = '';

async function fakeQuery(sql, values = []) {
  if (sql.includes('FROM students WHERE UPPER')) {
    return { rows: values[0].toUpperCase() === student.roll_number ? [{ ...student }] : [], rowCount: 1 };
  }
  if (sql.includes('UPDATE students SET password_hash')) {
    if (values[1] !== student.roll_number) return { rows: [], rowCount: 0 };
    if (sql.includes('password_hash IS NULL') && student.password_hash) return { rows: [], rowCount: 0 };
    student.password_hash = values[0];
    return { rows: [{ roll_number: student.roll_number }], rowCount: 1 };
  }
  if (sql.includes('DELETE FROM student_email_otps WHERE id')) {
    const index = otps.findIndex((otp) => otp.id === values[0]);
    if (index >= 0) otps.splice(index, 1);
    return { rows: [], rowCount: index >= 0 ? 1 : 0 };
  }
  throw new Error(`Unhandled test query: ${sql}`);
}

const fakeClient = {
  async query(sql, values = []) {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT created_at FROM student_email_otps')) {
      const found = [...otps].reverse().find((otp) => otp.roll_number === values[0] && otp.purpose === values[1]);
      return { rows: found ? [{ created_at: found.created_at }] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('SET consumed_at = NOW()') && sql.includes('roll_number = $1')) {
      for (const otp of otps) {
        if (otp.roll_number === values[0] && otp.purpose === values[1] && !otp.consumed_at) otp.consumed_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO student_email_otps')) {
      const otp = {
        id: otps.length + 1,
        roll_number: values[0],
        purpose: values[1],
        code_hash: values[2],
        attempts: 0,
        created_at: new Date(),
        expires_at: new Date(Date.now() + values[3] * 60_000),
        consumed_at: null,
      };
      otps.push(otp);
      return { rows: [{ id: otp.id }], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM student_email_otps')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM student_email_otps') && sql.includes('FOR UPDATE')) {
      const found = [...otps].reverse().find(
        (otp) => otp.roll_number === values[0] && otp.purpose === values[1] && !otp.consumed_at
      );
      return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('SET attempts = attempts + 1')) {
      const found = otps.find((otp) => otp.id === values[0]);
      if (found) found.attempts += 1;
      return { rows: [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('SET consumed_at = NOW() WHERE id')) {
      const found = otps.find((otp) => otp.id === values[0]);
      if (found) found.consumed_at = new Date();
      return { rows: [], rowCount: found ? 1 : 0 };
    }
    throw new Error(`Unhandled transaction query: ${sql}`);
  },
};

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  exports: {
    query: fakeQuery,
    maybeOne: async () => null,
    withTransaction: (fn) => fn(fakeClient),
  },
};
const emailPath = require.resolve('../src/email');
require.cache[emailPath] = {
  exports: {
    sendStudentOtp: async ({ code }) => {
      deliveredCode = code;
    },
  },
};

const express = require('express');
const cookieParser = require('cookie-parser');
const studentAuth = require('../src/routes/studentAuth');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', studentAuth);
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function post(path, body, cookie = '') {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test('first-time password setup requires and accepts a university-email OTP', async () => {
  let response = await post('/api/auth/check-roll', { roll_number: 'f23-0871' });
  assert.equal(response.status, 200);
  const account = await response.json();
  assert.equal(account.roll_number, 'F23-0871');
  assert.equal(account.needs_password_setup, true);
  assert.match(account.email_hint, /^f23\*+@cfd\.nu\.edu\.pk$/);

  response = await post('/api/auth/set-password', { password: 'student-password' });
  assert.equal(response.status, 401);

  response = await post('/api/auth/send-otp', {
    roll_number: 'F23-0871',
    purpose: 'password_setup',
  });
  assert.equal(response.status, 202);
  assert.match(deliveredCode, /^\d{6}$/);

  response = await post('/api/auth/verify-otp', {
    roll_number: 'F23-0871',
    purpose: 'password_setup',
    code: deliveredCode,
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];

  response = await post('/api/auth/set-password', { password: 'student-password' }, cookie);
  assert.equal(response.status, 200);
  assert.ok(student.password_hash);
});

test('a returning student can reset a forgotten password with another OTP', async () => {
  let response = await post('/api/auth/send-otp', {
    roll_number: 'F23-0871',
    purpose: 'password_reset',
  });
  assert.equal(response.status, 202);

  response = await post('/api/auth/verify-otp', {
    roll_number: 'F23-0871',
    purpose: 'password_reset',
    code: deliveredCode,
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];

  response = await post('/api/auth/set-password', { password: 'new-student-password' }, cookie);
  assert.equal(response.status, 200);

  response = await post('/api/auth/login', {
    roll_number: 'F23-0871',
    password: 'student-password',
  });
  assert.equal(response.status, 401);

  response = await post('/api/auth/login', {
    roll_number: 'F23-0871',
    password: 'new-student-password',
  });
  assert.equal(response.status, 200);
});
