'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createApp } = require('../src/app');

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-lounge-test-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const server = createApp({ dbPath });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  return { server, baseUrl, tempDir };
}

async function closeServer(server, tempDir) {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function requestJson(baseUrl, method, pathname, body, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get('set-cookie'),
  };
}

async function signupAndGetCookie(baseUrl, username, password) {
  const response = await requestJson(baseUrl, 'POST', '/auth/signup', { username, password });
  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.ok(response.cookie);
  return response;
}

test('GET /problems returns seeded problems', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'GET', '/problems');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.ok(Array.isArray(response.body.problems));
    assert.ok(response.body.problems.length >= 2);
  } finally {
    await closeServer(server, tempDir);
  }
});

test('signup makes the first user admin and /me reflects the session', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const signup = await signupAndGetCookie(baseUrl, 'admin_one', 'secret123');
    assert.equal(signup.body.user.role, 'admin');

    const me = await requestJson(baseUrl, 'GET', '/me', undefined, { cookie: signup.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'admin_one');
    assert.equal(me.body.user.role, 'admin');
  } finally {
    await closeServer(server, tempDir);
  }
});

test('POST /judge requires login', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 1001,
      language: 'cpp',
      sourceCode: '#include <iostream>\nint main(){return 0;}\n',
    });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { ok: false, error: 'login is required' });
  } finally {
    await closeServer(server, tempDir);
  }
});

test('logged-in user can judge correct C++ and Swift submissions', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const signup = await signupAndGetCookie(baseUrl, 'solver_one', 'secret123');

    const cppResponse = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 1001,
      language: 'cpp',
      sourceCode: '#include <iostream>\nusing namespace std;\nint main(){ long long a,b; cin>>a>>b; cout << a+b << "\\n"; }\n',
    }, { cookie: signup.cookie });
    assert.equal(cppResponse.status, 200);
    assert.equal(cppResponse.body.verdict, 'AC');
    assert.equal(cppResponse.body.language, 'cpp');

    const swiftResponse = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 2309,
      language: 'swift',
      sourceCode: 'import Foundation\nvar heights: [Int] = []\nfor _ in 0..<9 { heights.append(Int(readLine()!)!) }\nlet total = heights.reduce(0, +)\nvar answer: [Int] = []\nout: for i in 0..<9 {\n  for j in (i + 1)..<9 {\n    if total - heights[i] - heights[j] == 100 {\n      answer = heights.enumerated().filter { $0.offset != i && $0.offset != j }.map { $0.element }.sorted()\n      break out\n    }\n  }\n}\nfor value in answer { print(value) }\n',
    }, { cookie: signup.cookie });
    assert.equal(swiftResponse.status, 200);
    assert.equal(swiftResponse.body.verdict, 'AC');
    assert.equal(swiftResponse.body.language, 'swift');
  } finally {
    await closeServer(server, tempDir);
  }
});

test('saved source can be loaded and reset per user/problem/language', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const signup = await signupAndGetCookie(baseUrl, 'persist_user', 'secret123');

    const save = await requestJson(
      baseUrl,
      'PUT',
      '/problems/1001/code?language=swift',
      { sourceCode: 'print("saved")\n' },
      { cookie: signup.cookie }
    );
    assert.equal(save.status, 200);
    assert.equal(save.body.ok, true);

    const load = await requestJson(baseUrl, 'GET', '/problems/1001/code?language=swift', undefined, { cookie: signup.cookie });
    assert.equal(load.status, 200);
    assert.equal(load.body.sourceCode, 'print("saved")\n');

    const reset = await requestJson(baseUrl, 'DELETE', '/problems/1001/code?language=swift', undefined, { cookie: signup.cookie });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.reset, true);
    assert.ok(typeof reset.body.starterCode === 'string');

    const afterReset = await requestJson(baseUrl, 'GET', '/problems/1001/code?language=swift', undefined, { cookie: signup.cookie });
    assert.equal(afterReset.body.sourceCode, null);
  } finally {
    await closeServer(server, tempDir);
  }
});

test('admin can list users and update roles while non-admin cannot access admin endpoints', async () => {
  const { server, baseUrl, tempDir } = await startServer();
  try {
    const adminSignup = await signupAndGetCookie(baseUrl, 'admin_seed', 'secret123');
    const userSignup = await signupAndGetCookie(baseUrl, 'normal_user', 'secret123');
    assert.equal(userSignup.body.user.role, 'user');

    const forbidden = await requestJson(baseUrl, 'GET', '/admin/users', undefined, { cookie: userSignup.cookie });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(forbidden.body, { ok: false, error: 'admin access required' });

    const listResponse = await requestJson(baseUrl, 'GET', '/admin/users', undefined, { cookie: adminSignup.cookie });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.users.length, 2);

    const targetUser = listResponse.body.users.find((user) => user.username === 'normal_user');
    assert.ok(targetUser);

    const promoteResponse = await requestJson(
      baseUrl,
      'PATCH',
      `/admin/users/${targetUser.id}`,
      { role: 'admin' },
      { cookie: adminSignup.cookie }
    );
    assert.equal(promoteResponse.status, 200);
    assert.equal(promoteResponse.body.user.role, 'admin');
  } finally {
    await closeServer(server, tempDir);
  }
});
