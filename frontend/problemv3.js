import {EditorState, Compartment, Prec} from "https://esm.sh/@codemirror/state";
import {EditorView, keymap} from "https://esm.sh/@codemirror/view";
import {basicSetup} from "https://esm.sh/codemirror";
import {cpp} from "https://esm.sh/@codemirror/lang-cpp";
import {StreamLanguage, HighlightStyle, syntaxHighlighting} from "https://esm.sh/@codemirror/language";
import {swift} from "https://esm.sh/@codemirror/legacy-modes/mode/swift";
import {tags} from "https://esm.sh/@lezer/highlight";

const state = {
  apiBaseUrl: window.getStoredApiBaseUrl(),
  currentProblem: null,
  activeLanguage: 'swift',
  editor: null,
  highlightEnabled: true,
  darkThemeEnabled: false,
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
  runButton: document.querySelector('#runButton'),
  statusBadge: document.querySelector('#statusBadge'),
  summary: document.querySelector('#summary'),
  compileLog: document.querySelector('#compileLog'),
  resultsList: document.querySelector('#resultsList'),
  editorMount: document.querySelector('#codeEditor'),
  plainModeButton: document.querySelector('#plainModeButton'),
  highlightModeButton: document.querySelector('#highlightModeButton'),
  lightThemeButton: document.querySelector('#lightThemeButton'),
  darkThemeButton: document.querySelector('#darkThemeButton'),
};

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const highlightCompartment = new Compartment();

const xcodeDarkTheme = EditorView.theme({
  "&": {
    color: "#d9e3f0",
    backgroundColor: "#1f2630",
  },
  ".cm-content": {
    caretColor: "#ff9f43",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#ff9f43",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "#2f5d8a",
  },
  ".cm-activeLine": {
    backgroundColor: "#252f3a",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#252f3a",
  },
  ".cm-gutters": {
    backgroundColor: "#1a2028",
    color: "#738295",
    borderRight: "1px solid #2c3744",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 6px",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "#253140",
    border: "1px solid #344356",
    color: "#9db0c5",
  },
}, {dark: true});

const xcodeDarkHighlightStyle = HighlightStyle.define([
  {tag: tags.keyword, color: "#ff7ab2"},
  {tag: [tags.definitionKeyword, tags.modifier, tags.controlKeyword], color: "#ff7ab2"},
  {tag: [tags.typeName, tags.className, tags.namespace], color: "#5dd8ff"},
  {tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: "#d0a8ff"},
  {tag: [tags.string, tags.special(tags.string)], color: "#ff9f43"},
  {tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6c7986", fontStyle: "italic"},
  {tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#d9e3f0"},
  {tag: [tags.variableName, tags.propertyName], color: "#d9e3f0"},
  {tag: tags.special(tags.variableName), color: "#ffcc66"},
  {tag: [tags.operator, tags.punctuation, tags.separator], color: "#c8d3df"},
  {tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace], color: "#c8d3df"},
  {tag: [tags.attributeName, tags.labelName], color: "#ffd866"},
]);

function getProblemIdFromUrl() {
  const problemId = Number(new URL(window.location.href).searchParams.get('id'));
  return Number.isInteger(problemId) && problemId > 0 ? problemId : null;
}

function setStatus(label, className) {
  elements.statusBadge.textContent = label;
  elements.statusBadge.className = `status-badge ${className}`;
}

function getEditorValue() {
  return state.editor ? state.editor.state.doc.toString() : '';
}

function preserveCurrentSource() {
  if (!state.currentProblem) return;
  window.setStoredSource(state.currentProblem.id, state.activeLanguage, getEditorValue());
}

function resolveSource(problem, language) {
  return window.getStoredSource(problem.id, language) || problem.starterCodes[language] || '';
}

function clearJudgeResult(message = '채점 대기 중입니다.') {
  setStatus('READY', 'idle');
  elements.summary.innerHTML = `<p>${window.escapeHtml(message)}</p>`;
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
          <pre>${window.escapeHtml(testCase.input)}</pre>
        </section>
        <section>
          <span class="v2-label">출력</span>
          <pre>${window.escapeHtml(testCase.output)}</pre>
        </section>
      </div>
    </article>
  `).join('');
}

function getLanguageExtension(language) {
  if (!state.highlightEnabled) return [];
  if (language === 'cpp') return cpp();
  return StreamLanguage.define(swift);
}

function getThemeExtension() {
  return state.darkThemeEnabled ? xcodeDarkTheme : [];
}

function getHighlightExtension() {
  if (!state.highlightEnabled || !state.darkThemeEnabled) return [];
  return syntaxHighlighting(xcodeDarkHighlightStyle);
}

function syncToggleButtons() {
  elements.plainModeButton.classList.toggle('is-active', !state.highlightEnabled);
  elements.highlightModeButton.classList.toggle('is-active', state.highlightEnabled);
  elements.lightThemeButton.classList.toggle('is-active', !state.darkThemeEnabled);
  elements.darkThemeButton.classList.toggle('is-active', state.darkThemeEnabled);
  elements.editorMount.classList.toggle('is-dark', state.darkThemeEnabled);
}

function configureEditor() {
  if (!state.editor) return;
  state.editor.dispatch({
    effects: [
      languageCompartment.reconfigure(getLanguageExtension(state.activeLanguage)),
      themeCompartment.reconfigure(getThemeExtension()),
      highlightCompartment.reconfigure(getHighlightExtension()),
    ],
  });
  syncToggleButtons();
}

function createEditor(initialDoc) {
  const editorState = EditorState.create({
    doc: initialDoc,
    extensions: [
      basicSetup,
      EditorView.lineWrapping,
      languageCompartment.of(getLanguageExtension(state.activeLanguage)),
      themeCompartment.of(getThemeExtension()),
      highlightCompartment.of(getHighlightExtension()),
      Prec.highest(keymap.of([
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            triggerJudge();
            return true;
          },
        },
      ])),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          preserveCurrentSource();
        }
      }),
    ],
  });

  state.editor = new EditorView({
    state: editorState,
    parent: elements.editorMount,
  });

  state.editor.dom.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      triggerJudge();
    }
  }, true);

  syncToggleButtons();
}

function setEditorContent(value) {
  if (!state.editor) {
    createEditor(value);
    return;
  }
  state.editor.dispatch({
    changes: {
      from: 0,
      to: state.editor.state.doc.length,
      insert: value,
    },
  });
  configureEditor();
}

function renderProblem(problem) {
  state.currentProblem = problem;
  state.activeLanguage = elements.languageSelect.value;
  document.title = `${problem.id}. ${problem.title} - 코드라운지 V3`;
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
  setEditorContent(resolveSource(problem, state.activeLanguage));
  clearJudgeResult();
}

function renderResult(data) {
  setStatus(data.verdict, data.verdict.toLowerCase());
  const summaryClass = data.verdict === 'AC' ? 'summary-card verdict-ac' : 'summary-card verdict-fail';
  elements.summary.innerHTML = `
    <div class="${summaryClass}">
      <strong>${window.escapeHtml(data.problem.title)}</strong>
      <p>언어: ${window.escapeHtml(data.language.toUpperCase())} / 통과: ${data.summary.passed} / ${data.summary.total}</p>
      <p>총 실행 시간: ${data.summary.totalCaseTimeMs}ms / 최장 케이스: ${data.summary.maxCaseTimeMs}ms</p>
      <p>시간 제한: ${data.summary.timeLimitMs}ms / 메모리 제한: ${data.summary.memoryLimitMb}MB</p>
    </div>
  `;

  if (data.verdict === 'CE') {
    elements.compileLog.classList.remove('hidden');
    elements.compileLog.innerHTML = `
      <strong>컴파일 로그</strong>
      <pre>${window.escapeHtml(data.compile.stderr || data.compile.stdout || 'No compiler output')}</pre>
    `;
  } else {
    elements.compileLog.classList.add('hidden');
    elements.compileLog.innerHTML = '';
  }

  elements.resultsList.innerHTML = data.cases.map((testCase) => `
    <article class="result-item ${testCase.status === 'AC' ? 'result-pass' : 'result-fail'}">
      <div class="v2-case-head v2-result-head">
        <strong>Case ${testCase.index} · ${window.escapeHtml(testCase.status)}</strong>
        <span class="v2-result-time">${window.escapeHtml(`${testCase.durationMs}ms`)}</span>
      </div>
      <div class="v2-result-columns ${testCase.stderr ? 'has-stderr' : ''}">
        <section>
          <span class="v2-label">Expected</span>
          <pre>${window.escapeHtml(testCase.expected)}</pre>
        </section>
        <section>
          <span class="v2-label">Actual</span>
          <pre>${window.escapeHtml(testCase.actual)}</pre>
        </section>
        ${testCase.stderr ? `
          <section>
            <span class="v2-label">stderr</span>
            <pre>${window.escapeHtml(testCase.stderr)}</pre>
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
  const response = await window.fetchJson(state.apiBaseUrl, `/problems/${problemId}`);
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
      sourceCode: getEditorValue(),
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
  setEditorContent(resolveSource(state.currentProblem, state.activeLanguage));
});

elements.plainModeButton.addEventListener('click', () => {
  state.highlightEnabled = false;
  configureEditor();
});

elements.highlightModeButton.addEventListener('click', () => {
  state.highlightEnabled = true;
  configureEditor();
});

elements.lightThemeButton.addEventListener('click', () => {
  state.darkThemeEnabled = false;
  configureEditor();
});

elements.darkThemeButton.addEventListener('click', () => {
  state.darkThemeEnabled = true;
  configureEditor();
});

elements.runButton.addEventListener('click', () => {
  triggerJudge();
});

loadProblem().catch((error) => clearJudgeResult(error.message));
