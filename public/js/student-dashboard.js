const $ = (id) => document.getElementById(id);
const courseListEl = $('course-list');
const contentEl = $('content');
const whoEl = $('who');

let courses = [];
let activeCourseId = null;

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    window.location.href = '/index.html';
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function renderCourseList() {
  courseListEl.innerHTML = '';
  courses.forEach((c) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = `${c.code}`;
    btn.title = c.name;
    btn.className = c.id === activeCourseId ? 'active' : '';
    btn.addEventListener('click', () => selectCourse(c.id));
    li.appendChild(btn);
    courseListEl.appendChild(li);
  });
}

function renderMarks(course, items) {
  if (!items.length) {
    contentEl.innerHTML = `
      <div class="top-bar">
        <div><h2>${escapeHTML(course.name)}</h2><div class="course-code">${escapeHTML(course.code)}</div></div>
      </div>
      <div class="empty-state">No assignments or quizzes have been posted for this course yet.</div>
    `;
    return;
  }

  const rows = items
    .map((item) => {
      const label = item.type === 'quiz' ? 'Quiz' : 'Assignment';
      const scoreText = item.score === null || item.score === undefined ? '\u2014' : item.score;
      return `
        <tr>
          <td>${escapeHTML(item.title)}</td>
          <td><span class="badge">${label}</span></td>
          <td class="score">${escapeHTML(scoreText)} / ${escapeHTML(item.max_score)}</td>
        </tr>
      `;
    })
    .join('');

  contentEl.innerHTML = `
    <div class="top-bar">
      <div><h2>${escapeHTML(course.name)}</h2><div class="course-code">${escapeHTML(course.code)}</div></div>
    </div>
    <table>
      <thead>
        <tr><th>Item</th><th>Type</th><th class="score">Score</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function selectCourse(courseId) {
  activeCourseId = courseId;
  renderCourseList();
  contentEl.innerHTML = '<div class="empty-state">Loading\u2026</div>';
  try {
    const data = await getJSON(`/api/student/courses/${courseId}/marks`);
    if (data) renderMarks(data.course, data.items);
  } catch (err) {
    contentEl.innerHTML = `<div class="error-text visible">${escapeHTML(err.message)}</div>`;
  }
}

async function init() {
  try {
    const me = await getJSON('/api/auth/me');
    if (!me) return;
    whoEl.textContent = `${me.name} \u00b7 ${me.roll_number}`;

    courses = (await getJSON('/api/student/courses')) || [];
    if (!courses.length) {
      contentEl.innerHTML = '<div class="empty-state">You\u2019re not enrolled in any courses yet. Check with your TA if this seems wrong.</div>';
      return;
    }
    renderCourseList();
    selectCourse(courses[0].id);
  } catch (err) {
    contentEl.innerHTML = `<div class="error-text visible">${escapeHTML(err.message)}</div>`;
  }
}

$('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.href = '/index.html';
});

init();
