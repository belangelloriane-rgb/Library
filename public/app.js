const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayStr = () => localDate(0);
const formatDate = (value) => {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
};

const state = { view: 'dashboard', books: [], members: [], loans: [] };

const VIEWS = {
  dashboard: { title: 'Dashboard', sub: 'A cozy overview of your library', add: null },
  books: { title: 'Books', sub: 'Everything on your shelves', add: 'Add book' },
  members: { title: 'Members', sub: 'The readers in your community', add: 'Add member' },
  loans: { title: 'Loans', sub: 'Who has what, and until when', add: 'New loan' },
};

// ---------- API ----------
async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------- Navigation ----------
document.querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => {
    $('#search').value = '';
    show(b.dataset.view);
  })
);

function show(view) {
  state.view = view;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  const v = VIEWS[view];
  $('#view-title').textContent = v.title;
  $('#view-sub').textContent = v.sub;
  $('#add-btn').classList.toggle('hidden', !v.add);
  $('#add-btn').textContent = '+ ' + (v.add || '');
  $('#search').classList.toggle('hidden', view === 'dashboard' || view === 'loans');
  load();
}

async function load() {
  try {
    if (state.view === 'dashboard') await renderDashboard();
    if (state.view === 'books') await renderBooks();
    if (state.view === 'members') await renderMembers();
    if (state.view === 'loans') await renderLoans();
  } catch (e) {
    toast(e.message);
  }
}

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 200);
});

// ---------- Dashboard ----------
async function renderDashboard() {
  const s = await api('/api/stats');
  $('#stats').innerHTML = [
    ['Book titles', s.totalTitles, ''],
    ['Total copies', s.totalCopies, ''],
    ['Members', s.totalMembers, ''],
    ['Active loans', s.activeLoans, ''],
    ['Overdue', s.overdue, s.overdue ? 'alert' : ''],
  ]
    .map(([l, v, c]) => `<div class="stat ${c}"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');

  const max = Math.max(1, ...s.byGenre.map((g) => g.count));
  $('#genre-chart').innerHTML = s.byGenre.length
    ? s.byGenre
        .map(
          (g) => `<div class="bar-row"><span>${esc(g.genre)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(g.count / max) * 100}%"></div></div>
            <strong>${g.count}</strong></div>`
        )
        .join('')
    : '<p class="muted">No books yet.</p>';

  $('#recent').innerHTML = s.recentLoans.length
    ? s.recentLoans
        .map((l) => {
          const st = loanStatus(l);
          return `<li><div><strong>${esc(l.title)}</strong><small>${esc(l.member)} · due ${esc(l.due_date)}</small></div>
            <span class="pill ${st.cls}">${st.label}</span></li>`;
        })
        .join('')
    : '<p class="muted">No loans yet.</p>';
}

function loanStatus(l) {
  if (l.returned_at) return { label: 'Returned', cls: 'neutral' };
  if (l.due_date < todayStr()) return { label: 'Overdue', cls: 'danger' };
  return { label: 'On loan', cls: 'warn' };
}

// ---------- Books ----------
async function renderBooks() {
  state.books = await api('/api/books?q=' + encodeURIComponent($('#search').value));
  $('#books-body').innerHTML = state.books.length
    ? state.books
        .map(
          (b) => `<tr>
        <td><strong>${esc(b.title)}</strong></td><td>${esc(b.author)}</td>
        <td><span class="pill neutral">${esc(b.genre)}</span></td><td>${esc(formatDate(b.publication_date))}</td>
        <td><span class="pill ${b.available > 0 ? 'ok' : 'danger'}">${b.available} / ${b.copies}</span></td>
        <td class="actions">
          <button class="btn ghost small" onclick="editBook(${b.id})">Edit</button>
          <button class="btn danger small" onclick="removeItem('books', ${b.id})">Delete</button>
        </td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No books found.</td></tr>';
}

function bookForm(b = {}) {
  return `
    <label>Title<input name="title" required value="${esc(b.title)}" /></label>
    <label>Author<input name="author" required value="${esc(b.author)}" /></label>
    <div class="row">
      <label>Genre<input name="genre" required value="${esc(b.genre ?? '')}" placeholder="e.g. Fantasy" /></label>
      <label>Publication date<input name="publication_date" type="date" lang="en-US" required value="${esc(b.publication_date ?? '')}" /></label>
    </div>
    <label>Copies<input name="copies" type="number" min="1" step="1" required value="${esc(b.copies ?? 1)}" /></label>`;
}
window.editBook = (id) => {
  const b = state.books.find((x) => x.id === id);
  openModal('Edit book', bookForm(b), (d) => api('/api/books/' + id, 'PUT', d), 'Book updated');
};

// ---------- Members ----------
async function renderMembers() {
  state.members = await api('/api/members?q=' + encodeURIComponent($('#search').value));
  $('#members-body').innerHTML = state.members.length
    ? state.members
        .map(
          (m) => `<tr>
        <td><strong>${esc(m.name)}</strong></td><td>${esc(m.email)}</td><td>${esc(m.phone ?? '—')}</td>
        <td>${esc(formatDate(m.joined_at))}</td>
        <td><span class="pill ${m.active_loans ? 'warn' : 'neutral'}">${m.active_loans}</span></td>
        <td class="actions">
          <button class="btn ghost small" onclick="editMember(${m.id})">Edit</button>
          <button class="btn danger small" onclick="removeItem('members', ${m.id})">Delete</button>
        </td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No members found.</td></tr>';
}

function memberForm(m = {}) {
  return `
    <label>Full name<input name="name" required value="${esc(m.name)}" /></label>
    <label>Email<input name="email" type="email" required value="${esc(m.email)}" /></label>
    <label>Phone number<input name="phone" type="tel" inputmode="numeric" pattern="[0-9]{11}" minlength="11" maxlength="11" required placeholder="09XXXXXXXXX" value="${esc(String(m.phone ?? '').replace(/\D/g, '').slice(0, 11))}" /></label>`;
}
window.editMember = (id) => {
  const m = state.members.find((x) => x.id === id);
  openModal('Edit member', memberForm(m), (d) => api('/api/members/' + id, 'PUT', d), 'Member updated');
};

// ---------- Loans ----------
async function renderLoans() {
  state.loans = await api('/api/loans');
  $('#loans-body').innerHTML = state.loans.length
    ? state.loans
        .map((l) => {
          const st = loanStatus(l);
          return `<tr>
        <td><strong>${esc(l.title)}</strong><br /><small class="muted">${esc(l.author)}</small></td>
        <td>${esc(l.member)}</td><td>${esc(formatDate(l.borrowed_at))}</td><td>${esc(formatDate(l.due_date))}</td>
        <td><span class="pill ${st.cls}">${st.label}</span></td>
        <td class="actions">
          ${
            l.returned_at
              ? ''
              : `<button class="btn primary small" onclick="returnLoan(${l.id})">Return</button>`
          }
          <button class="btn ghost small" onclick="editLoan(${l.id})">Edit</button>
          <button class="btn danger small" onclick="removeItem('loans', ${l.id})">Delete</button>
        </td></tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="empty">No loans yet.</td></tr>';
}

window.returnLoan = async (id) => {
  try {
    await api('/api/loans/' + id, 'PUT', { returned: true });
    toast('Book returned');
    load();
  } catch (e) {
    toast(e.message);
  }
};

window.editLoan = (id) => {
  const l = state.loans.find((x) => x.id === id);
  const html = `
    <p class="muted"><strong>${esc(l.title)}</strong> — ${esc(l.member)}</p>
    <label>Due date<input name="due_date" type="date" lang="en-US" required value="${esc(l.due_date)}" /></label>
    <label>Status
      <select name="returned" required>
        <option value="false" ${!l.returned_at ? 'selected' : ''}>On loan</option>
        <option value="true" ${l.returned_at ? 'selected' : ''}>Returned</option>
      </select>
    </label>`;
  openModal('Edit loan', html, (d) => api('/api/loans/' + id, 'PUT', { due_date: d.due_date, returned: d.returned === 'true' }), 'Loan updated');
};

async function newLoanForm() {
  const [books, members] = await Promise.all([api('/api/books'), api('/api/members')]);
  const avail = books.filter((b) => b.available > 0);
  return `
    <label>Book
      <select name="book_id" required>
        <option value="">Choose a book…</option>
        ${avail.map((b) => `<option value="${b.id}">${esc(b.title)} (${b.available} available)</option>`).join('')}
      </select>
    </label>
    <label>Member
      <select name="member_id" required>
        <option value="">Choose a member…</option>
        ${members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
      </select>
    </label>
    <label>Due date<input name="due_date" type="date" lang="en-US" required value="${localDate(14)}" /></label>`;
}

// ---------- Add / Delete / Modal ----------
$('#add-btn').addEventListener('click', async () => {
  if (state.view === 'books') openModal('Add book', bookForm(), (d) => api('/api/books', 'POST', d), 'Book added');
  if (state.view === 'members') openModal('Add member', memberForm(), (d) => api('/api/members', 'POST', d), 'Member added');
  if (state.view === 'loans') {
    try {
      openModal('New loan', await newLoanForm(), (d) => api('/api/loans', 'POST', d), 'Loan created');
    } catch (e) {
      toast(e.message);
    }
  }
});

window.removeItem = async (type, id) => {
  const names = { books: 'book', members: 'member', loans: 'loan' };
  if (!confirm(`Delete this ${names[type]}? This can't be undone.`)) return;
  try {
    await api(`/api/${type}/${id}`, 'DELETE');
    toast('Deleted');
    load();
  } catch (e) {
    toast(e.message);
  }
};

let onSubmit = null;
function openModal(title, formHtml, handler, successMsg) {
  $('#modal-title').textContent = title;
  $('#modal-form').innerHTML = formHtml;
  $('#modal-error').classList.add('hidden');
  $('#modal').classList.remove('hidden');
  onSubmit = async (data) => {
    await handler(data);
    toast(successMsg);
  };
  const first = $('#modal-form').querySelector('input, select');
  if (first) first.focus();
}
const closeModal = () => $('#modal').classList.add('hidden');
$('#modal-cancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

$('#modal-form').addEventListener('input', (e) => {
  if (e.target.name === 'phone') {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
  }
});

$('#modal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.phone !== undefined) data.phone = data.phone.replace(/\D/g, '').slice(0, 11);
  try {
    await onSubmit(data);
    closeModal();
    load();
  } catch (err) {
    const box = $('#modal-error');
    box.textContent = err.message;
    box.classList.remove('hidden');
  }
});

show('dashboard');
