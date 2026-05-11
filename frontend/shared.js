const STORAGE_KEYS = {
  apiBaseUrl: 'codelounge:apiBaseUrl',
  sourcePrefix: 'codelounge:source:',
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

async function fetchJson(apiBaseUrl, path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

function sourceStorageKey(problemId, language) {
  return `${STORAGE_KEYS.sourcePrefix}${problemId}:${language}`;
}

function getStoredSource(problemId, language) {
  return localStorage.getItem(sourceStorageKey(problemId, language));
}

function setStoredSource(problemId, language, value) {
  localStorage.setItem(sourceStorageKey(problemId, language), value);
}
