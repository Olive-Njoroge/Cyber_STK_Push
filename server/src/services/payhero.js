/**
 * The only file in this codebase that knows PayHero exists.
 *
 * Everything here converts PayHero's wire format into one canonical shape, so
 * routes, models and the frontend never see a PayHero field name:
 *
 *   PaymentResult {
 *     status:            'PENDING' | 'SUCCESS' | 'FAILED'
 *     resultCode:        String   ('' when unknown)
 *     resultDescription: String
 *     mpesaReceipt:      String
 *     checkoutRequestId: String
 *     payheroReference:  String
 *     externalReference: String
 *     amount:            Number | null
 *     source:            'callback' | 'status-query'
 *   }
 *
 * Verified against https://docs.payhero.co.ke on 2026-09-03:
 *   POST /api/v2/payments                              initiate STK push -> 201
 *   GET  /api/v2/transaction-status?reference=<ref>    true status       -> 200
 *   callback body: { forward_url, status, response: { ... } }
 */
import { config } from '../config.js';
import { toLocalFormat } from '../utils/phone.js';

const BASE_URL = 'https://backend.payhero.co.ke';
const REQUEST_TIMEOUT_MS = 20000;

export class PayheroError extends Error {
  constructor(message, { status = 0, body = null, cause = null } = {}) {
    super(message);
    this.name = 'PayheroError';
    this.httpStatus = status;
    this.body = body;
    if (cause) this.cause = cause;
  }
}

function authHeader() {
  const { basicAuthToken, username, password } = config.payhero;
  const token = basicAuthToken || Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

async function request(path, { method = 'GET', body } = {}) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network down, DNS, TLS, or our own timeout. Nothing reached PayHero.
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    throw new PayheroError(`PayHero ${reason} (${method} ${path})`, { cause: err });
  }

  const raw = await res.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!res.ok) {
    const detail =
      payload?.error_message || payload?.message || payload?.error || (raw || '').slice(0, 200);
    throw new PayheroError(
      `PayHero rejected the request (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      { status: res.status, body: payload }
    );
  }

  return payload ?? {};
}

/** Map PayHero's vocabulary (QUEUED | SUCCESS | FAILED) to ours. */
function mapStatus(value) {
  const s = String(value ?? '').trim().toUpperCase();
  if (s === 'SUCCESS' || s === 'COMPLETED' || s === 'PAID') return 'SUCCESS';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'CANCELED') return 'FAILED';
  return 'PENDING'; // QUEUED, or anything new they add. Never guess FAILED.
}

/**
 * Initiate an STK push.
 * Throws PayheroError when the request itself fails, so the caller can tell the
 * attendant that no prompt ever reached the phone.
 */
export async function initiateStkPush({ amount, phoneNumber, externalReference, customerName }) {
  const payload = {
    amount: Number(amount),
    // Their docs use the local 07xx form in the example body; we keep 2547xxxxxxxx internally.
    phone_number: toLocalFormat(phoneNumber),
    channel_id: Number(config.payhero.channelId),
    provider: 'm-pesa',
    external_reference: externalReference,
    callback_url: config.callbackUrl,
  };
  if (customerName) payload.customer_name = customerName;

  const data = await request('/api/v2/payments', { method: 'POST', body: payload });

  // 201 body: { success, status: "QUEUED", reference, CheckoutRequestID }
  if (data.success === false) {
    throw new PayheroError(data.error_message || data.message || 'PayHero declined the STK push', {
      body: data,
    });
  }

  return {
    status: mapStatus(data.status),
    payheroReference: String(data.reference ?? ''),
    checkoutRequestId: String(data.CheckoutRequestID ?? data.checkout_request_id ?? ''),
    raw: data,
  };
}

/**
 * Ask PayHero what actually happened.
 *
 * The documented `reference` query parameter is "the reference that was
 * returned in the original transaction request" (an M-Pesa code also works).
 * Our own external_reference is not documented as accepted, so it is only a
 * fallback for rows where the initiate response never handed us a reference.
 *
 * Returns a PaymentResult, or null when PayHero has no record to give.
 */
export async function fetchTransactionStatus({ payheroReference, externalReference }) {
  const candidates = [payheroReference, externalReference].filter(Boolean);
  if (candidates.length === 0) return null;

  for (const reference of candidates) {
    let data;
    try {
      data = await request(`/api/v2/transaction-status?reference=${encodeURIComponent(reference)}`);
    } catch (err) {
      // A 404 on the first candidate just means "try the fallback".
      if (err instanceof PayheroError && (err.httpStatus === 404 || err.httpStatus === 422)) continue;
      throw err;
    }
    if (!data || (data.success === false && !data.status)) continue;
    return normalizeStatusResponse(data, externalReference);
  }

  return null;
}

function normalizeStatusResponse(data, externalReference = '') {
  // { transaction_date, provider, success, merchant, payment_reference,
  //   third_party_reference, status, reference, CheckoutRequestID, provider_reference }
  const status = mapStatus(data.status);
  const receipt = String(data.provider_reference || data.third_party_reference || '');

  const description =
    status === 'SUCCESS'
      ? 'Payment received.'
      : status === 'FAILED'
        ? 'PayHero reports this payment failed or was cancelled.'
        : 'Still queued at PayHero. The customer has not completed the prompt.';

  return {
    status,
    resultCode: status === 'SUCCESS' ? '0' : '',
    resultDescription: description,
    mpesaReceipt: status === 'SUCCESS' ? receipt : '',
    checkoutRequestId: String(data.CheckoutRequestID ?? ''),
    payheroReference: String(data.reference ?? ''),
    externalReference: String(data.payment_reference || externalReference || ''),
    amount: null,
    source: 'status-query',
  };
}

/**
 * Parse the webhook body PayHero POSTs to CALLBACK_URL.
 * Returns a PaymentResult, or null if the body is not a payment callback.
 */
export function parseCallback(body) {
  const r = body?.response;
  if (!r || typeof r !== 'object') return null;

  const externalReference = String(r.ExternalReference ?? '');
  const checkoutRequestId = String(r.CheckoutRequestID ?? '');
  if (!externalReference && !checkoutRequestId) return null;

  const hasResultCode = r.ResultCode !== undefined && r.ResultCode !== null && r.ResultCode !== '';
  const status = hasResultCode
    ? Number(r.ResultCode) === 0
      ? 'SUCCESS'
      : 'FAILED'
    : mapStatus(r.Status);

  return {
    status,
    resultCode: hasResultCode ? String(r.ResultCode) : '',
    resultDescription: String(r.ResultDesc ?? r.Status ?? ''),
    mpesaReceipt: status === 'SUCCESS' ? String(r.MpesaReceiptNumber ?? '') : '',
    checkoutRequestId,
    payheroReference: '',
    externalReference,
    amount: r.Amount === undefined ? null : Number(r.Amount),
    source: 'callback',
  };
}
