// Server-side validation for the "Mochila de Emergencia" lead form.
// Pure functions — shared contract between api/mochila.js and the tests
// (the frontend mirrors these rules for inline feedback, but this is the
// authoritative validation).

export const MOCHILA_FIELDS = ['nombre', 'apellido', 'pais', 'provincia', 'telefono', 'email'];

const MAX_LEN = 200; // hard cap per field to prevent abuse
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate a submission payload. Returns { ok: true, values } with trimmed
 * strings, or { ok: false, error, field } naming the first offending field.
 */
export function validateMochila(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'invalid_payload', field: null };
  }

  const values = {};
  for (const field of MOCHILA_FIELDS) {
    const raw = payload[field];
    const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!value) return { ok: false, error: 'required', field };
    if (value.length > MAX_LEN) return { ok: false, error: 'too_long', field };
    values[field] = value;
  }

  if (!EMAIL_RE.test(values.email)) return { ok: false, error: 'invalid_email', field: 'email' };

  if (values.telefono.replace(/\D/g, '').length < 6) {
    return { ok: false, error: 'invalid_phone', field: 'telefono' };
  }

  return { ok: true, values };
}

/**
 * Honeypot check: the form ships a CSS-hidden `website` input that humans
 * never fill. A non-empty value marks the submission as bot traffic.
 */
export function isHoneypotTripped(payload) {
  return Boolean(payload && typeof payload === 'object' && String(payload.website || '').trim());
}
