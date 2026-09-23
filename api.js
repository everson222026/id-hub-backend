// =========================================================
// API DO ID HUB
// =========================================================
// Frontend e backend são publicados pelo mesmo Web Service.
// A API usa /api e envia automaticamente o JWT salvo no navegador.
// =========================================================

const API_URL = (
  window.IDHUB_API_URL || '/api'
).replace(/\/$/, '');

async function apiRequest(endpoint, method = 'GET', data = null) {
  const normalizedEndpoint = String(endpoint || '').startsWith('/')
    ? String(endpoint)
    : `/${endpoint}`;

  const upperMethod = String(method).toUpperCase();
  const headers = {};
  const token = localStorage.getItem('token');

  if (data !== null && data !== undefined && !['GET', 'HEAD'].includes(upperMethod)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const config = {
    method: upperMethod,
    headers
  };

  if (data !== null && data !== undefined && !['GET', 'HEAD'].includes(upperMethod)) {
    config.body = JSON.stringify(data);
  }

  let response;
  try {
    response = await fetch(`${API_URL}${normalizedEndpoint}`, config);
  } catch (error) {
    throw new Error('Não foi possível conectar ao servidor do ID HUB.');
  }

  const contentType = response.headers.get('content-type') || '';
  let responseData = {};

  if (contentType.includes('application/json')) {
    responseData = await response.json().catch(() => ({}));
  } else {
    responseData = {
      mensagem: await response.text().catch(() => '')
    };
  }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('perfil');
      localStorage.removeItem('email');
      localStorage.removeItem('idhub_docente');
      localStorage.removeItem('idhub_database_owner_id');
    }

    throw new Error(
      responseData.erro ||
      responseData.error ||
      responseData.message ||
      responseData.mensagem ||
      `Erro HTTP ${response.status}`
    );
  }

  return responseData;
}

async function testarAPI() {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch (_) {
    return false;
  }
}

window.API_URL = API_URL;
window.apiRequest = apiRequest;
window.testarAPI = testarAPI;
