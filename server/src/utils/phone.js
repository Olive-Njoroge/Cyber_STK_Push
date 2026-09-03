// Kenyan mobile numbers. Safaricom now issues both 07xx and 01xx prefixes.
// Everything is stored as 2547XXXXXXXX / 2541XXXXXXXX.

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

// PayHero's own docs use the local 07xx form in their example payload.
export function toLocalFormat(normalized) {
  return `0${String(normalized).slice(3)}`;
}
