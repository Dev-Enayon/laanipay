const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function setTokens({ accessToken, refreshToken }) {
  localStorage.setItem('laani_access', accessToken);
  localStorage.setItem('laani_refresh', refreshToken);
}

export function clearTokens() {
  localStorage.removeItem('laani_access');
  localStorage.removeItem('laani_refresh');
}

function getAccessToken() {
  return localStorage.getItem('laani_access');
}

function getRefreshToken() {
  return localStorage.getItem('laani_refresh');
}

async function tryRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    setTokens(data);
    return true;
  } catch {
    clearTokens();
    window.dispatchEvent(new CustomEvent('laani:unauthorized'));
    return false;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const execute = async (token) =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await execute(getAccessToken());

  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await execute(getAccessToken());
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error ?? 'Request failed', res.status);
  }
  return data;
}
