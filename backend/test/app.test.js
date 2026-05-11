'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');

async function startServer() {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  return { server, baseUrl };
}

async function requestJson(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test('GET /problems returns seeded problems', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'GET', '/problems');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.ok(Array.isArray(response.body.problems));
    assert.ok(response.body.problems.length >= 2);
  } finally {
    server.close();
  }
});

test('POST /judge accepts correct C++ submission', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 1001,
      language: 'cpp',
      sourceCode: '#include <iostream>\nusing namespace std;\nint main(){ long long a,b; cin>>a>>b; cout << a+b << "\\n"; }\n',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.verdict, 'AC');
    assert.equal(response.body.language, 'cpp');
  } finally {
    server.close();
  }
});

test('POST /judge accepts correct Swift submission', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 1002,
      language: 'swift',
      sourceCode: 'import Foundation\nlet line = readLine() ?? ""\nprint(line)\nprint(line)\n',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.verdict, 'AC');
    assert.equal(response.body.language, 'swift');
  } finally {
    server.close();
  }
});

test('POST /judge rejects unsupported languages', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 1001,
      language: 'python',
      sourceCode: 'print("hello")',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { ok: false, error: 'supported languages are cpp and swift' });
  } finally {
    server.close();
  }
});

test('POST /judge accepts correct seven dwarfs Swift submission', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await requestJson(baseUrl, 'POST', '/judge', {
      problemId: 2309,
      language: 'swift',
      sourceCode: 'import Foundation\nvar heights: [Int] = []\nfor _ in 0..<9 { heights.append(Int(readLine()!)!) }\nlet total = heights.reduce(0, +)\nvar answer: [Int] = []\nout: for i in 0..<9 {\n  for j in (i + 1)..<9 {\n    if total - heights[i] - heights[j] == 100 {\n      answer = heights.enumerated().filter { $0.offset != i && $0.offset != j }.map { $0.element }.sorted()\n      break out\n    }\n  }\n}\nfor value in answer { print(value) }\n',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.verdict, 'AC');
    assert.equal(response.body.language, 'swift');
  } finally {
    server.close();
  }
});
