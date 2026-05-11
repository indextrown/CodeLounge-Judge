'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getProblemById, listProblems } = require('./problemStore');
const { judgeSubmission, normalizeLanguage } = require('./judge');
const { UserStore, ROLE_ADMIN } = require('./userStore');

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const SESSION_COOKIE_NAME = 'code_lounge_session';
const DEFAULT_CORS_ORIGINS = [
  'http://127.0.0.1:12024',
  'http://localhost:12024',
  'http://127.0.0.1:3200',
  'http://localhost:3200',
  'http://127.0.0.1:3201',
  'http://localhost:3201',
];
const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');
const PROBLEMS_DIR = path.resolve(__dirname, '..', 'problems');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = statusCode < 500;
  }
}

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  };
  if (body && body.cookie) {
    headers['set-cookie'] = body.cookie;
    delete body.cookie;
  }
  const nextPayload = JSON.stringify(body);
  headers['content-length'] = Buffer.byteLength(nextPayload);
  res.writeHead(statusCode, headers);
  res.end(nextPayload);
}

function applyCors(req, res, allowedOrigins) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (!allowedOrigins.includes(origin) && !allowedOrigins.includes('*')) return false;

  res.setHeader('access-control-allow-origin', allowedOrigins.includes('*') ? '*' : origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] || 'content-type');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('vary', 'Origin');
  return true;
}

function getRequestUrl(req) {
  return new URL(req.url || '/', 'http://127.0.0.1');
}

function notFound(res) {
  jsonResponse(res, 404, { ok: false, error: 'not found' });
}

function methodNotAllowed(res, methods) {
  res.setHeader('allow', methods.join(', '));
  jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': stat.size,
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveFrontendFile(urlPathname) {
  const requestedPath = urlPathname === '/' ? '/index.html' : urlPathname;
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(FRONTEND_DIR, normalizedPath);
  if (!filePath.startsWith(FRONTEND_DIR)) return null;
  if (!fs.existsSync(filePath)) return null;
  if (!fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function resolveProblemAsset(urlPathname) {
  const assetPrefix = '/problem-assets/';
  if (!urlPathname.startsWith(assetPrefix)) return null;
  const relativePath = urlPathname.slice(assetPrefix.length);
  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PROBLEMS_DIR, normalizedPath);
  if (!filePath.startsWith(PROBLEMS_DIR)) return null;
  if (!fs.existsSync(filePath)) return null;
  if (!fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function readJsonBody(req, limitBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
      req.resume();
      return;
    }

    let receivedBytes = 0;
    let oversized = false;
    const chunks = [];

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > limitBytes) {
        oversized = true;
        reject(new HttpError(413, 'BODY_TOO_LARGE', `request body exceeds ${limitBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (oversized) return;
      if (receivedBytes === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || '');
  return cookieHeader.split(';').reduce((cookies, entry) => {
    const [rawKey, ...valueParts] = entry.trim().split('=');
    if (!rawKey) return cookies;
    cookies[rawKey] = decodeURIComponent(valueParts.join('='));
    return cookies;
  }, {});
}

function sessionCookie(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

function clearedSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getSessionToken(req) {
  return parseCookies(req)[SESSION_COOKIE_NAME] || null;
}

function currentUserFromRequest(req, userStore) {
  return userStore.getUserBySessionToken(getSessionToken(req));
}

function requireUser(req, userStore) {
  const user = currentUserFromRequest(req, userStore);
  if (!user) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'login is required');
  }
  return user;
}

function requireAdmin(req, userStore) {
  const user = requireUser(req, userStore);
  if (user.role !== ROLE_ADMIN) {
    throw new HttpError(403, 'ADMIN_REQUIRED', 'admin access required');
  }
  return user;
}

function problemSummary(problem) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    imageUrl: problem.imageUrl,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
  };
}

function problemDetail(problem) {
  return {
    ...problemSummary(problem),
    starterCodes: problem.starterCodes,
    testCases: problem.testCases.map((testCase, index) => ({
      index: index + 1,
      input: testCase.input,
      output: testCase.output,
    })),
  };
}

async function handleJudge(body) {
  const problemId = Number(body.problemId);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    throw new HttpError(400, 'INVALID_PROBLEM_ID', 'problemId must be a positive integer');
  }

  const language = normalizeLanguage(body.language);
  if (!language) {
    throw new HttpError(400, 'UNSUPPORTED_LANGUAGE', 'supported languages are cpp and swift');
  }

  const sourceCode = body.sourceCode ?? body.code;
  if (typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
    throw new HttpError(400, 'INVALID_SOURCE_CODE', 'sourceCode must be a non-empty string');
  }

  const problem = getProblemById(problemId);
  if (!problem) {
    throw new HttpError(404, 'PROBLEM_NOT_FOUND', 'problem not found');
  }

  const result = await judgeSubmission({ language, sourceCode, problem });
  return {
    ok: true,
    problem: problemSummary(problem),
    ...result,
  };
}

function validatePassword(body) {
  if (typeof body.password !== 'string') {
    throw new HttpError(400, 'INVALID_PASSWORD', 'password must be a string');
  }
}

function attachCookie(body, cookie) {
  return {
    ...body,
    cookie,
  };
}

function toErrorBody(error) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  return {
    statusCode,
    body: {
      ok: false,
      error: statusCode >= 500 && !error.expose ? 'internal server error' : error.message,
    },
  };
}

function createApp(options = {}) {
  const allowedOrigins = options.corsOrigins || DEFAULT_CORS_ORIGINS;
  const userStore = options.userStore || new UserStore({ dbPath: options.dbPath });
  const ownsUserStore = !options.userStore;
  const server = http.createServer(async (req, res) => {
    try {
      if (!applyCors(req, res, allowedOrigins)) {
        throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'origin not allowed');
      }

      const url = getRequestUrl(req);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'content-length': '0', 'cache-control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        jsonResponse(res, 200, { ok: true, service: 'code_lounge_backend' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/me') {
        jsonResponse(res, 200, { ok: true, user: currentUserFromRequest(req, userStore) });
        return;
      }

      if (url.pathname === '/auth/signup') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST', 'OPTIONS']);
          return;
        }
        const body = await readJsonBody(req);
        validatePassword(body);
        try {
          const user = userStore.createUser(body.username, body.password);
          const session = userStore.createSession(user.id);
          jsonResponse(res, 201, attachCookie({
            ok: true,
            user,
            sessionExpiresAt: session.expiresAt,
            isFirstAdmin: user.role === ROLE_ADMIN && userStore.listUsers().length === 1,
          }, sessionCookie(session.token, session.expiresAt)));
          return;
        } catch (error) {
          throw new HttpError(400, 'SIGNUP_FAILED', error.message);
        }
      }

      if (url.pathname === '/auth/login') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST', 'OPTIONS']);
          return;
        }
        const body = await readJsonBody(req);
        validatePassword(body);
        const user = userStore.authenticate(body.username, body.password);
        if (!user) {
          throw new HttpError(401, 'LOGIN_FAILED', 'invalid username or password');
        }
        const session = userStore.createSession(user.id);
        jsonResponse(res, 200, attachCookie({
          ok: true,
          user,
          sessionExpiresAt: session.expiresAt,
        }, sessionCookie(session.token, session.expiresAt)));
        return;
      }

      if (url.pathname === '/auth/logout') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST', 'OPTIONS']);
          return;
        }
        userStore.deleteSession(getSessionToken(req));
        jsonResponse(res, 200, attachCookie({ ok: true }, clearedSessionCookie()));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/problems') {
        jsonResponse(res, 200, { ok: true, problems: listProblems() });
        return;
      }

      const problemMatch = url.pathname.match(/^\/problems\/(\d+)$/);
      if (req.method === 'GET' && problemMatch) {
        const problem = getProblemById(Number(problemMatch[1]));
        if (!problem) {
          notFound(res);
          return;
        }
        jsonResponse(res, 200, { ok: true, problem: problemDetail(problem) });
        return;
      }

      const codeMatch = url.pathname.match(/^\/problems\/(\d+)\/code$/);
      if (codeMatch) {
        const user = requireUser(req, userStore);
        const problemId = Number(codeMatch[1]);
        const problem = getProblemById(problemId);
        if (!problem) {
          notFound(res);
          return;
        }
        const language = normalizeLanguage(url.searchParams.get('language'));
        if (!language) {
          throw new HttpError(400, 'UNSUPPORTED_LANGUAGE', 'supported languages are cpp and swift');
        }

        if (req.method === 'GET') {
          const saved = userStore.getSavedSource(user.id, problemId, language);
          jsonResponse(res, 200, {
            ok: true,
            sourceCode: saved ? saved.sourceCode : null,
            updatedAt: saved ? saved.updatedAt : null,
            starterCode: problem.starterCodes[language] || '',
          });
          return;
        }

        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          if (typeof body.sourceCode !== 'string') {
            throw new HttpError(400, 'INVALID_SOURCE_CODE', 'sourceCode must be a string');
          }
          const result = userStore.saveSource(user.id, problemId, language, body.sourceCode);
          jsonResponse(res, 200, { ok: true, updatedAt: result.updatedAt });
          return;
        }

        if (req.method === 'DELETE') {
          userStore.resetSource(user.id, problemId, language);
          jsonResponse(res, 200, { ok: true, reset: true, starterCode: problem.starterCodes[language] || '' });
          return;
        }

        methodNotAllowed(res, ['GET', 'PUT', 'DELETE', 'OPTIONS']);
        return;
      }

      if (url.pathname === '/judge') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST', 'OPTIONS']);
          return;
        }
        const user = requireUser(req, userStore);
        const body = await readJsonBody(req);
        const problemId = Number(body.problemId);
        const language = normalizeLanguage(body.language);
        if (Number.isInteger(problemId) && language && typeof body.sourceCode === 'string') {
          userStore.saveSource(user.id, problemId, language, body.sourceCode);
        }
        const result = await handleJudge(body);
        jsonResponse(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/admin/users') {
        requireAdmin(req, userStore);
        jsonResponse(res, 200, { ok: true, users: userStore.listUsers() });
        return;
      }

      const adminUserMatch = url.pathname.match(/^\/admin\/users\/(\d+)$/);
      if (adminUserMatch) {
        const actor = requireAdmin(req, userStore);
        const targetUserId = Number(adminUserMatch[1]);
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          throw new HttpError(400, 'INVALID_USER_ID', 'user id must be a positive integer');
        }

        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          try {
            const user = userStore.updateRole(targetUserId, body.role, actor.id);
            jsonResponse(res, 200, { ok: true, user });
            return;
          } catch (error) {
            throw new HttpError(400, 'UPDATE_ROLE_FAILED', error.message);
          }
        }

        if (req.method === 'DELETE') {
          try {
            userStore.deleteUserById(targetUserId, actor.id);
            jsonResponse(res, 200, { ok: true, deletedUserId: targetUserId });
            return;
          } catch (error) {
            throw new HttpError(400, 'DELETE_USER_FAILED', error.message);
          }
        }

        methodNotAllowed(res, ['PATCH', 'DELETE', 'OPTIONS']);
        return;
      }

      if (req.method === 'GET') {
        const problemAsset = resolveProblemAsset(url.pathname);
        if (problemAsset) {
          sendFile(res, problemAsset);
          return;
        }
        const frontendFile = resolveFrontendFile(url.pathname);
        if (frontendFile) {
          sendFile(res, frontendFile);
          return;
        }
      }

      notFound(res);
    } catch (error) {
      const { statusCode, body } = toErrorBody(error);
      jsonResponse(res, statusCode, body);
    }
  });

  if (ownsUserStore) {
    server.on('close', () => {
      userStore.close();
    });
  }

  return server;
}

module.exports = {
  createApp,
};
