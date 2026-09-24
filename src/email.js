const nodemailer = require('nodemailer');

let transporter = null;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    const error = new Error(`Email delivery is not configured. Missing ${name}.`);
    error.status = 503;
    throw error;
  }
  return value;
}

function getTransporter() {
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: {
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS'),
    },
  });
  return transporter;
}

async function sendStudentOtp({ to, code, purpose }) {
  const subject = purpose === 'password_reset'
    ? 'Reset your Tally password'
    : 'Verify your Tally account';
  const action = purpose === 'password_reset'
    ? 'reset your password'
    : 'finish setting up your account';
  const from = String(process.env.SMTP_FROM || '').trim() || `Tally <${required('SMTP_USER')}>`;

  await getTransporter().sendMail({
    from,
    to,
    subject,
    text: `Your Tally verification code is ${code}.\n\nUse it to ${action}. It expires in 10 minutes.\n\nIf you did not request this code, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#1b2436;line-height:1.5">
        <h2 style="margin-bottom:8px">Tally verification</h2>
        <p>Use this code to ${action}:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>
        <p>This code expires in 10 minutes.</p>
        <p style="color:#5b6478">If you did not request this code, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendStudentOtp };
