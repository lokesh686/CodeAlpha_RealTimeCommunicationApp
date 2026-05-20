const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'comm.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    hostId INTEGER NOT NULL,
    password TEXT DEFAULT '',
    isLocked INTEGER DEFAULT 0,
    maxParticipants INTEGER DEFAULT 10,
    createdAt TEXT DEFAULT (datetime('now')),
    expiresAt TEXT NOT NULL
  );
`);

module.exports = db;
