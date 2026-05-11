const state = {
  apiBaseUrl: getStoredApiBaseUrl(),
  currentProblem: null,
  activeLanguage: 'swift',
};

const elements = {
  breadcrumbLabel: document.querySelector('#breadcrumbLabel'),
  languageSelect: document.querySelector('#languageSelect'),
  problemTitle: document.querySelector('#problemTitle'),
  problemDescription: document.querySelector('#problemDescription'),
  statementBody: document.querySelector('#statementBody'),
  problemTime: document.querySelector('#problemTime'),
  problemMemory: document.querySelector('#problemMemory'),
  caseCount: document.querySelector('#caseCount'),
  casesList: document.querySelector('#casesList'),
  sourceCode: document.querySelector('#sourceCode'),
  runButton: document.querySelector('#runButton'),
  statusBadge: document.querySelector('#statusBadge'),
  summary: document.querySelector('#summary'),
  compileLog: document.querySelector('#compileLog'),
  resultsList: document.querySelector('#resultsList'),
};

function getProblemIdFromUrl() {
  const problemId = Number(new URL(window.location.href).searchParams.get('id'));
  return Number.isInteger(problemId) && problemId > 0 ? problemId : null;
}

function setStatus(label, className) {
  elements.statusBadge.textContent = label;
  elements.statusBadge.className = `status-badge ${className}`;
}

function preserveCurrentSource() {
  if (!state.currentProblem) return;
  setStoredSource(state.currentProblem.id, state.activeLanguage, elements.sourceCode.value);
}

function resolveSource(problem, language) {
  return getStoredSource(problem.id, language) || problem.starterCodes[language] || '';
}

function clearJudgeResult(message = '채점 대기 중입니다.') {
  setStatus('READY', 'idle');
  elements.summary.innerHTML = `<p>${escapeHtml(message)}</p>`;
  elements.compileLog.classList.add('hidden');
  elements.compileLog.innerHTML = '';
  elements.resultsList.innerHTML = '';
}

function triggerJudge() {
  submitJudge().catch((error) => clearJudgeResult(error.message));
}

function renderProblem(problem) {
  state.currentProblem = problem;
  state.activeLanguage = elements.languageSelect.value;
  document.title = `${problem.id}. ${problem.title} - 코드라운지`;
  elements.breadcrumbLabel.textContent = `${problem.id}. ${problem.title}`;
  elements.problemTitle.textContent = `${problem.id}. ${problem.title}`;
  elements.problemDescription.textContent = problem.description;
  elements.statementBody.textContent = problem.description;
  elements.problemTime.textContent = `시간 제한 ${problem.timeLimit}`;
  elements.problemMemory.textContent = `메모리 제한 ${problem.memoryLimit}`;
  elements.caseCount.textContent = `총 ${problem.testCases.length}개 케이스`;
  elements.casesList.innerHTML = problem.testCases.map((testCase) => `
    <article class="case-item">
      <strong>예제 ${testCase.index}</strong>
      <div class="case-label">Input</div>
      <pre>${escapeHtml(testCase.input)}</pre>
      <div class="case-label">Output</div>
      <pre>${escapeHtml(testCase.output)}</pre>
    </article>
  `).join('');
  elements.sourceCode.value = resolveSource(problem, state.activeLanguage);
  clearJudgeResult();
}

function renderResult(data) {
  setStatus(data.verdict, data.verdict.toLowerCase());
  const summaryClass = data.verdict === 'AC' ? 'summary-card verdict-ac' : 'summary-card verdict-fail';
  elements.summary.innerHTML = `
    <div class="${summaryClass}">
      <strong>${escapeHtml(data.problem.title)}</strong>
      <p>언어: ${escapeHtml(data.language.toUpperCase())} / 통과: ${data.summary.passed} / ${data.summary.total}</p>
      <p>총 실행 시간: ${data.summary.totalCaseTimeMs}ms / 최장 케이스: ${data.summary.maxCaseTimeMs}ms</p>
      <p>시간 제한: ${data.summary.timeLimitMs}ms / 메모리 제한: ${data.summary.memoryLimitMb}MB</p>
    </div>
  `;

  if (data.verdict === 'CE') {
    elements.compileLog.classList.remove('hidden');
    elements.compileLog.innerHTML = `
      <strong>컴파일 로그</strong>
      <pre>${escapeHtml(data.compile.stderr || data.compile.stdout || 'No compiler output')}</pre>
    `;
  } else {
    elements.compileLog.classList.add('hidden');
    elements.compileLog.innerHTML = '';
  }

  elements.resultsList.innerHTML = data.cases.map((testCase) => `
    <article class="result-item ${testCase.status === 'AC' ? 'result-pass' : 'result-fail'}">
      <strong>Case ${testCase.index} · ${escapeHtml(testCase.status)}</strong>
      <div class="result-label">Time</div>
      <pre>${escapeHtml(`${testCase.durationMs}ms`)}</pre>
      <div class="result-label">Expected</div>
      <pre>${escapeHtml(testCase.expected)}</pre>
      <div class="result-label">Actual</div>
      <pre>${escapeHtml(testCase.actual)}</pre>
      ${testCase.stderr ? `<div class="result-label">stderr</div><pre>${escapeHtml(testCase.stderr)}</pre>` : ''}
    </article>
  `).join('');
}

async function loadProblem() {
  const problemId = getProblemIdFromUrl();
  if (!problemId) {
    window.location.href = './index.html';
    return;
  }
  const response = await fetchJson(state.apiBaseUrl, `/problems/${problemId}`);
  renderProblem(response.problem);
}

async function submitJudge() {
  if (!state.currentProblem) return;
  preserveCurrentSource();

  setStatus('RUNNING', 'idle');
  elements.summary.innerHTML = '<p>코드를 컴파일하고 채점하고 있습니다...</p>';
  elements.compileLog.classList.add('hidden');
  elements.resultsList.innerHTML = '';

  const response = await fetch(`${state.apiBaseUrl}/judge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      problemId: state.currentProblem.id,
      language: elements.languageSelect.value,
      sourceCode: elements.sourceCode.value,
    }),
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || 'Judge request failed');
  }
  renderResult(body);
}

elements.languageSelect.addEventListener('change', () => {
  preserveCurrentSource();
  if (!state.currentProblem) return;
  state.activeLanguage = elements.languageSelect.value;
  elements.sourceCode.value = resolveSource(state.currentProblem, state.activeLanguage);
});

elements.sourceCode.addEventListener('input', () => {
  preserveCurrentSource();
});

elements.sourceCode.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    triggerJudge();
  }
});

elements.runButton.addEventListener('click', () => {
  triggerJudge();
});

loadProblem().catch((error) => clearJudgeResult(error.message));
