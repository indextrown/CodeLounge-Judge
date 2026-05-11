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
  statementVisualCard: document.querySelector('#statementVisualCard'),
  inputGuide: document.querySelector('#inputGuide'),
  outputGuide: document.querySelector('#outputGuide'),
  problemImage: document.querySelector('#problemImage'),
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

function renderCases(problem) {
  elements.casesList.innerHTML = problem.testCases.map((testCase) => `
    <article class="v2-case-card">
      <div class="v2-case-head">
        <strong>예제 ${testCase.index}</strong>
      </div>
      <div class="v2-case-columns">
        <section>
          <span class="v2-label">입력</span>
          <pre>${escapeHtml(testCase.input)}</pre>
        </section>
        <section>
          <span class="v2-label">출력</span>
          <pre>${escapeHtml(testCase.output)}</pre>
        </section>
      </div>
    </article>
  `).join('');
}

function renderProblem(problem) {
  state.currentProblem = problem;
  state.activeLanguage = elements.languageSelect.value;
  document.title = `${problem.id}. ${problem.title} - 코드라운지 V2`;
  elements.breadcrumbLabel.textContent = `${problem.id}. ${problem.title}`;
  elements.problemTitle.textContent = problem.title;
  elements.problemDescription.textContent = `${problem.id} · ${problem.slug} · 언어 C++ / Swift`;
  elements.statementBody.textContent = problem.description;
  elements.problemTime.textContent = `시간 제한 ${problem.timeLimit}`;
  elements.problemMemory.textContent = `메모리 제한 ${problem.memoryLimit}`;
  elements.caseCount.textContent = `예제 ${problem.testCases.length}개`;
  elements.inputGuide.textContent = `${problem.testCases.length}개의 테스트케이스 입력이 준비되어 있습니다. 입력 형식은 예제 카드에서 바로 확인할 수 있습니다.`;
  elements.outputGuide.textContent = `각 테스트케이스의 기대 출력이 함께 제공됩니다. 제출 결과는 이 출력과 비교해 채점됩니다.`;
  if (problem.imageUrl) {
    elements.statementVisualCard.classList.remove('hidden');
    elements.statementVisualCard.classList.add('has-image');
    elements.problemImage.src = problem.imageUrl;
    elements.problemImage.classList.remove('hidden');
  } else {
    elements.statementVisualCard.classList.add('hidden');
    elements.statementVisualCard.classList.remove('has-image');
    elements.problemImage.removeAttribute('src');
    elements.problemImage.classList.add('hidden');
  }
  renderCases(problem);
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
      <div class="v2-case-head v2-result-head">
        <strong>Case ${testCase.index} · ${escapeHtml(testCase.status)}</strong>
        <span class="v2-result-time">${escapeHtml(`${testCase.durationMs}ms`)}</span>
      </div>
      <div class="v2-result-columns ${testCase.stderr ? 'has-stderr' : ''}">
        <section>
          <span class="v2-label">Expected</span>
          <pre>${escapeHtml(testCase.expected)}</pre>
        </section>
        <section>
          <span class="v2-label">Actual</span>
          <pre>${escapeHtml(testCase.actual)}</pre>
        </section>
        ${testCase.stderr ? `
          <section>
            <span class="v2-label">stderr</span>
            <pre>${escapeHtml(testCase.stderr)}</pre>
          </section>
        ` : ''}
      </div>
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
