const errorBox = document.getElementById('error');

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    window.location.href = '/admin/dashboard.html';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('visible');
  }
});
