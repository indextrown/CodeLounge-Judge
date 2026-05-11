'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess, DEFAULT_MAX_OUTPUT_BYTES } = require('./processRunner');

const DEFAULT_COMPILE_TIMEOUT_MS = 15_000;

const LANGUAGE_CONFIG = {
  cpp: {
    aliases: ['cpp', 'c++', 'cxx', 'cplusplus', 'gnu++17', 'gnu++20'],
    sourceFile: 'main.cpp',
    binaryFile: 'main',
    compiler: 'g++',
    compileArgs: (sourcePath, binaryPath) => ['-std=c++17', '-O2', '-pipe', sourcePath, '-o', binaryPath],
    runCommand: (binaryPath) => ({ command: binaryPath, args: [] }),
  },
  swift: {
    aliases: ['swift', 'swift5', 'swift6'],
    sourceFile: 'main.swift',
    binaryFile: 'main',
    compiler: 'swiftc',
    compileArgs: (sourcePath, binaryPath) => ['-O', sourcePath, '-o', binaryPath],
    runCommand: (binaryPath) => ({ command: binaryPath, args: [] }),
  },
};

function normalizeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  for (const [language, config] of Object.entries(LANGUAGE_CONFIG)) {
    if (config.aliases.includes(normalized)) return language;
  }
  return null;
}

function parseTimeLimitMs(value, fallbackMs = 1_000) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value !== 'string') return fallbackMs;

  const match = value.trim().toLowerCase().match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;
  return value.toLowerCase().includes('ms') ? Math.max(1, Math.round(amount)) : Math.max(1, Math.round(amount * 1000));
}

function parseMemoryLimitMb(value, fallbackMb = 256) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value !== 'string') return fallbackMb;

  const match = value.trim().toLowerCase().match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return fallbackMb;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMb;
  if (value.toLowerCase().includes('gb')) return Math.max(1, Math.round(amount * 1024));
  if (value.toLowerCase().includes('kb')) return Math.max(1, Math.round(amount / 1024));
  return Math.max(1, Math.round(amount));
}

function normalizeOutput(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\s\n]+$/g, '');
}

function buildCompileSummary(result, commandText) {
  return {
    ok: result.exitCode === 0 && !result.timedOut && !result.error,
    command: commandText,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    error: result.error,
  };
}

function buildCaseResult(testCase, index, run) {
  let status = 'AC';
  if (run.timedOut) {
    status = 'TLE';
  } else if (run.error || run.exitCode !== 0) {
    status = 'RE';
  } else if (normalizeOutput(run.stdout) !== normalizeOutput(testCase.output)) {
    status = 'WA';
  }

  return {
    index: index + 1,
    status,
    input: testCase.input,
    expected: testCase.output,
    actual: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
  };
}

function finalVerdict(cases) {
  if (cases.some((testCase) => testCase.status === 'TLE')) return 'TLE';
  if (cases.some((testCase) => testCase.status === 'RE')) return 'RE';
  if (cases.some((testCase) => testCase.status === 'WA')) return 'WA';
  return 'AC';
}

async function judgeSubmission({ language, sourceCode, problem }) {
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage) {
    throw new Error('unsupported language');
  }
  const config = LANGUAGE_CONFIG[normalizedLanguage];
  const timeLimitMs = parseTimeLimitMs(problem.timeLimit);
  const memoryLimitMb = parseMemoryLimitMb(problem.memoryLimit);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `judge-${normalizedLanguage}-`));
  const sourcePath = path.join(workDir, config.sourceFile);
  const binaryPath = path.join(workDir, config.binaryFile);
  const compileArgs = config.compileArgs(sourcePath, binaryPath);
  const compileCommand = [config.compiler, ...compileArgs].join(' ');

  let compile;
  let cases = [];
  let verdict = 'AC';

  try {
    await fs.writeFile(sourcePath, sourceCode, 'utf8');

    compile = buildCompileSummary(
      await runProcess(config.compiler, compileArgs, {
        cwd: workDir,
        timeoutMs: DEFAULT_COMPILE_TIMEOUT_MS,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
      }),
      compileCommand,
    );

    if (!compile.ok) {
      verdict = 'CE';
    } else {
      const command = config.runCommand(binaryPath);
      for (let index = 0; index < problem.testCases.length; index += 1) {
        const testCase = problem.testCases[index];
        const run = await runProcess(command.command, command.args, {
          cwd: workDir,
          input: testCase.input,
          timeoutMs: timeLimitMs,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        });
        cases.push(buildCaseResult(testCase, index, run));
      }
      verdict = finalVerdict(cases);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  return {
    verdict,
    language: normalizedLanguage,
    compile,
    summary: {
      passed: cases.filter((testCase) => testCase.status === 'AC').length,
      total: problem.testCases.length,
      totalCaseTimeMs: cases.reduce((sum, testCase) => sum + (testCase.durationMs || 0), 0),
      maxCaseTimeMs: cases.reduce((max, testCase) => Math.max(max, testCase.durationMs || 0), 0),
      timeLimitMs,
      memoryLimitMb,
    },
    cases,
  };
}

module.exports = {
  LANGUAGE_CONFIG,
  normalizeLanguage,
  judgeSubmission,
};
