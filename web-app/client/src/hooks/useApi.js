/**
 * API fetch wrapper
 * 
 * Automatically includes the auth token in requests.
 * Handles JSON parsing and error responses.
 */

const API_BASE = '';  // Same origin in dev (proxied by Vite), same server in prod

export async function api(endpoint, options = {}) {
  const token = localStorage.getItem('dh_token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Hook-style fetcher for simple GET requests
 */
export function useApiFetch(endpoint) {
  // Returns a function that can be called to fetch data
  return async () => {
    return api(endpoint);
  };
}
