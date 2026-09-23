// API do ID HUB
// O frontend e o backend são publicados juntos no Render.
// Por isso, por padrão, a API usa a mesma origem da página.
const API_URL = (window.IDHUB_API_URL || `${window.location.origin}/api`).replace(/\/$/, '');

async function apiRequest(endpoint, method = 'GET', data = null) {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;

  const config = { method: method.toUpperCase(), headers };
  if (data !== null && config.method !== 'GET' && config.method !== 'HEAD') {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_URL}${normalizedEndpoint}`, config);
  if (response.status === 204) return { success: true };

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => ({}));
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { message: text } : {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
    }
    const message = payload?.erro || payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function testarAPI() {
  return apiRequest('/health');
}

window.API_URL = API_URL;
window.apiRequest = apiRequest;
window.testarAPI = testarAPI;
