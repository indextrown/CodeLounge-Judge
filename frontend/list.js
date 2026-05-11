const state = {
  apiBaseUrl: getStoredApiBaseUrl(),
  problems: [],
};

const elements = {
  problemCount: document.querySelector('#problemCount'),
  problemTableBody: document.querySelector('#problemTableBody'),
};

function renderProblemList() {
  elements.problemCount.textContent = String(state.problems.length);
  elements.problemTableBody.innerHTML = state.problems.map((problem) => `
    <tr data-problem-id="${problem.id}">
      <td class="problem-index">${problem.id}</td>
      <td><a class="problem-link" href="./problemv3.html?id=${problem.id}">${escapeHtml(problem.title)}</a></td>
      <td class="problem-desc-cell">${escapeHtml(problem.description)}</td>
      <td>${escapeHtml(problem.timeLimit)}</td>
      <td>${escapeHtml(problem.memoryLimit)}</td>
    </tr>
  `).join('');
}

async function loadProblems() {
  const response = await fetchJson(state.apiBaseUrl, '/problems');
  state.problems = response.problems;
  renderProblemList();
}

elements.problemTableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-problem-id]');
  if (!row) return;
  const problemId = row.getAttribute('data-problem-id');
  if (!problemId) return;
  window.location.href = `./problemv3.html?id=${problemId}`;
});

loadProblems().catch((error) => {
  elements.problemTableBody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
});
