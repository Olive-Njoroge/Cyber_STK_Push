// Mirror of server/src/utils/phone.js so the attendant sees the error before
// the request goes out.

export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;

  let local;
  if (digits.startsWith('254')) local = digits.slice(3);
  else if (digits.startsWith('0')) local = digits.slice(1);
  else local = digits;

  if (!/^[71]\d{8}$/.test(local)) return null;
  return `254${local}`;
}

export function formatPhone(normalized) {
  if (!normalized || normalized.length !== 12) return normalized || '';
  return `0${normalized.slice(3, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`;
}
