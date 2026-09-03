import { randomBytes } from 'node:crypto';

// Human-scannable and unique: CYB-<yymmdd>-<6 random chars>.
// PayHero echoes this back on the callback, so keep it short and URL-safe.
export function generateExternalReference() {
  const d = new Date();
  const stamp = [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  const rand = randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  return `CYB-${stamp}-${rand}`;
}
