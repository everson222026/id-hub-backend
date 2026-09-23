// API do ID HUB
// Pode ser configurada com window.IDHUB_API_URL.
// - Render unificado: usa a mesma origem.
// - Frontend hospedado separadamente: usa o backend Render conhecido.
// - Localhost: usa o backend local.
(function () {
  const configuredUrl = String(window.IDHUB_API_URL || '').trim();

  let defaultUrl;
  if (configuredUrl) {
    defaultUrl = configuredUrl;
  } else if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    defaultUrl = 'http://localhost:3000/api';
  } else if (window.location.hostname.endsWith('.onrender.com')) {
    defaultUrl = `${window.location.origin}/api`;
  } else {
    // Compatibilidade com a publicação do backend usada anteriormente pelo projeto.
    defaultUrl = 'https://id-hub-backend-wkul.onrender.com/api';
  }

  const API_URL = defaultUrl.replace(/\/$/, '');

  async function apiRequest(endpoint, method = 'GET', data = null) {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const config = {
      method: method.toUpperCase(),
      headers
    };

    if (data !== null && config.method !== 'GET' && config.method !== 'HEAD') {
      config.body = JSON.stringify(data);
    }

    let response;
    try {
      response = await fetch(`${API_URL}${normalizedEndpoint}`, config);
    } catch (networkError) {
      throw new Error(
        `Não foi possível conectar à API (${API_URL}). Verifique se o backend está online.`
      );
    }

    if (response.status === 204) {
      return { success: true };
    }

    const contentType = response.headers.get('content-type') || '';
    let payload = {};

    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => ({}));
    } else {
      const responseText = await response.text().catch(() => '');
      payload = responseText ? { message: responseText } : {};
    }

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
      }

      const message =
        payload?.erro ||
        payload?.error ||
        payload?.message ||
        `Erro HTTP ${response.status}`;

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
})();
