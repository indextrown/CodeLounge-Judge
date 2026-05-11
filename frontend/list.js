const state = {
  apiBaseUrl: window.getStoredApiBaseUrl(),
  problems: [],
  currentUser: window.getStoredAuthUser(),
  activeAuthTab: 'login',
};

const elements = {
  problemCount: document.querySelector('#problemCount'),
  problemTableBody: document.querySelector('#problemTableBody'),
  loginForm: document.querySelector('#loginForm'),
  signupForm: document.querySelector('#signupForm'),
  authMessagePanel: document.querySelector('#authMessagePanel'),
  authMessageText: document.querySelector('#authMessageText'),
  topbarAuth: document.querySelector('#topbarAuth'),
  authModal: document.querySelector('#authModal'),
  authModalTitle: document.querySelector('#authModalTitle'),
  closeAuthModalButton: document.querySelector('#closeAuthModalButton'),
  showLoginTabButton: document.querySelector('#showLoginTabButton'),
  showSignupTabButton: document.querySelector('#showSignupTabButton'),
};

function setAuthMessage(message, tone = 'info') {
  elements.authMessagePanel.classList.remove('hidden');
  elements.authMessagePanel.classList.toggle('auth-message-success', tone === 'success');
  elements.authMessagePanel.classList.toggle('auth-message-error', tone === 'error');
  elements.authMessageText.textContent = message;
}

function clearAuthMessage() {
  elements.authMessagePanel.classList.add('hidden');
  elements.authMessagePanel.classList.remove('auth-message-success', 'auth-message-error');
  elements.authMessageText.textContent = '';
}

function openAuthModal(tab = 'login') {
  state.activeAuthTab = tab;
  syncAuthModal();
  elements.authModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeAuthModal() {
  elements.authModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function syncAuthModal() {
  const isLogin = state.activeAuthTab === 'login';
  elements.authModalTitle.textContent = isLogin ? '로그인' : '회원가입';
  elements.loginForm.classList.toggle('hidden', !isLogin);
  elements.signupForm.classList.toggle('hidden', isLogin);
  elements.showLoginTabButton.classList.toggle('is-active', isLogin);
  elements.showSignupTabButton.classList.toggle('is-active', !isLogin);
}

function renderTopbarAuth() {
  if (!state.currentUser) {
    elements.topbarAuth.innerHTML = `
      <div class="topbar-auth-row">
        <button id="openLoginButton" class="secondary-button" type="button">로그인</button>
        <button id="openSignupButton" class="primary-button" type="button">회원가입</button>
      </div>
    `;

    document.querySelector('#openLoginButton')?.addEventListener('click', () => openAuthModal('login'));
    document.querySelector('#openSignupButton')?.addEventListener('click', () => openAuthModal('signup'));
    return;
  }

  elements.topbarAuth.innerHTML = `
    <div class="topbar-auth-row">
      <div class="user-chip">
        <strong>${window.escapeHtml(state.currentUser.username)}</strong>
        <small>${window.escapeHtml(state.currentUser.role)}</small>
      </div>
      ${state.currentUser.role === 'admin' ? '<a class="secondary-button" href="./admin.html">관리자 페이지</a>' : ''}
      <button id="logoutButton" class="secondary-button" type="button">로그아웃</button>
    </div>
  `;

  document.querySelector('#logoutButton')?.addEventListener('click', async () => {
    try {
      await window.logout(state.apiBaseUrl);
      state.currentUser = null;
      renderAuthState();
      setAuthMessage('로그아웃되었습니다.', 'success');
    } catch (error) {
      setAuthMessage(error.message, 'error');
    }
  });
}

function renderAuthState() {
  renderTopbarAuth();
  if (state.currentUser) {
    setAuthMessage(
      `${state.currentUser.username}님으로 로그인되어 있습니다. 상세 페이지에서 저장된 풀이 코드를 이어서 편집할 수 있습니다.`,
      'success'
    );
  } else {
    clearAuthMessage();
  }
}

function renderProblemList() {
  elements.problemCount.textContent = String(state.problems.length);
  elements.problemTableBody.innerHTML = state.problems.map((problem) => `
    <tr data-problem-id="${problem.id}">
      <td class="problem-index">${problem.id}</td>
      <td><a class="problem-link" href="./problemv3.html?id=${problem.id}">${window.escapeHtml(problem.title)}</a></td>
      <td class="problem-desc-cell">${window.escapeHtml(problem.description)}</td>
      <td>${window.escapeHtml(problem.timeLimit)}</td>
      <td>${window.escapeHtml(problem.memoryLimit)}</td>
    </tr>
  `).join('');
}

async function loadProblems() {
  const response = await window.fetchJson(state.apiBaseUrl, '/problems');
  state.problems = response.problems;
  renderProblemList();
}

async function refreshCurrentUser() {
  state.currentUser = await window.loadCurrentUser(state.apiBaseUrl);
  renderAuthState();
}

async function handleAuthFormSubmit(event, mode) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.elements.username.value;
  const password = form.elements.password.value;

  try {
    const response = mode === 'login'
      ? await window.login(state.apiBaseUrl, { username, password })
      : await window.signup(state.apiBaseUrl, { username, password });
    state.currentUser = response.user;
    renderAuthState();
    form.reset();
    closeAuthModal();
    setAuthMessage(
      mode === 'login'
        ? `${response.user.username}님, 다시 오신 것을 환영합니다.`
        : `${response.user.username}님 회원가입이 완료되었습니다.${response.isFirstAdmin ? ' 첫 가입자라 관리자 권한이 자동 부여되었습니다.' : ''}`,
      'success'
    );
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
}

elements.problemTableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-problem-id]');
  if (!row) return;
  const problemId = row.getAttribute('data-problem-id');
  if (!problemId) return;
  window.location.href = `./problemv3.html?id=${problemId}`;
});

elements.loginForm.addEventListener('submit', (event) => {
  handleAuthFormSubmit(event, 'login');
});

elements.signupForm.addEventListener('submit', (event) => {
  handleAuthFormSubmit(event, 'signup');
});

elements.showLoginTabButton.addEventListener('click', () => {
  state.activeAuthTab = 'login';
  syncAuthModal();
});

elements.showSignupTabButton.addEventListener('click', () => {
  state.activeAuthTab = 'signup';
  syncAuthModal();
});

elements.closeAuthModalButton.addEventListener('click', closeAuthModal);
elements.authModal.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeAuthModal === 'true') {
    closeAuthModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.authModal.classList.contains('hidden')) {
    closeAuthModal();
  }
});

syncAuthModal();

Promise.all([
  loadProblems(),
  refreshCurrentUser(),
]).catch((error) => {
  elements.problemTableBody.innerHTML = `<tr><td colspan="5">${window.escapeHtml(error.message)}</td></tr>`;
  setAuthMessage(error.message, 'error');
});
