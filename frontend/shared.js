const STORAGE_KEYS = {
  apiBaseUrl: 'codelounge:apiBaseUrl',
  authUser: 'codelounge:authUser',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getStoredApiBaseUrl(fallback = 'http://127.0.0.1:12024') {
  return localStorage.getItem(STORAGE_KEYS.apiBaseUrl) || fallback;
}

function setStoredApiBaseUrl(value) {
  localStorage.setItem(STORAGE_KEYS.apiBaseUrl, value);
}

function getStoredAuthUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.authUser);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEYS.authUser);
    return null;
  }
}

function setStoredAuthUser(user) {
  if (!user) {
    localStorage.removeItem(STORAGE_KEYS.authUser);
    return;
  }
  localStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
}

async function fetchJson(apiBaseUrl, path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

async function loadCurrentUser(apiBaseUrl = getStoredApiBaseUrl()) {
  const response = await fetchJson(apiBaseUrl, '/me');
  setStoredAuthUser(response.user);
  return response.user;
}

async function signup(apiBaseUrl, credentials) {
  const response = await fetchJson(apiBaseUrl, '/auth/signup', {
    method: 'POST',
    body: credentials,
  });
  setStoredAuthUser(response.user);
  return response;
}

async function login(apiBaseUrl, credentials) {
  const response = await fetchJson(apiBaseUrl, '/auth/login', {
    method: 'POST',
    body: credentials,
  });
  setStoredAuthUser(response.user);
  return response;
}

async function logout(apiBaseUrl) {
  await fetchJson(apiBaseUrl, '/auth/logout', { method: 'POST' });
  setStoredAuthUser(null);
}

function debounce(callback, delayMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      callback(...args);
    }, delayMs);
  };
}

window.escapeHtml = escapeHtml;
window.getStoredApiBaseUrl = getStoredApiBaseUrl;
window.setStoredApiBaseUrl = setStoredApiBaseUrl;
window.getStoredAuthUser = getStoredAuthUser;
window.setStoredAuthUser = setStoredAuthUser;
window.fetchJson = fetchJson;
window.loadCurrentUser = loadCurrentUser;
window.signup = signup;
window.login = login;
window.logout = logout;
window.debounce = debounce;
