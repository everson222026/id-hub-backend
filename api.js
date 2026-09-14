// js/api.js
// Removido o "/index.html" do final da URL. 
// Assumindo que seu backend use "/api" como rota base (de acordo com seu localhost).
const API_URL = 'https://id-hub-backend-wkul.onrender.com/api';

/**
 * Função utilitária para realizar requisições HTTP para a API.
 * 
 * @param {string} endpoint - O caminho da rota (ex: '/turmas' ou '/alunos')
 * @param {string} method - Método HTTP ('GET', 'POST', 'PUT', 'DELETE')
 * @param {object|null} data - Dados a serem enviados no corpo da requisição
 * @returns {Promise<any|null>} Retorna o JSON da resposta ou null em caso de erro/offline
 */
async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 
    'Content-Type': 'application/json' 
  };

  // Adiciona o token JWT caso o usuário esteja autenticado
  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    method: method.toUpperCase(),
    headers
  };

  // Se houver dados e o método não for GET/HEAD, inclui o body
  if (data && config.method !== 'GET') {
    config.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, config);

    // Se o status for 204 (No Content) ou resposta vazia (comum em DELETE), retorna objeto de sucesso
    if (response.status === 204) {
      return { success: true };
    }

    // Trata erros de status HTTP (4xx e 5xx)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[API Error ${response.status}] ao acessar ${endpoint}:`, errorData);
      
      // Caso o token seja inválido/expirado (401), pode-se redirecionar para o login
      if (response.status === 401) {
        localStorage.removeItem('token');
        // window.location.href = '/login.html'; // Descomente caso use página separada de login
      }

      return null;
    }

    // Retorna o JSON parseado da resposta
    return await response.json();

  } catch (error) {
    // Falha de rede/servidor offline (Fallback local)
    console.warn(`[API Offline] Falha na conexão com ${endpoint}. Usando dados do armazenamento local.`, error);
    return null;
  }
}