'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getProblemById, listProblems } = require('./problemStore');
const { judgeSubmission, normalizeLanguage } = require('./judge');

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
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
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function applyCors(req, res, allowedOrigins) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (!allowedOrigins.includes(origin) && !allowedOrigins.includes('*')) return false;

  res.setHeader('access-control-allow-origin', allowedOrigins.includes('*') ? '*' : origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
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

  return http.createServer(async (req, res) => {
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

      if (url.pathname === '/judge') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST', 'OPTIONS']);
          return;
        }
        const body = await readJsonBody(req);
        const result = await handleJudge(body);
        jsonResponse(res, 200, result);
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
}

module.exports = {
  createApp,
};
