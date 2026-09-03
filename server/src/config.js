import 'dotenv/config';

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};

export const config = {
  port: Number(process.env.PORT || 5000),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cyber_stk',
  callbackUrl: process.env.CALLBACK_URL || '',
  enableStaleSweep: bool(process.env.ENABLE_STALE_SWEEP, false),

  // Comma-separated list of browser origins allowed to call the API.
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  payhero: {
    username: process.env.PAYHERO_API_USERNAME || '',
    password: process.env.PAYHERO_API_PASSWORD || '',
    basicAuthToken: process.env.PAYHERO_BASIC_AUTH_TOKEN || '',
    channelId: process.env.PAYHERO_CHANNEL_ID || '',
  },

  // A PENDING transaction older than this is shown as STALE (unknown, not failed).
  staleAfterMs: 2 * 60 * 1000,
  // Ignore a verify request that lands within this window of the last one.
  verifyCooldownMs: 3 * 1000,
  // Refuse a second push to the same number inside this window.
  resendCooldownMs: 30 * 1000,
  // PayHero blocks a number after 10 successive failed/cancelled pushes. Stop early.
  maxConsecutiveFailures: 8,
};

/**
 * A blank CALLBACK_URL at least announces itself. A placeholder one is worse:
 * every check passes, pushes go out normally, and every callback disappears
 * into a host that does not exist — so the attendant watches perfectly good
 * payments go STALE and never learns why. Refuse to start instead.
 */
const PLACEHOLDER_HOSTS = [
  'your-tunnel',
  'your-service',
  'your-app',
  'your-domain',
  'example.com',
  'example.org',
  'example.net',
  'example.test',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
];

/** @returns {string|null} the reason it is unusable, or null if it looks real. */
export function validateCallbackUrl(raw = config.callbackUrl) {
  const value = String(raw ?? '').trim();
  if (!value) return 'CALLBACK_URL is not set.';

  let url;
  try {
    url = new URL(value);
  } catch {
    return `CALLBACK_URL is not a valid URL: ${value}`;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `CALLBACK_URL must be http or https, got "${url.protocol}".`;
  }

  const host = url.hostname.toLowerCase();
  const marker = PLACEHOLDER_HOSTS.find((m) => host === m || host.includes(m));
  if (marker) {
    return `CALLBACK_URL is still a placeholder — its host contains "${marker}": ${value}`;
  }

  return null;
}

/** Non-fatal: the URL is real but probably points at the wrong path. */
export function callbackUrlWarning(raw = config.callbackUrl) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null; // validateCallbackUrl already reported this.
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '/api/payments/callback') {
    return `CALLBACK_URL path is "${url.pathname}" — PayHero posts to it verbatim, and this server only listens on "/api/payments/callback".`;
  }
  return null;
}

export function assertPayheroConfig() {
  const missing = [];
  if (!config.payhero.basicAuthToken) {
    if (!config.payhero.username) missing.push('PAYHERO_API_USERNAME');
    if (!config.payhero.password) missing.push('PAYHERO_API_PASSWORD');
  }
  if (!config.payhero.channelId) missing.push('PAYHERO_CHANNEL_ID');
  if (!config.callbackUrl) missing.push('CALLBACK_URL');
  return missing;
}
