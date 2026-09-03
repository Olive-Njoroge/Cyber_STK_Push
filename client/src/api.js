// Empty in development: Vite proxies /api to Express. On Vercel this is the
// full Render URL, e.g. https://cyber-stk.onrender.com
const ROOT = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const BASE = `${ROOT}/api/payments`;

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the server. Is it running?'), { offline: true });
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Empty or non-JSON body; fall through to the status check.
  }

  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
      transaction: data.transaction,
      retryInMs: data.retryInMs,
    });
  }
  return data;
}

export const api = {
  listToday: () => request('?today=true&limit=100'),
  create: (payload) => request('', { method: 'POST', body: JSON.stringify(payload) }),
  get: (id) => request(`/${id}`),
  verify: (id) => request(`/${id}/verify`),
};
