const $ = (id) => document.getElementById(id);
const courseListEl = $('course-list');
const contentEl = $('content');

let courses = [];
let activeCourseId = null;
let requestNumber = 0;
let activeView = 'marks';
const courseAssessments = new Map();

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value));
}

function formatPercent(value) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
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

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/index.html'; return null; }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function renderCourseList() {
  courseListEl.innerHTML = courses
    .map((course) => `
      <li>
        <button type="button" data-course-id="${escapeHTML(course.id)}" class="${course.id === activeCourseId ? 'active' : ''}" ${course.id === activeCourseId ? 'aria-current="page"' : ''}>
          <span class="course-nav-code">${escapeHTML(course.code)}</span>
          <span class="course-nav-name">${escapeHTML(course.name)}</span>
        </button>
      </li>
    `)
    .join('');
}

function loadingView() {
  contentEl.setAttribute('aria-busy', 'true');
  contentEl.innerHTML = `
    <div class="dashboard-loading" aria-label="Loading course marks">
      <div class="skeleton skeleton-title"></div>
      <div class="summary-grid">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
      <div class="skeleton skeleton-list"></div>
    </div>
  `;
}

function renderEmptyCourse(course) {
  contentEl.removeAttribute('aria-busy');
  contentEl.innerHTML = `
    <section class="student-view">
      <header class="course-hero">
        <div>
          <div class="course-eyebrow">${escapeHTML(course.code)}</div>
          <h1>${escapeHTML(course.name)}</h1>
          <p>Your marks will appear here as soon as your TA publishes them.</p>
        </div>
        <button type="button" class="secondary refresh-marks-btn">Refresh</button>
      </header>
      <div class="student-empty-state">
        <div class="empty-icon" aria-hidden="true">✓</div>
        <h2>Nothing posted yet</h2>
        <p>There are no assignments or quizzes in this course right now.</p>
      </div>
    </section>
  `;
  bindRefreshButton();
}

function markCard(item) {
  const isGraded = item.score !== null && item.score !== undefined;
  const label = item.type === 'quiz' ? 'Quiz' : 'Assignment';
  const percentage = isGraded && Number(item.max_score) > 0
    ? (Number(item.score) / Number(item.max_score)) * 100
    : null;
  const score = isGraded
    ? `<strong>${escapeHTML(formatNumber(item.score))}</strong><span>/ ${escapeHTML(formatNumber(item.max_score))}</span>`
    : '<strong class="pending-score">Pending</strong>';
  const progress = percentage === null
    ? '<div class="mark-progress is-pending" aria-hidden="true"><span></span></div>'
    : `<div class="mark-progress" role="progressbar" aria-label="${escapeHTML(item.title)} score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percentage)}"><span style="width:${Math.max(0, Math.min(100, percentage))}%"></span></div>`;

  return `
    <article class="mark-card" data-mark-type="${escapeHTML(item.type)}">
      <div class="mark-main">
        <span class="badge ${item.type === 'quiz' ? 'badge-quiz' : ''}">${label}</span>
        <h3>${escapeHTML(item.title)}</h3>
      </div>
      <div class="mark-result ${isGraded ? '' : 'is-pending'}">
        <div class="mark-score">${score}</div>
        ${isGraded ? `<div class="mark-percentage">${escapeHTML(formatPercent(percentage))}</div>` : '<div class="mark-percentage">Awaiting marks</div>'}
      </div>
      ${progress}
    </article>
  `;
}

function renderMarks(course, items) {
  if (!items.length) {
    renderEmptyCourse(course);
    return;
  }

  const graded = items.filter((item) => item.score !== null && item.score !== undefined);
  const pending = items.length - graded.length;
  const earnedPoints = graded.reduce((sum, item) => sum + Number(item.score), 0);
  const availablePoints = graded.reduce((sum, item) => sum + Number(item.max_score), 0);
  const overall = availablePoints > 0 ? (earnedPoints / availablePoints) * 100 : null;
  const assignments = items.filter((item) => item.type === 'assignment').length;
  const quizzes = items.filter((item) => item.type === 'quiz').length;

  contentEl.removeAttribute('aria-busy');
  contentEl.innerHTML = `
    <section class="student-view">
      <header class="course-hero">
        <div>
          <div class="course-eyebrow">${escapeHTML(course.code)}</div>
          <h1>${escapeHTML(course.name)}</h1>
          <p>A clear view of your released marks in this course.</p>
        </div>
        <button type="button" class="secondary refresh-marks-btn">Refresh</button>
      </header>

      <div class="summary-grid" aria-label="Course summary">
        <article class="summary-card summary-primary">
          <span class="summary-label">Current score</span>
          <strong>${overall === null ? '—' : escapeHTML(formatPercent(overall))}</strong>
          <small>${overall === null ? 'No graded work yet' : `${escapeHTML(formatNumber(earnedPoints))} of ${escapeHTML(formatNumber(availablePoints))} graded points`}</small>
        </article>
        <article class="summary-card">
          <span class="summary-label">Marks released</span>
          <strong>${graded.length}<span class="summary-denominator"> / ${items.length}</span></strong>
          <small>${graded.length === 1 ? 'item has a score' : 'items have scores'}</small>
        </article>
        <article class="summary-card">
          <span class="summary-label">Awaiting marks</span>
          <strong>${pending}</strong>
          <small>${pending === 1 ? 'item is still pending' : 'items are still pending'}</small>
        </article>
      </div>

      <section class="marks-section" aria-labelledby="marks-heading">
        <div class="marks-toolbar">
          <div>
            <div class="section-eyebrow">Assessment record</div>
            <h2 id="marks-heading">Your marks</h2>
          </div>
          <div class="filter-group" aria-label="Filter marks">
            <button type="button" class="mark-filter active" data-filter="all" aria-pressed="true">All <span>${items.length}</span></button>
            <button type="button" class="mark-filter" data-filter="assignment" aria-pressed="false">Assignments <span>${assignments}</span></button>
            <button type="button" class="mark-filter" data-filter="quiz" aria-pressed="false">Quizzes <span>${quizzes}</span></button>
          </div>
        </div>
        <p class="filter-result" id="filter-result">Showing all ${items.length} items</p>
        <div class="marks-list">
          ${items.map(markCard).join('')}
        </div>
        <div class="filtered-empty" hidden>No items match this filter.</div>
      </section>
    </section>
  `;

  bindRefreshButton();
  document.querySelectorAll('.mark-filter').forEach((button) => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter));
  });
}

function applyFilter(filter) {
  const cards = Array.from(document.querySelectorAll('.mark-card'));
  let visible = 0;
  cards.forEach((card) => {
    const show = filter === 'all' || card.dataset.markType === filter;
    card.hidden = !show;
    if (show) visible += 1;
  });

  document.querySelectorAll('.mark-filter').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const labels = { all: 'items', assignment: 'assignments', quiz: 'quizzes' };
  $('filter-result').textContent = `Showing ${visible} ${labels[filter]}`;
  document.querySelector('.filtered-empty').hidden = visible !== 0;
}

function bindRefreshButton() {
  document.querySelector('.refresh-marks-btn')?.addEventListener('click', () => selectCourse(activeCourseId));
}

function renderError(message) {
  contentEl.removeAttribute('aria-busy');
  contentEl.innerHTML = `
    <div class="student-error" role="alert">
      <h2>We couldn’t load your marks</h2>
      <p>${escapeHTML(message)}</p>
      <button type="button" id="retry-btn">Try again</button>
    </div>
  `;
  $('retry-btn').addEventListener('click', () => selectCourse(activeCourseId));
}

async function selectCourse(courseId) {
  const course = courses.find((item) => item.id === courseId);
  if (!course) return;

  activeCourseId = courseId;
  const currentRequest = ++requestNumber;
  renderCourseList();
  history.replaceState(null, '', `#course-${courseId}`);
  document.title = `${course.code} — Tally`;
  loadingView();

  try {
    const data = await getJSON(`/api/student/courses/${courseId}/marks`);
    if (data && currentRequest === requestNumber) renderMarks(data.course, data.items);
  } catch (err) {
    if (currentRequest === requestNumber) renderError(err.message);
  }
}

const categoryLabels = { quiz: 'Quiz', assignment: 'Assignment', assessment_marks: 'Assessment marks', attendance: 'Attendance', other: 'Other course question' };

async function renderNotifications() {
  activeView = 'notifications';
  contentEl.setAttribute('aria-busy', 'true');
  try {
    const rows = await getJSON('/api/student/notifications');
    contentEl.removeAttribute('aria-busy');
    contentEl.innerHTML = `<section class="student-view"><header class="course-hero"><div><div class="course-eyebrow">Updates</div><h1>Notifications</h1><p>Approved mark updates from your teaching team.</p></div></header><div class="notification-list">${rows.length ? rows.map((item) => `<article class="notification-item ${item.is_read ? '' : 'unread'}"><div><span class="badge">${escapeHTML(item.course_code)}</span><h3>${escapeHTML(item.assessment_title)}</h3><p>${escapeHTML(item.message)}</p><small>${escapeHTML(new Date(item.created_at).toLocaleString())}</small></div>${item.is_read ? '' : `<button type="button" class="secondary mark-read-btn" data-id="${escapeHTML(item.id)}">Mark read</button>`}</article>`).join('') : '<div class="student-empty-state"><div class="empty-icon" aria-hidden="true">✓</div><h2>No notifications</h2><p>Approved updates will appear here.</p></div>'}</div></section>`;
    document.querySelectorAll('.mark-read-btn').forEach((button) => button.addEventListener('click', async () => { await postJSON(`/api/student/notifications/${button.dataset.id}/read`); await renderNotifications(); }));
  } catch (error) { renderError(error.message); }
}

async function renderQueries() {
  activeView = 'queries';
  contentEl.setAttribute('aria-busy', 'true');
  try {
    const [rows] = await Promise.all([
      getJSON('/api/student/queries'),
      Promise.all(courses.map(async (course) => {
        if (!courseAssessments.has(course.id)) {
          const data = await getJSON(`/api/student/courses/${course.id}/marks`);
          courseAssessments.set(course.id, data.items || []);
        }
        return course;
      })),
    ]);
    contentEl.removeAttribute('aria-busy');
    contentEl.innerHTML = `<section class="student-view"><header class="course-hero"><div><div class="course-eyebrow">Support</div><h1>Course queries</h1><p>Ask about a quiz, assignment, marks, or another course concern.</p></div></header><div class="card query-form-card"><div class="query-form-heading"><div><span class="section-eyebrow">Send a message</span><h2>Start a new query</h2></div><span class="query-step-count">4 steps</span></div><p class="query-form-intro">Choose the course and assessment, then tell us what you need help with.</p><form id="query-form" class="query-form"><div class="query-field"><span class="query-step">01</span><div><label for="query-course">Course</label><select id="query-course" required>${courses.map((course) => `<option value="${escapeHTML(course.id)}"${course.id === activeCourseId ? ' selected' : ''}>${escapeHTML(course.code)} — ${escapeHTML(course.name)}</option>`).join('')}</select></div></div><div class="query-field"><span class="query-step">02</span><div><label for="query-category">Assessment type</label><select id="query-category" required><option value="quiz">Quiz</option><option value="assignment">Assignment</option><option value="assessment_marks">Assessment marks</option><option value="attendance">Attendance</option><option value="other">Other course question</option></select></div></div><div class="query-field"><span class="query-step">03</span><div><label for="query-subject">Which assessment?</label><select id="query-subject" required></select><input type="hidden" id="query-subject-value"></div></div><div class="query-field query-field-description"><span class="query-step">04</span><div><label for="query-description">Description</label><textarea id="query-description" maxlength="4000" placeholder="Describe your question or concern in detail..." required></textarea><small>Include any details that will help your teaching team respond.</small></div></div><div class="query-submit-row"><button type="submit">Submit query</button><span class="status-line" id="query-status" role="status"></span></div></form></div><div class="query-list">${rows.length ? rows.map((item) => `<article class="query-item"><div class="query-heading"><span class="badge">${escapeHTML(categoryLabels[item.category] || item.category)}</span><span class="badge">${escapeHTML(item.status)}</span></div><h3>${escapeHTML(item.subject)}</h3><p>${escapeHTML(item.description)}</p>${item.admin_response ? `<div class="query-response"><strong>Admin response</strong><p>${escapeHTML(item.admin_response)}</p></div>` : '<small>Awaiting a response</small>'}</article>`).join('') : '<div class="student-empty-state"><h2>No queries yet</h2><p>Your submitted questions will appear here.</p></div>'}</div></section>`;
    const courseSelect = $('query-course');
    const categorySelect = $('query-category');
    const subjectSelect = $('query-subject');
    const updateAssessments = () => {
      const items = (courseAssessments.get(Number(courseSelect.value)) || []).filter((item) => item.type === categorySelect.value);
      subjectSelect.innerHTML = items.length
        ? items.map((item) => `<option value="${escapeHTML(item.title)}">${escapeHTML(item.title)}</option>`).join('')
        : '<option value="General course question">General course question</option>';
      subjectSelect.disabled = false;
    };
    courseSelect.addEventListener('change', updateAssessments);
    categorySelect.addEventListener('change', updateAssessments);
    updateAssessments();
    $('query-form').addEventListener('submit', async (event) => { event.preventDefault(); const status = $('query-status'); try { await postJSON('/api/student/queries', { course_id: courseSelect.value, category: categorySelect.value, subject: subjectSelect.value, description: $('query-description').value }); status.textContent = 'Query submitted.'; event.target.reset(); await renderQueries(); } catch (error) { status.textContent = error.message; } });
  } catch (error) { renderError(error.message); }
}

courseListEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-course-id]');
  if (!button) return;
  selectCourse(Number(button.dataset.courseId));
});

document.querySelectorAll('.dashboard-tools [data-view]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.dashboard-tools button').forEach((item) => item.classList.toggle('active', item === button));
  if (button.dataset.view === 'notifications') renderNotifications();
  if (button.dataset.view === 'queries') renderQueries();
}));

async function init() {
  try {
    const me = await getJSON('/api/auth/me');
    if (!me) return;
    $('student-name').textContent = me.name;
    $('student-roll').textContent = me.roll_number;
    $('student-avatar').textContent = String(me.name || 'S').trim().charAt(0).toUpperCase() || 'S';

    courses = (await getJSON('/api/student/courses')) || [];
    const notifications = (await getJSON('/api/student/notifications')) || [];
    $('notification-count').textContent = notifications.filter((item) => !item.is_read).length;
    if (!courses.length) {
      contentEl.removeAttribute('aria-busy');
      contentEl.innerHTML = `
        <div class="student-empty-state no-courses">
          <div class="empty-icon" aria-hidden="true">+</div>
          <h1>No courses yet</h1>
          <p>You’re not enrolled in a course. Check with your TA if this doesn’t look right.</p>
        </div>
      `;
      return;
    }

    const hashMatch = window.location.hash.match(/^#course-(\d+)$/);
    const requestedId = hashMatch ? Number(hashMatch[1]) : null;
    const initialCourse = courses.find((course) => course.id === requestedId) || courses[0];
    selectCourse(initialCourse.id);
  } catch (err) {
    renderError(err.message);
  }
}

$('logout-btn').addEventListener('click', async () => {
  const button = $('logout-btn');
  button.disabled = true;
  button.textContent = 'Signing out…';
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/index.html';
  } catch {
    button.disabled = false;
    button.textContent = 'Sign out';
  }
});

init();
