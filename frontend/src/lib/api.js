const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? null : 'http://localhost:5000/api');

function requireApiUrl() {
  if (!API_URL) {
    throw new Error(
      '[api] VITE_API_URL is not configured. Set it in your Vercel project environment variables and rebuild.',
    );
  }
  return API_URL;
}

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
    const res = await fetch(`${requireApiUrl()}/auth/refresh`, {
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
  const baseUrl = requireApiUrl();
  const execute = async (token) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res;
  try {
    res = await execute(getAccessToken());
  } catch (err) {
    throw new ApiError(
      err.name === 'TypeError' && err.message === 'Failed to fetch'
        ? 'Unable to reach the server. Please try again later.'
        : err.message,
      0,
    );
  }

  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      try {
        res = await execute(getAccessToken());
      } catch (err) {
        throw new ApiError(
          err.name === 'TypeError' && err.message === 'Failed to fetch'
            ? 'Unable to reach the server. Please try again later.'
            : err.message,
          0,
        );
      }
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error ?? 'Request failed', res.status);
  }
  return data;
}
