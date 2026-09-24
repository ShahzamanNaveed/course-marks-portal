require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function main() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!username || !password) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD before running this command.');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

  const hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [username, hash]
  );
  console.log(`Admin "${username}" is ready (id ${result.rows[0].id}).`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
