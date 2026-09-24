# Tally Marks Portal

A student marks portal for a TA, ready for Vercel with a hosted PostgreSQL database.

## What changed

- PostgreSQL replaces the local SQLite file so data persists across Vercel deployments.
- The Express app exports a serverless handler while still supporting `npm start` locally.
- Existing SQLite records can be migrated, including password hashes.
- First-time password setup and password recovery require a one-time code sent to the student's university email.
- Production refuses to start without a real JWT secret.
- Course IDs and assessment IDs are validated; marks must be between zero and the maximum score and belong to enrolled students.
- Dynamic dashboard values are HTML-escaped.

## Local setup

Use Node.js 22 or newer and a PostgreSQL database.

```bash
npm install
copy .env.example .env
npm run seed-admin
npm start
```

Set these values in `.env`:

- `DATABASE_URL`: pooled PostgreSQL connection string. For hosted databases, use the provider's SSL connection string.
- `JWT_SECRET`: a long random value. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `OTP_SECRET`: a different long random value used to hash one-time codes. Generate it with the same command.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`: the dedicated mailbox used to send verification codes.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: used only by `npm run seed-admin`.

Student login is at `/`. The TA login is at `/admin/login.html`.

## University email verification

Students must already exist in a course roster. Tally converts a roll number such as `F23-0871` to `f230871@cfd.nu.edu.pk`, emails a six-digit code, and requires that code before allowing first-time password setup or password recovery. Codes expire after 10 minutes, can be attempted at most five times, and cannot be resent for 60 seconds.

For a dedicated Gmail sender:

1. Create a separate Google account for Tally and turn on two-step verification.
2. Create a Google App Password for the portal. Do not use the account's normal password.
3. Set the SMTP variables above locally and in Vercel. Store the 16-character App Password in `SMTP_PASS` without spaces.
4. Add every variable to the Production environment before deploying.

Never commit `.env`, an App Password, or any other credential to GitHub.

## Migrate the included SQLite data

Point `DATABASE_URL` at an empty PostgreSQL database, then run:

```bash
npm run migrate:sqlite
```

The default source is `data/marks.db`. To use another file, set `SQLITE_PATH` first. The migration is safe to rerun and preserves passwords already present in PostgreSQL. A student without a password can enter their rostered roll number and choose one on their first visit.

## Deploy to Vercel

1. Create a hosted PostgreSQL database and copy its pooled `DATABASE_URL`.
2. Import this folder into Vercel.
3. Add `DATABASE_URL`, `JWT_SECRET`, `OTP_SECRET`, the five `SMTP_*` variables, and `NODE_ENV=production` to the Vercel project environment variables.
4. Before sharing the site, run `npm run migrate:sqlite` locally with the production `DATABASE_URL` to transfer the included records. Alternatively, run `npm run seed-admin` against an empty production database.
5. Deploy and verify `/`, `/admin/login.html`, and a student account.

Do not add `ADMIN_PASSWORD` to Vercel. It is only needed locally when creating or changing an admin password.

## Checks

```bash
npm run check
```

The application creates missing tables automatically. Use your database provider's backups or point-in-time recovery for production data.
