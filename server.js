require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const today = () => db.localDate(0);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async error handling
const isDup = (e) => e && e.code === 'ER_DUP_ENTRY';
const dateOk = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const date = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
};
const phoneOk = (p) => typeof p === 'string' && /^\d{11}$/.test(p);

// Number of copies of a book currently out on loan
const LOANED_SQL = `(SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)`;

// ---------- DASHBOARD STATS ----------
app.get('/api/stats', wrap(async (req, res) => {
  const t = today();
  const totalTitles = (await db.get('SELECT COUNT(*) AS n FROM books')).n;
  const totalCopies = (await db.get('SELECT COALESCE(SUM(copies),0) AS n FROM books')).n;
  const totalMembers = (await db.get('SELECT COUNT(*) AS n FROM members')).n;
  const activeLoans = (await db.get('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL')).n;
  const overdue = (await db.get('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL AND due_date < ?', [t])).n;
  const byGenre = await db.all(
    'SELECT genre, COUNT(*) AS count FROM books GROUP BY genre ORDER BY count DESC LIMIT 6'
  );
  const recentLoans = await db.all(
    `SELECT l.id, b.title, m.name AS member, l.borrowed_at, l.due_date, l.returned_at
     FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id
     ORDER BY l.id DESC LIMIT 5`
  );
  res.json({
    totalTitles: Number(totalTitles),
    totalCopies: Number(totalCopies),
    totalMembers: Number(totalMembers),
    activeLoans: Number(activeLoans),
    overdue: Number(overdue),
    byGenre: byGenre.map((g) => ({ genre: g.genre, count: Number(g.count) })),
    recentLoans,
  });
}));

// ---------- BOOKS (CRUD) ----------
app.get('/api/books', wrap(async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = await db.all(
    `SELECT b.*, ${LOANED_SQL} AS loaned, b.copies - ${LOANED_SQL} AS available
     FROM books b
     WHERE b.title LIKE ? OR b.author LIKE ? OR b.genre LIKE ?
     ORDER BY b.title`,
    [q, q, q]
  );
  res.json(rows.map((r) => ({ ...r, loaned: Number(r.loaned), available: Number(r.available) })));
}));

app.post('/api/books', wrap(async (req, res) => {
  const { title, author, genre, publication_date, copies } = req.body || {};
  if (!clean(title) || !clean(author) || !clean(genre) || !clean(publication_date)) return bad(res, 'All book fields are required.');
  if (!dateOk(publication_date)) return bad(res, 'Please enter a valid publication date.');
  const c = Number(copies ?? 1);
  if (!Number.isInteger(c) || c < 1) return bad(res, 'Copies must be a whole number of at least 1.');
  const info = await db.run(
    'INSERT INTO books (title, author, genre, publication_date, copies) VALUES (?, ?, ?, ?, ?)',
    [clean(title), clean(author), clean(genre), publication_date, c]
  );
  res.status(201).json(await db.get('SELECT * FROM books WHERE id = ?', [info.insertId]));
}));

app.put('/api/books/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get('SELECT * FROM books WHERE id = ?', [id]);
  if (!existing) return bad(res, 'Book not found.', 404);
  const { title, author, genre, publication_date, copies } = req.body || {};
  if (!clean(title) || !clean(author) || !clean(genre) || !clean(publication_date)) return bad(res, 'All book fields are required.');
  if (!dateOk(publication_date)) return bad(res, 'Please enter a valid publication date.');
  const c = Number(copies ?? 1);
  if (!Number.isInteger(c) || c < 1) return bad(res, 'Copies must be a whole number of at least 1.');
  const out = Number(
    (await db.get('SELECT COUNT(*) AS n FROM loans WHERE book_id = ? AND returned_at IS NULL', [id])).n
  );
  if (c < out) return bad(res, `${out} cop${out === 1 ? 'y is' : 'ies are'} currently borrowed, so copies can't go below ${out}.`);
  await db.run('UPDATE books SET title=?, author=?, genre=?, publication_date=?, copies=? WHERE id=?', [
    clean(title), clean(author), clean(genre), publication_date, c, id,
  ]);
  res.json(await db.get('SELECT * FROM books WHERE id = ?', [id]));
}));

app.delete('/api/books/:id', wrap(async (req, res) => {
  const info = await db.run('DELETE FROM books WHERE id = ?', [Number(req.params.id)]);
  if (!info.affectedRows) return bad(res, 'Book not found.', 404);
  res.json({ ok: true });
}));

// ---------- MEMBERS (CRUD) ----------
app.get('/api/members', wrap(async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = await db.all(
    `SELECT m.*, (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.returned_at IS NULL) AS active_loans
     FROM members m
     WHERE m.name LIKE ? OR m.email LIKE ? OR IFNULL(m.phone,'') LIKE ?
     ORDER BY m.name`,
    [q, q, q]
  );
  res.json(rows.map((r) => ({ ...r, active_loans: Number(r.active_loans) })));
}));

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

app.post('/api/members', wrap(async (req, res) => {
  const { name, email, phone } = req.body || {};
  if (!clean(name) || !clean(email) || !clean(phone)) return bad(res, 'Name, email, and phone number are required.');
  if (!emailOk(clean(email))) return bad(res, 'Please enter a valid email address.');
  if (!phoneOk(clean(phone))) return bad(res, 'Phone number must contain exactly 11 digits.');
  try {
    const info = await db.run(
      'INSERT INTO members (name, email, phone, joined_at) VALUES (?, ?, ?, ?)',
      [clean(name), clean(email).toLowerCase(), clean(phone), today()]
    );
    res.status(201).json(await db.get('SELECT * FROM members WHERE id = ?', [info.insertId]));
  } catch (e) {
    if (isDup(e)) return bad(res, 'A member with that email already exists.', 409);
    throw e;
  }
}));

app.put('/api/members/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.get('SELECT 1 AS x FROM members WHERE id = ?', [id]))) return bad(res, 'Member not found.', 404);
  const { name, email, phone } = req.body || {};
  if (!clean(name) || !clean(email) || !clean(phone)) return bad(res, 'Name, email, and phone number are required.');
  if (!emailOk(clean(email))) return bad(res, 'Please enter a valid email address.');
  if (!phoneOk(clean(phone))) return bad(res, 'Phone number must contain exactly 11 digits.');
  try {
    await db.run('UPDATE members SET name=?, email=?, phone=? WHERE id=?', [
      clean(name), clean(email).toLowerCase(), clean(phone) || null, id,
    ]);
    res.json(await db.get('SELECT * FROM members WHERE id = ?', [id]));
  } catch (e) {
    if (isDup(e)) return bad(res, 'A member with that email already exists.', 409);
    throw e;
  }
}));

app.delete('/api/members/:id', wrap(async (req, res) => {
  const info = await db.run('DELETE FROM members WHERE id = ?', [Number(req.params.id)]);
  if (!info.affectedRows) return bad(res, 'Member not found.', 404);
  res.json({ ok: true });
}));

// ---------- LOANS (CRUD) ----------
app.get('/api/loans', wrap(async (req, res) => {
  const rows = await db.all(
    `SELECT l.*, b.title, b.author, m.name AS member
     FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id
     ORDER BY (l.returned_at IS NOT NULL), l.due_date ASC, l.id DESC`
  );
  res.json(rows);
}));

app.post('/api/loans', wrap(async (req, res) => {
  const { book_id, member_id, due_date } = req.body || {};
  const book = await db.get(
    `SELECT b.*, b.copies - ${LOANED_SQL} AS available FROM books b WHERE b.id = ?`,
    [Number(book_id)]
  );
  if (!book) return bad(res, 'Please choose a book.');
  if (!member_id || !(await db.get('SELECT 1 AS x FROM members WHERE id = ?', [Number(member_id)]))) return bad(res, 'Please choose a member.');
  if (Number(book.available) < 1) return bad(res, `No copies of "${book.title}" are available right now.`, 409);
  const due = due_date;
  if (!due || !dateOk(due)) return bad(res, 'Invalid due date.');
  const info = await db.run(
    'INSERT INTO loans (book_id, member_id, borrowed_at, due_date) VALUES (?, ?, ?, ?)',
    [book.id, Number(member_id), today(), due]
  );
  res.status(201).json(await db.get('SELECT * FROM loans WHERE id = ?', [info.insertId]));
}));

// Update a loan: change the due date and/or mark returned / un-return
app.put('/api/loans/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const loan = await db.get('SELECT * FROM loans WHERE id = ?', [id]);
  if (!loan) return bad(res, 'Loan not found.', 404);
  const { due_date, returned } = req.body || {};
  const due = due_date || loan.due_date;
  if (!dateOk(due)) return bad(res, 'Invalid due date.');
  let returnedAt = loan.returned_at;
  if (returned === true && !loan.returned_at) returnedAt = today();
  if (returned === false && loan.returned_at) {
    const b = await db.get(
      `SELECT b.copies - ${LOANED_SQL} AS available FROM books b WHERE b.id = ?`,
      [loan.book_id]
    );
    if (!b || Number(b.available) < 1) return bad(res, 'No copy is available to re-open this loan.', 409);
    returnedAt = null;
  }
  await db.run('UPDATE loans SET due_date=?, returned_at=? WHERE id=?', [due, returnedAt, id]);
  res.json(await db.get('SELECT * FROM loans WHERE id = ?', [id]));
}));

app.delete('/api/loans/:id', wrap(async (req, res) => {
  const info = await db.run('DELETE FROM loans WHERE id = ?', [Number(req.params.id)]);
  if (!info.affectedRows) return bad(res, 'Loan not found.', 404);
  res.json({ ok: true });
}));

// ---------- errors ----------
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// ---------- start ----------
db.init()
  .then(() => {
    app.listen(PORT, () => console.log(`📚 Library dashboard running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('\n❌ Could not connect to MySQL:', err.message);
    console.error('   Make sure MySQL is running and your .env credentials are correct.\n');
    process.exit(1);
  });
