'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROBLEMS_DIR = path.join(__dirname, '..', 'problems');
const PROBLEM_MANIFEST = 'problem.json';

function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function optionalString(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string when provided`);
  }
  return value;
}

function validateProblem(raw, fileName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${fileName}: problem must be an object`);
  }
  if (!Number.isInteger(raw.id) || raw.id <= 0) {
    throw new Error(`${fileName}: id must be a positive integer`);
  }
  assertString(raw.slug, `${fileName}: slug`);
  assertString(raw.title, `${fileName}: title`);
  assertString(raw.description, `${fileName}: description`);
  assertString(raw.timeLimit, `${fileName}: timeLimit`);
  assertString(raw.memoryLimit, `${fileName}: memoryLimit`);
  assertString(raw.starterCodes?.cpp, `${fileName}: starterCodes.cpp`);
  assertString(raw.starterCodes?.swift, `${fileName}: starterCodes.swift`);

  if (!Array.isArray(raw.testCases) || raw.testCases.length === 0) {
    throw new Error(`${fileName}: testCases must be a non-empty array`);
  }

  const testCases = raw.testCases.map((testCase, index) => {
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      throw new Error(`${fileName}: testCases[${index}] must be an object`);
    }
    assertString(testCase.input, `${fileName}: testCases[${index}].input`);
    assertString(testCase.output, `${fileName}: testCases[${index}].output`);
    return {
      input: testCase.input,
      output: testCase.output,
    };
  });

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    description: raw.description,
    imageUrl: optionalString(raw.imageUrl, `${fileName}: imageUrl`),
    timeLimit: raw.timeLimit,
    memoryLimit: raw.memoryLimit,
    starterCodes: raw.starterCodes,
    testCases,
  };
}

function readProblem(filePath) {
  const fileName = path.basename(filePath);
  const rawText = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`${fileName}: invalid JSON: ${error.message}`);
  }
  return validateProblem(parsed, fileName);
}

function problemManifestPaths(problemsDir = PROBLEMS_DIR) {
  return fs.readdirSync(problemsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(problemsDir, entry.name, PROBLEM_MANIFEST))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((left, right) => left.localeCompare(right));
}

function loadProblems(problemsDir = PROBLEMS_DIR) {
  const manifests = problemManifestPaths(problemsDir);
  const problems = manifests.map((manifestPath) => readProblem(manifestPath));
  return problems.sort((left, right) => left.id - right.id);
}

function listProblems(problemsDir = PROBLEMS_DIR) {
  return loadProblems(problemsDir).map((problem) => ({
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
  }));
}

function getProblemById(problemId, problemsDir = PROBLEMS_DIR) {
  const problems = loadProblems(problemsDir);
  return problems.find((problem) => problem.id === problemId) || null;
}

module.exports = {
  PROBLEMS_DIR,
  loadProblems,
  listProblems,
  getProblemById,
};
