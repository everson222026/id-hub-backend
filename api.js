// API do ID HUB.
// Como o frontend e o backend podem ficar no mesmo Web Service do Render,
// usamos /api por padrão e não localhost.
const API_URL = (window.IDHUB_API_URL || '/api').replace(/\/$/, '');

async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');

  if (token) headers.Authorization = `Bearer ${token}`;

  const config = {
    method: method.toUpperCase(),
    headers
  };

  if (data !== null && data !== undefined && !['GET', 'HEAD'].includes(config.method)) {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);

  let responseData = {};
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    responseData = await response.json();
  } else {
    responseData = { message: await response.text() };
  }

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('perfil');
      localStorage.removeItem('email');
      localStorage.removeItem('idhub_docente');
    }

    throw new Error(
      responseData.message ||
      responseData.error ||
      `Erro HTTP ${response.status}`
    );
  }

  return responseData;
}

async function testarAPI() {
  try {
    await fetch(`${API_URL}/health`);
    return true;
  } catch (error) {
    console.error('[IDHUB API] Backend offline:', error);
    return false;
  }
}

window.API_URL = API_URL;
window.apiRequest = apiRequest;
window.testarAPI = testarAPI;
