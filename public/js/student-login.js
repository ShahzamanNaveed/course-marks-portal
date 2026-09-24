const $ = (id) => document.getElementById(id);

const rollForm = $('roll-form');
const loginForm = $('login-form');
const emailForm = $('email-form');
const otpForm = $('otp-form');
const setupForm = $('setup-form');
const forms = [rollForm, loginForm, emailForm, otpForm, setupForm];
const errorBox = $('error');
const heading = $('heading');

let currentRoll = '';
let currentPurpose = 'password_setup';
let emailHint = '';

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}

function showOnly(form) {
  forms.forEach((item) => (item.style.display = item === form ? 'block' : 'none'));
}

function startOver() {
  clearError();
  currentRoll = '';
  currentPurpose = 'password_setup';
  emailHint = '';
  heading.textContent = 'Sign in with your roll number';
  rollForm.reset();
  loginForm.reset();
  otpForm.reset();
  setupForm.reset();
  showOnly(rollForm);
  $('roll_number').focus();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function showEmailStep(purpose) {
  currentPurpose = purpose;
  heading.textContent = purpose === 'password_reset' ? 'Reset your password' : 'Verify your university email';
  $('email-help').textContent = `We’ll send a six-digit code to ${emailHint}.`;
  showOnly(emailForm);
}

async function sendOtp() {
  const button = $('email-submit');
  button.disabled = true;
  clearError();
  try {
    const data = await postJSON('/api/auth/send-otp', {
      roll_number: currentRoll,
      purpose: currentPurpose,
    });
    emailHint = data.email_hint;
    heading.textContent = 'Enter your verification code';
    $('otp-help').textContent = `We sent a code to ${emailHint}. It expires in ${data.expires_in_minutes} minutes.`;
    otpForm.reset();
    showOnly(otpForm);
    $('otp_code').focus();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

rollForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  currentRoll = $('roll_number').value.trim();
  if (!currentRoll) return;

  const submitButton = $('roll-submit');
  submitButton.disabled = true;
  try {
    const data = await postJSON('/api/auth/check-roll', { roll_number: currentRoll });
    currentRoll = data.roll_number;
    emailHint = data.email_hint;
    heading.textContent = `Hi, ${data.name}`;
    if (data.needs_password_setup) {
      showEmailStep('password_setup');
    } else {
      showOnly(loginForm);
      $('password').focus();
    }
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  try {
    await postJSON('/api/auth/login', { roll_number: currentRoll, password: $('password').value });
    window.location.href = '/dashboard.html';
  } catch (error) {
    showError(error.message);
  }
});

emailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendOtp();
});

otpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const code = $('otp_code').value.trim();
  try {
    await postJSON('/api/auth/verify-otp', {
      roll_number: currentRoll,
      purpose: currentPurpose,
      code,
    });
    heading.textContent = currentPurpose === 'password_reset' ? 'Choose a new password' : 'Create your password';
    $('setup-help').textContent = 'Your university email is verified. Choose a password you’ll remember.';
    showOnly(setupForm);
    $('new_password').focus();
  } catch (error) {
    showError(error.message);
  }
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const password = $('new_password').value;
  const confirmation = $('confirm_password').value;
  if (password !== confirmation) {
    showError('Passwords don’t match.');
    return;
  }
  try {
    await postJSON('/api/auth/set-password', { password });
    window.location.href = '/dashboard.html';
  } catch (error) {
    showError(error.message);
  }
});

$('forgot-password').addEventListener('click', () => {
  clearError();
  showEmailStep('password_reset');
});

$('resend-code').addEventListener('click', () => {
  clearError();
  showEmailStep(currentPurpose);
});

$('back-from-login').addEventListener('click', startOver);
$('back-from-email').addEventListener('click', startOver);
$('back-from-otp').addEventListener('click', () => showEmailStep(currentPurpose));
$('back-from-setup').addEventListener('click', startOver);
