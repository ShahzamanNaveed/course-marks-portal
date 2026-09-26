const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

const ROLL_PATTERN = /^\d{2}[A-Z]-\d{4}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/admin/login.html';
    throw new Error('Not signed in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let confirmResolver = null;

function closeConfirmDialog(result = false) {
  $('confirm-modal').hidden = true;
  document.body.classList.remove('modal-open');
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(result);
  }
}

function confirmAction(title, message, confirmLabel = 'Confirm') {
  if (confirmResolver) closeConfirmDialog(false);
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-action').textContent = confirmLabel;
  $('confirm-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('confirm-action').focus();
  return new Promise((resolve) => { confirmResolver = resolve; });
}

document.querySelectorAll('[data-close-confirm]').forEach((element) => element.addEventListener('click', () => closeConfirmDialog(false)));
$('confirm-action').addEventListener('click', () => closeConfirmDialog(true));

// Parses pasted text into rows of [col1, col2], accepting commas or tabs as
// the separator and ignoring a header row if the first cell looks like a label.
function parseRows(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((cell) => cell.trim().replace(/^"|"$/g, '')))
    .filter((cells) => cells.length >= 2)
    .filter((cells, i, arr) => {
      if (i !== 0) return true;
      const first = cells[0].toLowerCase();
      return !['roll_number', 'roll no', 'roll number', 'roll'].includes(first);
    });
}

// ---------- Navigation ----------

const panels = ['courses', 'roster', 'assessments', 'marks', 'notifications', 'queries'];
document.querySelectorAll('.nav-list button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.panel;
    panels.forEach((p) => {
      $(`panel-${p}`).style.display = p === target ? 'block' : 'none';
    });
    document.querySelectorAll('.nav-list button').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

$('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.href = '/admin/login.html';
});

// ---------- Shared course state ----------

let courses = [];

function fillCourseSelect(select, { includeBlank = false } = {}) {
  const previous = select.value;
  select.innerHTML = '';
  if (includeBlank || !courses.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = courses.length ? 'Select a course\u2026' : 'Add a course first';
    select.appendChild(opt);
  }
  courses.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.code} \u2014 ${c.name}`;
    select.appendChild(opt);
  });
  if (previous && courses.some((course) => String(course.id) === previous)) select.value = previous;
}

async function loadCourses() {
  courses = await api('/api/admin/courses');
  renderCoursesTable();
  fillCourseSelect($('roster-course'));
  fillCourseSelect($('assessments-course'));
  fillCourseSelect($('marks-course'));
  await Promise.all([loadRoster(), loadAssessments(), onMarksCourseChange()]);
}
function renderCoursesTable() {
  const tbody = document.querySelector('#courses-table tbody');
  tbody.innerHTML = courses
    .map((c) => `<tr>
      <td class="roll">${escapeHTML(c.code)}</td>
      <td>${escapeHTML(c.name)}</td>
      <td class="score">${escapeHTML(c.student_count)}</td>
      <td><div class="table-actions"><button type="button" class="secondary icon-action edit-course-btn" aria-label="Edit course ${escapeHTML(c.code)}" title="Edit course" data-id="${escapeHTML(c.id)}" data-code="${escapeHTML(c.code)}" data-name="${escapeHTML(c.name)}">&#9998;</button><button type="button" class="danger icon-action delete-course-btn" aria-label="Delete course ${escapeHTML(c.code)}" title="Delete course" data-id="${escapeHTML(c.id)}" data-code="${escapeHTML(c.code)}">&#128465;</button></div></td>
    </tr>`)
    .join('') || '<tr><td colspan="4" class="empty-state">No courses yet.</td></tr>';
}

document.querySelector('#courses-table tbody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-course-btn');
  if (editBtn) {
    $('edit-course-id').value = editBtn.dataset.id;
    $('edit_course_code').value = editBtn.dataset.code;
    $('edit_course_name').value = editBtn.dataset.name;
    $('course-edit-card').style.display = 'block';
    $('edit_course_name').focus();
    return;
  }
  const btn = e.target.closest('.delete-course-btn');
  if (!btn) return;
  const courseId = btn.dataset.id;
  const code = btn.dataset.code;
  if (!await confirmAction('Delete course?', `This will permanently delete ${code}, including its assignments, quizzes, marks, and enrollments. Student accounts will remain.`, 'Delete course')) return;
  btn.disabled = true;
  try {
    await api(`/api/admin/courses/${courseId}`, { method: 'DELETE' });
    $('course-status').textContent = `Course ${code} deleted.`;
    await loadCourses();
  } catch (err) {
    $('course-status').textContent = err.message;
    btn.disabled = false;
  }
});

$('cancel-course-edit').addEventListener('click', () => { $('course-edit-card').style.display = 'none'; });
$('course-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/courses/${$('edit-course-id').value}`, { method: 'PATCH', body: JSON.stringify({ code: $('edit_course_code').value.trim(), name: normalizeName($('edit_course_name').value) }) });
    $('course-edit-card').style.display = 'none';
    $('course-status').textContent = 'Course updated.';
    await loadCourses();
  } catch (err) { $('course-status').textContent = err.message; }
});

$('course-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('course-status');
  status.textContent = '';
  try {
    await api('/api/admin/courses', {
      method: 'POST',
      body: JSON.stringify({ code: $('course_code').value.trim(), name: $('course_name').value.trim() }),
    });
    $('course_code').value = '';
    $('course_name').value = '';
    status.textContent = 'Course added.';
    await loadCourses();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------- Roster ----------

$('roster-course').addEventListener('change', loadRoster);

async function loadRoster() {
  const courseId = $('roster-course').value;
  const tbody = document.querySelector('#roster-table tbody');
  if (!courseId) {
    tbody.innerHTML = '';
    return;
  }
  const students = await api(`/api/admin/courses/${courseId}/students`);
  tbody.innerHTML = students
    .map(
      (s) => `<tr>
        <td class="roll">${escapeHTML(s.roll_number)}</td>
        <td>${escapeHTML(s.name)}</td>
        <td>${s.password_set ? 'Yes' : '<span class="hint">Not yet</span>'}</td>
        <td><div class="table-actions">
          ${s.password_set ? `<button type="button" class="secondary reset-pw-btn" aria-label="Reset password for ${escapeHTML(s.roll_number)}" title="Reset password" data-roll="${escapeHTML(s.roll_number)}">&#8635;</button>` : ''}
          <button type="button" class="danger icon-action delete-student-btn" aria-label="Delete student ${escapeHTML(s.roll_number)}" title="Delete student" data-roll="${escapeHTML(s.roll_number)}" data-name="${escapeHTML(s.name)}">&#128465;</button>
        </div></td>
      </tr>`
    )
    .join('') || '<tr><td colspan="4" class="empty-state">No students enrolled yet.</td></tr>';
}

document.querySelector('#roster-table tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.reset-pw-btn, .delete-student-btn');
  if (!btn) return;
  const roll = btn.dataset.roll;
  if (btn.classList.contains('delete-student-btn')) {
    const name = btn.dataset.name;
    if (!await confirmAction('Delete student?', `This will permanently remove ${roll} (${name}), including enrollments, marks, password, and verification codes.`, 'Delete student')) return;
    btn.disabled = true;
    try {
      await api(`/api/admin/students/${encodeURIComponent(roll)}`, { method: 'DELETE' });
      $('roster-status').textContent = `Student ${roll} deleted.`;
      await loadRoster();
      await loadCourses();
      await loadMarksGrid();
    } catch (err) {
      $('roster-status').textContent = err.message;
      btn.disabled = false;
    }
    return;
  }
  if (!await confirmAction('Reset student password?', `${roll} will be able to choose a new password after the current password is cleared.`, 'Reset password')) return;
  try {
    await api(`/api/admin/students/${encodeURIComponent(roll)}/reset-password`, { method: 'POST' });
    $('roster-status').textContent = `Password cleared for ${roll}. The student can now choose a new password.`;
    await loadRoster();
  } catch (err) {
    $('roster-status').textContent = err.message;
  }
});

$('roster-submit').addEventListener('click', async () => {
  const courseId = $('roster-course').value;
  const status = $('roster-status');
  status.textContent = '';
  if (!courseId) {
    status.textContent = 'Choose a course first.';
    return;
  }
  const rows = parseRows($('roster-text').value);
  if (!rows.length) {
    status.textContent = 'Paste at least one row as: roll_number, name';
    return;
  }
  const students = rows.map(([roll_number, name]) => ({ roll_number: String(roll_number || '').trim().toUpperCase(), name: normalizeName(name) }));
  const invalid = students.find((student) => !ROLL_PATTERN.test(student.roll_number) || !NAME_PATTERN.test(student.name));
  if (invalid) {
    status.textContent = `${invalid.roll_number || 'Student'}: use roll format 23F-0615 and a name beginning with a letter.`;
    return;
  }
  try {
    const result = await api(`/api/admin/courses/${courseId}/roster`, {
      method: 'POST',
      body: JSON.stringify({ students }),
    });
    status.textContent = `Added ${result.added} new student(s), enrolled ${result.enrolled} in this course.`;
    $('roster-text').value = '';
    await loadRoster();
    await loadCourses();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------- Assessments ----------

$('assessments-course').addEventListener('change', loadAssessments);

async function loadAssessments() {
  const courseId = $('assessments-course').value;
  const tbody = document.querySelector('#assessments-table tbody');
  if (!courseId) {
    tbody.innerHTML = '';
    return;
  }
  const items = await api(`/api/admin/courses/${courseId}/assessments`);
  tbody.innerHTML = items
    .map(
      (a) => `<tr>
        <td>${escapeHTML(a.title)}</td>
        <td><span class="badge">${a.type === 'quiz' ? 'Quiz' : 'Assignment'}</span></td>
        <td class="score">${escapeHTML(a.max_score)}</td>
        <td><div class="table-actions"><button type="button" class="secondary icon-action edit-assessment-btn" aria-label="Edit ${escapeHTML(a.title)}" title="Edit assessment" data-id="${escapeHTML(a.id)}" data-title="${escapeHTML(a.title)}" data-type="${escapeHTML(a.type)}" data-max="${escapeHTML(a.max_score)}">&#9998;</button><button type="button" class="danger icon-action delete-assessment-btn" aria-label="Delete ${escapeHTML(a.title)}" title="Delete assessment" data-id="${escapeHTML(a.id)}" data-title="${escapeHTML(a.title)}" data-type="${escapeHTML(a.type)}">&#128465;</button></div></td>
      </tr>`
    )
    .join('') || '<tr><td colspan="4" class="empty-state">No items yet.</td></tr>';
}

document.querySelector('#assessments-table tbody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-assessment-btn');
  if (editBtn) {
    $('edit-assessment-id').value = editBtn.dataset.id;
    $('edit_a_type').value = editBtn.dataset.type;
    $('edit_a_title').value = editBtn.dataset.title;
    $('edit_a_max').value = editBtn.dataset.max;
    $('assessment-edit-card').style.display = 'block';
    $('edit_a_title').focus();
    return;
  }
  const btn = e.target.closest('.delete-assessment-btn');
  if (!btn) return;
  const assessmentId = btn.dataset.id;
  const label = btn.dataset.type === 'quiz' ? 'quiz' : 'assignment';
  const title = btn.dataset.title;
  if (!await confirmAction(`Delete ${label}?`, `This will permanently delete “${title}” and all marks entered for it.`, `Delete ${label}`)) return;
  btn.disabled = true;
  try {
    await api(`/api/admin/assessments/${assessmentId}`, { method: 'DELETE' });
    $('assessment-status').textContent = `${label === 'quiz' ? 'Quiz' : 'Assignment'} “${title}” deleted.`;
    await loadAssessments();
    if ($('marks-course').value === $('assessments-course').value) {
      await onMarksCourseChange();
    }
  } catch (err) {
    $('assessment-status').textContent = err.message;
    btn.disabled = false;
  }
});

$('cancel-assessment-edit').addEventListener('click', () => { $('assessment-edit-card').style.display = 'none'; });
$('assessment-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/assessments/${$('edit-assessment-id').value}`, {
      method: 'PATCH',
      body: JSON.stringify({ type: $('edit_a_type').value, title: $('edit_a_title').value.trim(), max_score: $('edit_a_max').value }),
    });
    $('assessment-edit-card').style.display = 'none';
    $('assessment-status').textContent = 'Assessment updated.';
    await loadAssessments();
    if ($('marks-course').value === $('assessments-course').value) await loadMarksAssessments();
  } catch (err) { $('assessment-status').textContent = err.message; }
});

$('assessment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('assessment-status');
  status.textContent = '';
  const courseId = $('assessments-course').value;
  if (!courseId) {
    status.textContent = 'Choose a course first.';
    return;
  }
  try {
    await api(`/api/admin/courses/${courseId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        type: $('a_type').value,
        title: $('a_title').value.trim(),
        max_score: $('a_max').value.trim(),
      }),
    });
    $('a_title').value = '';
    $('a_max').value = '';
    status.textContent = 'Added.';
    await loadAssessments();
    if ($('marks-course').value === courseId) await loadMarksAssessments();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------- Marks entry ----------

$('marks-course').addEventListener('change', onMarksCourseChange);
$('marks-assessment').addEventListener('change', loadMarksGrid);

async function onMarksCourseChange() {
  await loadMarksAssessments();
  await loadMarksGrid();
}

async function loadMarksAssessments() {
  const courseId = $('marks-course').value;
  const select = $('marks-assessment');
  select.innerHTML = '';
  if (!courseId) return;
  const items = await api(`/api/admin/courses/${courseId}/assessments`);
  if (!items.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Add an assignment or quiz first';
    select.appendChild(opt);
    return;
  }
  items.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.dataset.max = a.max_score;
    opt.textContent = `${a.title} (${a.type === 'quiz' ? 'Quiz' : 'Assignment'}, /${a.max_score})`;
    select.appendChild(opt);
  });
}

async function loadMarksGrid() {
  const assessmentId = $('marks-assessment').value;
  const table = $('marks-table');
  const tbody = document.querySelector('#marks-table tbody');
  const saveBtn = $('marks-save-btn');
  const pasteCard = $('paste-fill-card');

  if (!assessmentId) {
    table.style.display = 'none';
    saveBtn.style.display = 'none';
    pasteCard.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  const data = await api(`/api/admin/assessments/${assessmentId}/marks`);
  tbody.innerHTML = data.rows
    .map(
      (r) => `<tr data-roll="${escapeHTML(r.roll_number)}">
        <td class="roll">${escapeHTML(r.roll_number)}</td>
        <td>${escapeHTML(r.name)}</td>
        <td class="score"><input type="number" min="0" max="${escapeHTML(data.assessment.max_score)}" step="any" class="input-score" value="${escapeHTML(r.score ?? '')}" placeholder="\u2014"></td>
      </tr>`
    )
    .join('') || '<tr><td colspan="3" class="empty-state">No students enrolled in this course yet.</td></tr>';

  table.style.display = data.rows.length ? 'table' : 'none';
  saveBtn.style.display = data.rows.length ? 'inline-block' : 'none';
  pasteCard.style.display = data.rows.length ? 'block' : 'none';
}

$('paste-fill-btn').addEventListener('click', () => {
  const rows = parseRows($('paste-fill-text').value);
  let filled = 0;
  rows.forEach(([roll_number, score]) => {
    const row = document.querySelector(`#marks-table tr[data-roll="${CSS.escape(roll_number)}"]`);
    if (row) {
      row.querySelector('.input-score').value = score;
      filled += 1;
    }
  });
  $('marks-status').textContent = `Filled ${filled} of ${rows.length} pasted row(s) into the table below. Review, then save.`;
});

$('marks-save-btn').addEventListener('click', async () => {
  const assessmentId = $('marks-assessment').value;
  const status = $('marks-status');
  status.textContent = '';
  if (!assessmentId) return;

  const marks = Array.from(document.querySelectorAll('#marks-table tbody tr[data-roll]')).map((row) => ({
    roll_number: row.dataset.roll,
    score: row.querySelector('.input-score').value.trim(),
  }));

  try {
    const result = await api(`/api/admin/assessments/${assessmentId}/marks`, {
      method: 'POST',
      body: JSON.stringify({ marks }),
    });
    status.textContent = `Saved ${result.saved} score(s).`;
  } catch (err) {
    status.textContent = err.message;
  }
});

async function loadNotifications() {
  const status = $('notification-filter').value;
  const [rows, allRows] = await Promise.all([
    api(`/api/admin/notifications${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    api('/api/admin/notifications'),
  ]);
  const pendingCount = allRows.filter((item) => item.status === 'pending').length;
  const doneCount = allRows.filter((item) => item.status === 'sent').length;
  const queryCount = $('admin-query-count');
  queryCount.textContent = pendingCount;
  queryCount.hidden = pendingCount === 0;
  $('notification-summary').textContent = `${pendingCount} pending · ${doneCount} done`;
  document.querySelector('#notifications-table tbody').innerHTML = rows.map((item) => `<tr>
    <td><strong>${escapeHTML(item.student_roll_number)}</strong><br><span class="hint">${escapeHTML(item.student_name)}</span></td>
    <td>${escapeHTML(item.course_code)}<br><span class="hint">${escapeHTML(item.assessment_title)}</span></td>
    <td>${escapeHTML(item.message)}</td><td><span class="badge">${item.status === 'pending' ? 'Pending' : 'Done'}</span></td>
    <td class="actions-column">${item.notification_type === 'mark'
      ? (item.status === 'pending' ? `<button type="button" class="approve-notification-btn" data-id="${escapeHTML(item.notification_id)}">Approve &amp; send</button>` : 'Sent')
      : `<div class="table-actions"><button type="button" class="secondary view-query-notification-btn" data-id="${escapeHTML(item.query_id)}" data-status="${escapeHTML(item.query_status)}" data-subject="${escapeHTML(item.assessment_title)}" data-course="${escapeHTML(item.course_code)}" data-description="${escapeHTML(item.description || '')}" data-response="${escapeHTML(item.admin_response || '')}">View</button>${item.status === 'pending' ? `<button type="button" class="query-done-btn" data-id="${escapeHTML(item.query_id)}" data-response="${escapeHTML(item.admin_response || '')}">Mark as done</button>` : 'Done'}</div>`}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty-state">No notifications found.</td></tr>';
}
$('notification-filter').addEventListener('change', loadNotifications);
document.querySelector('#notifications-table tbody').addEventListener('click', async (event) => {
  const button = event.target.closest('.approve-notification-btn');
  const queryButton = event.target.closest('.view-query-notification-btn');
  const doneButton = event.target.closest('.query-done-btn');
  if (button) {
    if (!await confirmAction('Approve mark update?', 'This will send the mark change notification to the student.', 'Approve & send')) return;
    button.disabled = true;
    try { await api(`/api/admin/notifications/${button.dataset.id}/approve`, { method: 'POST' }); await loadNotifications(); }
    catch (err) { button.disabled = false; alert(err.message); }
    return;
  }
  if (queryButton) {
    openQueryEditor(queryButton);
    return;
  }
  if (doneButton) {
    doneButton.disabled = true;
    try {
      await api(`/api/admin/queries/${doneButton.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', admin_response: doneButton.dataset.response }) });
      await Promise.all([loadNotifications(), loadQueries()]);
    } catch (err) { doneButton.disabled = false; alert(err.message); }
  }
});

async function loadQueries() {
  const status = $('query-status-filter').value;
  const rows = await api(`/api/admin/queries${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  document.querySelector('#queries-table tbody').innerHTML = rows.map((item) => `<tr>
    <td><strong>${escapeHTML(item.student_roll_number)}</strong><br><span class="hint">${escapeHTML(item.student_name)}</span></td>
    <td>${escapeHTML(item.course_code)}</td><td><strong>${escapeHTML(item.subject)}</strong><br><span class="hint">${escapeHTML(item.description)}</span></td>
    <td><span class="badge">${escapeHTML(item.status)}</span></td>
    <td class="actions-column"><div class="table-actions">${item.admin_response ? `<button type="button" class="secondary icon-action edit-query-response-btn" aria-label="Edit response for ${escapeHTML(item.subject)}" title="Edit response" data-id="${escapeHTML(item.id)}" data-status="${escapeHTML(item.status)}" data-subject="${escapeHTML(item.subject)}" data-course="${escapeHTML(item.course_code)}" data-description="${escapeHTML(item.description)}" data-response="${escapeHTML(item.admin_response)}">&#9998;</button><button type="button" class="danger icon-action delete-query-btn" aria-label="Delete query ${escapeHTML(item.subject)}" title="Delete query" data-id="${escapeHTML(item.id)}">&#128465;</button>` : `<button type="button" class="respond-query-btn" data-id="${escapeHTML(item.id)}" data-status="${escapeHTML(item.status)}" data-subject="${escapeHTML(item.subject)}" data-course="${escapeHTML(item.course_code)}" data-description="${escapeHTML(item.description)}" data-response="">Respond</button>`}</div></td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty-state">No queries found.</td></tr>';
}
$('query-status-filter').addEventListener('change', loadQueries);
function openQueryEditor(button) {
  $('query-response-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('query-editor-title').textContent = button.dataset.subject;
  $('query-editor-context').textContent = `${button.dataset.course} · ${button.dataset.description}`;
  $('query-response-status').value = button.dataset.status;
  $('query-response-text').value = button.dataset.response;
  $('query-response-status-line').textContent = '';
  $('query-response-text').focus();
  $('query-response-form').dataset.id = button.dataset.id;
}
document.querySelector('#queries-table tbody').addEventListener('click', async (event) => {
  const responseButton = event.target.closest('.respond-query-btn, .edit-query-response-btn');
  const deleteButton = event.target.closest('.delete-query-btn');
  if (responseButton) openQueryEditor(responseButton);
  if (deleteButton) {
    if (!await confirmAction('Delete query?', 'This will permanently remove the query, its response, and its notifications.', 'Delete query')) return;
    deleteButton.disabled = true;
    try { await api(`/api/admin/queries/${deleteButton.dataset.id}`, { method: 'DELETE' }); await Promise.all([loadQueries(), loadNotifications()]); }
    catch (err) { deleteButton.disabled = false; alert(err.message); }
  }
});
function closeQueryEditor() {
  $('query-response-modal').hidden = true;
  document.body.classList.remove('modal-open');
}
document.querySelectorAll('[data-close-query-modal]').forEach((element) => element.addEventListener('click', closeQueryEditor));
$('query-response-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = $('save-query-response');
  saveButton.disabled = true;
  try {
    await api(`/api/admin/queries/${event.target.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: $('query-response-status').value, admin_response: $('query-response-text').value }) });
    closeQueryEditor();
    await Promise.all([loadQueries(), loadNotifications()]);
  } catch (err) {
    $('query-response-status-line').textContent = err.message;
  } finally { saveButton.disabled = false; }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('confirm-modal').hidden) closeConfirmDialog(false);
  else if (!$('query-response-modal').hidden) closeQueryEditor();
});

// ---------- Init ----------

(async function init() {
  try {
    const me = await api('/api/admin/auth/me');
    $('who').textContent = me.username;
    await loadCourses();
    await Promise.all([loadNotifications(), loadQueries()]);
  } catch (err) {
    // api() already redirects on 401; anything else, surface it
    if (err.message !== 'Not signed in.') {
      $('who').textContent = err.message;
    }
  }
})();
