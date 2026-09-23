require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

require('./src/db'); // initializes the Postgres schema on startup

const studentAuthRoutes = require('./src/routes/studentAuth');
const studentRoutes = require('./src/routes/student');
const adminAuthRoutes = require('./src/routes/adminAuth');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', studentAuthRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// JSON error handler for anything that reaches here unhandled
app.use((err, req, res, next) => {
  console.error(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: status < 500 ? err.message : 'Something went wrong on our end. Please try again.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Marks portal running on http://localhost:${PORT}`);
  });
}

module.exports = app;
