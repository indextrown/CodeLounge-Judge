'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'code-lounge.sqlite');
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
const PASSWORD_MIN_LENGTH = 6;

function nowIso() {
  return new Date().toISOString();
}

function addDurationIso(durationMs) {
  return new Date(Date.now() + durationMs).toISOString();
}

function assertValidRole(role) {
  if (role !== ROLE_ADMIN && role !== ROLE_USER) {
    throw new Error('role must be admin or user');
  }
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

function normalizeLanguage(language) {
  return String(language || '').trim().toLowerCase();
}

function validateCredentials(username, password) {
  const normalizedUsername = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw new Error('username must be 3-24 chars using letters, numbers, or underscore');
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return normalizedUsername;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || '').split(':');
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
  };
}

class UserStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.initialize();
    this.prepareStatements();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_sources (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_id INTEGER NOT NULL,
        language TEXT NOT NULL,
        source_code TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, problem_id, language)
      );
    `);
  }

  prepareStatements() {
    this.statements = {
      userCount: this.db.prepare('SELECT COUNT(*) AS count FROM users'),
      findUserByUsername: this.db.prepare('SELECT * FROM users WHERE username_lower = ?'),
      findUserById: this.db.prepare('SELECT * FROM users WHERE id = ?'),
      insertUser: this.db.prepare(`
        INSERT INTO users (username, username_lower, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      insertSession: this.db.prepare(`
        INSERT INTO sessions (token, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `),
      deleteSession: this.db.prepare('DELETE FROM sessions WHERE token = ?'),
      deleteExpiredSessions: this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      findUserBySession: this.db.prepare(`
        SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ? AND sessions.expires_at > ?
      `),
      listUsers: this.db.prepare(`
        SELECT id, username, role, created_at
        FROM users
        ORDER BY created_at ASC, id ASC
      `),
      updateUserRole: this.db.prepare('UPDATE users SET role = ? WHERE id = ?'),
      deleteUser: this.db.prepare('DELETE FROM users WHERE id = ?'),
      countAdmins: this.db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`),
      getSavedSource: this.db.prepare(`
        SELECT source_code, updated_at
        FROM saved_sources
        WHERE user_id = ? AND problem_id = ? AND language = ?
      `),
      upsertSavedSource: this.db.prepare(`
        INSERT INTO saved_sources (user_id, problem_id, language, source_code, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, problem_id, language)
        DO UPDATE SET source_code = excluded.source_code, updated_at = excluded.updated_at
      `),
      deleteSavedSource: this.db.prepare(`
        DELETE FROM saved_sources
        WHERE user_id = ? AND problem_id = ? AND language = ?
      `),
    };
  }

  createUser(username, password) {
    const normalizedUsername = validateCredentials(username, password);
    const existingUser = this.statements.findUserByUsername.get(normalizedUsername.toLowerCase());
    if (existingUser) {
      throw new Error('username is already in use');
    }

    const role = this.statements.userCount.get().count === 0 ? ROLE_ADMIN : ROLE_USER;
    const createdAt = nowIso();
    const passwordHash = hashPassword(password);
    const result = this.statements.insertUser.run(
      normalizedUsername,
      normalizedUsername.toLowerCase(),
      passwordHash,
      role,
      createdAt
    );

    return this.getUserById(result.lastInsertRowid);
  }

  authenticate(username, password) {
    const normalizedUsername = normalizeUsername(username);
    const user = this.statements.findUserByUsername.get(normalizedUsername.toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return null;
    }
    return toPublicUser(user);
  }

  getUserById(userId) {
    return toPublicUser(this.statements.findUserById.get(userId));
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = nowIso();
    const expiresAt = addDurationIso(SESSION_DURATION_MS);
    this.statements.insertSession.run(token, userId, expiresAt, createdAt);
    return { token, expiresAt };
  }

  getUserBySessionToken(token) {
    if (!token) return null;
    this.statements.deleteExpiredSessions.run(nowIso());
    return toPublicUser(this.statements.findUserBySession.get(token, nowIso()));
  }

  deleteSession(token) {
    if (!token) return;
    this.statements.deleteSession.run(token);
  }

  listUsers() {
    return this.statements.listUsers.all().map((row) => toPublicUser(row));
  }

  updateRole(targetUserId, nextRole, actorUserId) {
    assertValidRole(nextRole);
    const user = this.getUserById(targetUserId);
    if (!user) {
      throw new Error('user not found');
    }

    if (user.id === actorUserId && user.role === ROLE_ADMIN && nextRole !== ROLE_ADMIN) {
      const adminCount = this.statements.countAdmins.get().count;
      if (adminCount <= 1) {
        throw new Error('at least one admin account must remain');
      }
    }

    if (user.role === ROLE_ADMIN && nextRole !== ROLE_ADMIN) {
      const adminCount = this.statements.countAdmins.get().count;
      if (adminCount <= 1) {
        throw new Error('at least one admin account must remain');
      }
    }

    this.statements.updateUserRole.run(nextRole, targetUserId);
    return this.getUserById(targetUserId);
  }

  deleteUserById(targetUserId, actorUserId) {
    const user = this.getUserById(targetUserId);
    if (!user) {
      throw new Error('user not found');
    }
    if (user.id === actorUserId) {
      throw new Error('you cannot delete your own account from admin page');
    }
    if (user.role === ROLE_ADMIN) {
      const adminCount = this.statements.countAdmins.get().count;
      if (adminCount <= 1) {
        throw new Error('at least one admin account must remain');
      }
    }
    this.statements.deleteUser.run(targetUserId);
  }

  getSavedSource(userId, problemId, language) {
    const normalizedLanguage = normalizeLanguage(language);
    const row = this.statements.getSavedSource.get(userId, problemId, normalizedLanguage);
    return row ? { sourceCode: row.source_code, updatedAt: row.updated_at } : null;
  }

  saveSource(userId, problemId, language, sourceCode) {
    const normalizedLanguage = normalizeLanguage(language);
    const updatedAt = nowIso();
    this.statements.upsertSavedSource.run(userId, problemId, normalizedLanguage, String(sourceCode), updatedAt);
    return { updatedAt };
  }

  resetSource(userId, problemId, language) {
    const normalizedLanguage = normalizeLanguage(language);
    this.statements.deleteSavedSource.run(userId, problemId, normalizedLanguage);
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  DEFAULT_DB_PATH,
  ROLE_ADMIN,
  ROLE_USER,
  SESSION_DURATION_MS,
  UserStore,
};
