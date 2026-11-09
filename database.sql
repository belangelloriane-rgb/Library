-- Optional: the app creates all of this automatically on startup.
-- Import this file only if you prefer to set up the database yourself
-- (MySQL Workbench, phpMyAdmin, XAMPP, etc.).

CREATE DATABASE IF NOT EXISTS library_db CHARACTER SET utf8mb4;
USE library_db;

CREATE TABLE IF NOT EXISTS books (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(255) NOT NULL,
  author     VARCHAR(255) NOT NULL,
  genre      VARCHAR(100) NOT NULL DEFAULT 'General',
  publication_date DATE NOT NULL,
  copies     INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS members (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  email     VARCHAR(255) NOT NULL UNIQUE,
  phone     VARCHAR(50),
  joined_at DATE NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loans (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  book_id     INT NOT NULL,
  member_id   INT NOT NULL,
  borrowed_at DATE NOT NULL,
  due_date    DATE NOT NULL,
  returned_at DATE NULL,
  FOREIGN KEY (book_id)   REFERENCES books(id)   ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB;
