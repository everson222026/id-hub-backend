// API do ID HUB
// Compatível com:
// 1) Frontend + backend juntos no Render: usa /api.
// 2) Frontend hospedado separadamente (ex.: Netlify): usa o backend Render.
// 3) Desenvolvimento local: usa localhost:3000.
(function () {
  const configuredUrl = String(window.IDHUB_API_URL || '').trim();
  const renderBackend = 'https://id-hub-backend-wkul.onrender.com/api';

  let defaultUrl;
  if (configuredUrl) {
    defaultUrl = configuredUrl;
  } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    defaultUrl = 'http://localhost:3000/api';
  } else if (window.location.hostname.endsWith('.onrender.com')) {
    defaultUrl = `${window.location.origin}/api`;
  } else {
    defaultUrl = renderBackend;
  }

  const API_URL = defaultUrl.replace(/\/$/, '');

  async function apiRequest(endpoint, method = 'GET', data = null) {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;

    const config = { method: method.toUpperCase(), headers };
    if (data !== null && data !== undefined && !['GET', 'HEAD'].includes(config.method)) {
      config.body = JSON.stringify(data);
    }

    let response;
    try {
      response = await fetch(`${API_URL}${normalizedEndpoint}`, config);
    } catch (networkError) {
      console.error(`[API NETWORK] ${config.method} ${normalizedEndpoint}`, networkError);
      throw new Error(`Não foi possível conectar à API em ${API_URL}. Verifique se o backend está online.`);
    }

    const rawText = await response.text().catch(() => '');
    let payload = null;
    if (rawText) {
      try { payload = JSON.parse(rawText); } catch (_) { payload = { message: rawText }; }
    }

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
      }
      const message = payload?.erro || payload?.error || payload?.message || `Erro HTTP ${response.status}`;
      console.error(`[API ${response.status}] ${config.method} ${normalizedEndpoint}`, payload);
      throw new Error(message);
    }

    return payload ?? { success: true };
  }

  async function testarAPI() {
    return apiRequest('/health');
  }

  window.API_URL = API_URL;
  window.apiRequest = apiRequest;
  window.testarAPI = testarAPI;
})();
