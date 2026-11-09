require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const DB_NAME = process.env.DB_NAME || 'library_db';

let pool;

// Small helpers so the rest of the app stays tidy
const all = async (sql, params = []) => (await pool.query(sql, params))[0];
const get = async (sql, params = []) => (await all(sql, params))[0];
const run = async (sql, params = []) => (await pool.query(sql, params))[0]; // { insertId, affectedRows }

const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function init() {
  // 1. Create the database if it doesn't exist yet
  const conn = await mysql.createConnection(config);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
  await conn.end();

  // 2. Connection pool (dates come back as 'YYYY-MM-DD' strings)
  pool = mysql.createPool({
    ...config,
    database: DB_NAME,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
  });

  // 3. Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(255) NOT NULL,
      author     VARCHAR(255) NOT NULL,
      genre      VARCHAR(100) NOT NULL,
      publication_date DATE NOT NULL,
      copies     INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      name      VARCHAR(255) NOT NULL,
      email     VARCHAR(255) NOT NULL UNIQUE,
      phone     VARCHAR(50),
      joined_at DATE NOT NULL
    ) ENGINE=InnoDB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loans (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      book_id     INT NOT NULL,
      member_id   INT NOT NULL,
      borrowed_at DATE NOT NULL,
      due_date    DATE NOT NULL,
      returned_at DATE NULL,
      FOREIGN KEY (book_id)   REFERENCES books(id)   ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // Migrate older databases that still store a numeric publication year.
  const [columns] = await pool.query("SHOW COLUMNS FROM books LIKE 'publication_date'");
  if (columns.length === 0) {
    await pool.query('ALTER TABLE books ADD COLUMN publication_date DATE NULL');
    const [oldYear] = await pool.query("SHOW COLUMNS FROM books LIKE 'year'");
    if (oldYear.length > 0) {
      await pool.query("UPDATE books SET publication_date = STR_TO_DATE(CONCAT(`year`, '-01-01'), '%Y-%m-%d') WHERE `year` IS NOT NULL");
    }
    await pool.query("UPDATE books SET publication_date = CURRENT_DATE() WHERE publication_date IS NULL");
    await pool.query('ALTER TABLE books MODIFY publication_date DATE NOT NULL');
  }

  const [legacyIsbn] = await pool.query("SHOW COLUMNS FROM books LIKE 'isbn'");
  if (legacyIsbn.length > 0) await pool.query('ALTER TABLE books DROP COLUMN isbn');
  const [legacyYear] = await pool.query("SHOW COLUMNS FROM books LIKE 'year'");
  if (legacyYear.length > 0) await pool.query('ALTER TABLE books DROP COLUMN `year`');

  // 4. Seed sample data on first run
  const { n } = await get('SELECT COUNT(*) AS n FROM books');
  if (Number(n) === 0) await seed();
}

async function seed() {
  const books = [
    ['Noli Me Tangere', 'Jose Rizal', 'Classic', '1887-01-01', 3],
    ['El Filibusterismo', 'Jose Rizal', 'Classic', '1891-01-01', 2],
    ['Pride and Prejudice', 'Jane Austen', 'Romance', '1813-01-01', 2],
    ['The Hobbit', 'J.R.R. Tolkien', 'Fantasy', '1937-01-01', 4],
    ['1984', 'George Orwell', 'Dystopian', '1949-01-01', 3],
    ['Sapiens', 'Yuval Noah Harari', 'History', '2011-01-01', 2],
    ['Atomic Habits', 'James Clear', 'Self-Help', '2018-01-01', 5],
    ['Clean Code', 'Robert C. Martin', 'Technology', '2008-01-01', 2],
    ['To Kill a Mockingbird', 'Harper Lee', 'Classic', '1960-01-01', 3],
    ['Dune', 'Frank Herbert', 'Science Fiction', '1965-01-01', 2],
  ];
  for (const b of books) {
    await run('INSERT INTO books (title, author, genre, publication_date, copies) VALUES (?, ?, ?, ?, ?)', b);
  }

  const members = [
    ['Maria Santos', 'maria.santos@example.com', '09171234567', localDate(-300)],
    ['Juan Dela Cruz', 'juan.delacruz@example.com', '09287654321', localDate(-250)],
    ['Angel Reyes', 'angel.reyes@example.com', '09352221100', localDate(-200)],
    ['Liza Mendoza', 'liza.mendoza@example.com', '09065558899', localDate(-120)],
  ];
  for (const m of members) {
    await run('INSERT INTO members (name, email, phone, joined_at) VALUES (?, ?, ?, ?)', m);
  }

  // Loan dates are relative to today so the demo always has an overdue loan
  const loans = [
    [1, 1, localDate(-20), localDate(-6), null], // overdue
    [4, 2, localDate(-5), localDate(9), null],
    [7, 3, localDate(-3), localDate(11), null],
    [5, 1, localDate(-60), localDate(-46), localDate(-48)], // returned
  ];
  for (const l of loans) {
    await run('INSERT INTO loans (book_id, member_id, borrowed_at, due_date, returned_at) VALUES (?, ?, ?, ?, ?)', l);
  }
}

module.exports = { init, all, get, run, localDate };
