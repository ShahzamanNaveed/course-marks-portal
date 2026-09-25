const $ = (id) => document.getElementById(id);
const courseListEl = $('course-list');
const contentEl = $('content');

let courses = [];
let activeCourseId = null;
let requestNumber = 0;

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

courseListEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-course-id]');
  if (!button) return;
  selectCourse(Number(button.dataset.courseId));
});

async function init() {
  try {
    const me = await getJSON('/api/auth/me');
    if (!me) return;
    $('student-name').textContent = me.name;
    $('student-roll').textContent = me.roll_number;
    $('student-avatar').textContent = String(me.name || 'S').trim().charAt(0).toUpperCase() || 'S';

    courses = (await getJSON('/api/student/courses')) || [];
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
