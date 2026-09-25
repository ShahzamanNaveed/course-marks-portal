const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
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

const panels = ['courses', 'roster', 'assessments', 'marks'];
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
      <td><div class="table-actions"><button type="button" class="danger delete-course-btn" data-id="${escapeHTML(c.id)}" data-code="${escapeHTML(c.code)}">Delete</button></div></td>
    </tr>`)
    .join('') || '<tr><td colspan="4" class="empty-state">No courses yet.</td></tr>';
}

document.querySelector('#courses-table tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-course-btn');
  if (!btn) return;
  const courseId = btn.dataset.id;
  const code = btn.dataset.code;
  if (!confirm(`Delete course ${code}? This permanently deletes its assignments, quizzes, marks, and enrollments. Student accounts will remain.`)) return;
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
          ${s.password_set ? `<button type="button" class="secondary reset-pw-btn" data-roll="${escapeHTML(s.roll_number)}">Reset password</button>` : ''}
          <button type="button" class="danger delete-student-btn" data-roll="${escapeHTML(s.roll_number)}" data-name="${escapeHTML(s.name)}">Delete</button>
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
    if (!confirm(`Delete ${roll} (${name})? This permanently removes the student, their enrollments, marks, password, and verification codes from every course.`)) return;
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
  if (!confirm(`Clear the password for ${roll}? The student will be able to choose a new password.`)) return;
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
  const students = rows.map(([roll_number, name]) => ({ roll_number, name }));
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
        <td><div class="table-actions"><button type="button" class="danger delete-assessment-btn" data-id="${escapeHTML(a.id)}" data-title="${escapeHTML(a.title)}" data-type="${escapeHTML(a.type)}">Delete</button></div></td>
      </tr>`
    )
    .join('') || '<tr><td colspan="4" class="empty-state">No items yet.</td></tr>';
}

document.querySelector('#assessments-table tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-assessment-btn');
  if (!btn) return;
  const assessmentId = btn.dataset.id;
  const label = btn.dataset.type === 'quiz' ? 'quiz' : 'assignment';
  const title = btn.dataset.title;
  if (!confirm(`Delete ${label} “${title}”? This permanently deletes all marks entered for it.`)) return;
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

// ---------- Init ----------

(async function init() {
  try {
    const me = await api('/api/admin/auth/me');
    $('who').textContent = me.username;
    await loadCourses();
  } catch (err) {
    // api() already redirects on 401; anything else, surface it
    if (err.message !== 'Not signed in.') {
      $('who').textContent = err.message;
    }
  }
})();
