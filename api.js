// =========================================================
// API DO ID HUB
// =========================================================
//
// O frontend e o backend podem ficar no mesmo Web Service
// do Render. Por isso usamos "/api" como padrão.
//
// Se futuramente precisar apontar para outro backend,
// basta definir:
// window.IDHUB_API_URL = "https://seu-backend.com/api";
//
// =========================================================

const API_URL = (
  window.IDHUB_API_URL || '/api'
).replace(/\/$/, '');


// =========================================================
// REQUISIÇÃO PADRÃO DA API
// =========================================================

async function apiRequest(
  endpoint,
  method = 'GET',
  data = null
) {
  const headers = {
    'Content-Type': 'application/json'
  };

  const token =
    localStorage.getItem('token');

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const config = {
    method: String(method).toUpperCase(),
    headers
  };

  if (
    data !== null &&
    data !== undefined &&
    !['GET', 'HEAD'].includes(config.method)
  ) {
    config.body =
      JSON.stringify(data);
  }

  const response =
    await fetch(
      `${API_URL}${endpoint}`,
      config
    );

  let responseData = {};

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    responseData =
      await response.json();
  } else {
    responseData = {
      message:
        await response.text()
    };
  }

  if (!response.ok) {

    // =====================================================
    // TOKEN EXPIRADO / NÃO AUTORIZADO
    // =====================================================

    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('perfil');
      localStorage.removeItem('email');
      localStorage.removeItem('idhub_docente');
    }

    throw new Error(
      responseData.message ||
      responseData.error ||
      responseData.erro ||
      `Erro HTTP ${response.status}`
    );
  }

  return responseData;
}


// =========================================================
// TESTAR CONEXÃO COM A API
// =========================================================

async function testarAPI() {
  try {
    const response =
      await fetch(
        `${API_URL}/health`
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return true;

  } catch (error) {

    console.error(
      '[IDHUB API] Backend offline:',
      error
    );

    return false;
  }
}


// =========================================================
// DISPONIBILIZAR GLOBALMENTE
// =========================================================

window.API_URL =
  API_URL;

window.apiRequest =
  apiRequest;

window.testarAPI =
  testarAPI;