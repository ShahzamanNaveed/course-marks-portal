const $ = (id) => document.getElementById(id);

const rollForm = $('roll-form');
const loginForm = $('login-form');
const setupForm = $('setup-form');
const errorBox = $('error');
const heading = $('heading');

let currentRoll = '';

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}
function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}
function showOnly(form) {
  [rollForm, loginForm, setupForm].forEach((f) => (f.style.display = f === form ? 'block' : 'none'));
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

rollForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  currentRoll = $('roll_number').value.trim();
  if (!currentRoll) return;

  const submitBtn = $('roll-submit');
  submitBtn.disabled = true;
  try {
    const data = await postJSON('/api/auth/check-roll', { roll_number: currentRoll });
    heading.textContent = `Hi, ${data.name}`;
    if (data.needs_password_setup) {
      showOnly(setupForm);
      $('new_password').focus();
    } else {
      showOnly(loginForm);
      $('password').focus();
    }
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  try {
    await postJSON('/api/auth/login', { roll_number: currentRoll, password: $('password').value });
    window.location.href = '/dashboard.html';
  } catch (err) {
    showError(err.message);
  }
});

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const pw = $('new_password').value;
  const confirm = $('confirm_password').value;
  if (pw !== confirm) {
    showError('Passwords don\u2019t match.');
    return;
  }
  try {
    await postJSON('/api/auth/set-password', {
      roll_number: currentRoll,
      password: pw,
    });
    window.location.href = '/dashboard.html';
  } catch (err) {
    showError(err.message);
  }
});

$('back-from-login').addEventListener('click', () => {
  clearError();
  heading.textContent = 'Sign in with your roll number';
  showOnly(rollForm);
});
$('back-from-setup').addEventListener('click', () => {
  clearError();
  heading.textContent = 'Sign in with your roll number';
  showOnly(rollForm);
});
