const state = {
  apiBaseUrl: window.getStoredApiBaseUrl(),
  currentUser: window.getStoredAuthUser(),
  users: [],
  searchQuery: '',
};

const elements = {
  adminTopbarAuth: document.querySelector('#adminTopbarAuth'),
  userCount: document.querySelector('#userCount'),
  userTableBody: document.querySelector('#userTableBody'),
  userSearchInput: document.querySelector('#userSearchInput'),
  adminMessagePanel: document.querySelector('#adminMessagePanel'),
  adminMessageText: document.querySelector('#adminMessageText'),
};

function setMessage(message, tone = 'info') {
  elements.adminMessagePanel.classList.remove('hidden');
  elements.adminMessagePanel.classList.toggle('auth-message-success', tone === 'success');
  elements.adminMessagePanel.classList.toggle('auth-message-error', tone === 'error');
  elements.adminMessageText.textContent = message;
}

function renderTopbar() {
  if (!state.currentUser) {
    elements.adminTopbarAuth.innerHTML = `
      <a class="secondary-button" href="./index.html">메인으로 돌아가기</a>
    `;
    return;
  }

  elements.adminTopbarAuth.innerHTML = `
    <div class="topbar-auth-row">
      <div class="user-chip">
        <strong>${window.escapeHtml(state.currentUser.username)}</strong>
        <small>${window.escapeHtml(state.currentUser.role)}</small>
      </div>
      <a class="secondary-button" href="./index.html">문제 목록</a>
      <button id="adminLogoutButton" class="secondary-button" type="button">로그아웃</button>
    </div>
  `;

  document.querySelector('#adminLogoutButton')?.addEventListener('click', async () => {
    await window.logout(state.apiBaseUrl);
    window.location.href = './index.html';
  });
}

function renderUsers() {
  const filteredUsers = state.users.filter((user) =>
    user.username.toLowerCase().includes(state.searchQuery.toLowerCase())
  );

  elements.userCount.textContent = String(filteredUsers.length);
  elements.userTableBody.innerHTML = filteredUsers.map((user) => `
    <tr data-user-id="${user.id}">
      <td>${user.id}</td>
      <td>${window.escapeHtml(user.username)}</td>
      <td>
        <select class="role-select" ${user.id === state.currentUser?.id ? 'data-self="true"' : ''}>
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
        </select>
      </td>
      <td>${window.escapeHtml(new Date(user.createdAt).toLocaleString('ko-KR'))}</td>
      <td>
        <div class="admin-actions">
          <span class="admin-role-pill">${window.escapeHtml(user.role)}</span>
          <button class="danger-button delete-user-button" type="button" ${user.id === state.currentUser?.id ? 'disabled' : ''}>삭제</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function ensureAdmin() {
  const user = await window.loadCurrentUser(state.apiBaseUrl);
  state.currentUser = user;
  renderTopbar();
  if (!user) {
    window.location.href = './index.html';
    throw new Error('login is required');
  }
  if (user.role !== 'admin') {
    window.location.href = './index.html';
    throw new Error('admin access required');
  }
}

async function loadUsers() {
  const response = await window.fetchJson(state.apiBaseUrl, '/admin/users');
  state.users = response.users;
  renderUsers();
}

elements.userSearchInput.addEventListener('input', (event) => {
  state.searchQuery = event.currentTarget.value.trim();
  renderUsers();
});

elements.userTableBody.addEventListener('change', async (event) => {
  const select = event.target.closest('.role-select');
  if (!select) return;
  const row = select.closest('tr[data-user-id]');
  const userId = row?.getAttribute('data-user-id');
  if (!userId) return;

  try {
    await window.fetchJson(state.apiBaseUrl, `/admin/users/${userId}`, {
      method: 'PATCH',
      body: { role: select.value },
    });
    setMessage('권한이 업데이트되었습니다.', 'success');
    await loadUsers();
  } catch (error) {
    setMessage(error.message, 'error');
    await loadUsers();
  }
});

elements.userTableBody.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('.delete-user-button');
  if (!deleteButton) return;
  const row = deleteButton.closest('tr[data-user-id]');
  const userId = row?.getAttribute('data-user-id');
  if (!userId) return;

  try {
    await window.fetchJson(state.apiBaseUrl, `/admin/users/${userId}`, { method: 'DELETE' });
    setMessage('계정이 삭제되었습니다.', 'success');
    await loadUsers();
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

ensureAdmin()
  .then(loadUsers)
  .catch((error) => {
    setMessage(error.message, 'error');
  });
