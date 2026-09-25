const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const deleted = [];

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  exports: {
    query: async (sql, values = []) => {
      if (sql.startsWith('DELETE FROM courses')) {
        if (values[0] !== 7) return { rows: [], rowCount: 0 };
        deleted.push(['course', values[0]]);
        return { rows: [{ id: 7, code: 'DSA101', name: 'Data Structures' }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM students')) {
        if (values[0] !== '23F-0871') return { rows: [], rowCount: 0 };
        deleted.push(['student', values[0]]);
        return { rows: [{ roll_number: '23F-0871', name: 'Shahzaman' }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM assessments')) {
        if (values[0] !== 11) return { rows: [], rowCount: 0 };
        deleted.push(['assessment', values[0]]);
        return { rows: [{ id: 11, course_id: 7, type: 'quiz', title: 'Quiz 1' }], rowCount: 1 };
      }
      throw new Error(`Unhandled test query: ${sql}`);
    },
  },
};

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  exports: {
    requireAdmin: (req, res, next) => next(),
    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  },
};

const express = require('express');
const adminRoutes = require('../src/routes/admin');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
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

async function remove(path) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  return { response, body: await response.json() };
}

test('an admin can delete a course and its cascaded data', async () => {
  const { response, body } = await remove('/api/admin/courses/7');
  assert.equal(response.status, 200);
  assert.equal(body.course.code, 'DSA101');
  assert.deepEqual(deleted.at(-1), ['course', 7]);
});

test('an admin can delete a student globally', async () => {
  const { response, body } = await remove('/api/admin/students/23F-0871');
  assert.equal(response.status, 200);
  assert.equal(body.student.roll_number, '23F-0871');
  assert.deepEqual(deleted.at(-1), ['student', '23F-0871']);
});

test('an admin can delete an assessment and its marks', async () => {
  const { response, body } = await remove('/api/admin/assessments/11');
  assert.equal(response.status, 200);
  assert.equal(body.assessment.title, 'Quiz 1');
  assert.deepEqual(deleted.at(-1), ['assessment', 11]);
});

test('delete routes validate IDs and report missing records', async () => {
  let result = await remove('/api/admin/courses/not-a-number');
  assert.equal(result.response.status, 400);

  result = await remove('/api/admin/assessments/99');
  assert.equal(result.response.status, 404);
});
