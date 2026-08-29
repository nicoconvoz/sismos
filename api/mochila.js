// POST /api/mochila — "Mochila de Emergencia" lead form.
// Validates the submission and forwards it server-side to a Google Form
// (lib/mochila-config.js), keeping the form destination invisible to the
// visitor. While the config holds placeholders it answers 503 not_configured.

import { mochilaConfig, isConfigured } from '../lib/mochila-config.js';
import { MOCHILA_FIELDS, validateMochila, isHoneypotTripped } from '../lib/mochila.js';

/**
 * Vercel parses JSON bodies into req.body; the plain-node dev server hands
 * us the raw stream. Tolerate both. Returns null on unparseable JSON.
 */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (typeof req.body === 'string') raw = req.body || raw;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = await readBody(req);
  if (body === null) return res.status(400).json({ error: 'invalid_json' });

  // Bots that fill the hidden trap field get a silent 200 — no forwarding,
  // and no signal that they were detected. Logged server-side so silent
  // drops are never invisible during diagnosis (mobile autofill once filled
  // this field for real users; the frontend now always sends it empty).
  if (isHoneypotTripped(body)) {
    console.warn('mochila: honeypot tripped, submission dropped (no forward)');
    return res.status(200).json({ ok: true });
  }

  const result = validateMochila(body);
  if (!result.ok) return res.status(400).json({ error: result.error, field: result.field });

  if (!isConfigured()) return res.status(503).json({ error: 'not_configured' });

  // Map our field names to the Google Forms entry ids and submit as a
  // regular form post — exactly what the form's own page would send.
  const params = new URLSearchParams();
  for (const field of MOCHILA_FIELDS) {
    params.set(mochilaConfig.fields[field], result.values[field]);
  }

  try {
    const upstream = await fetch(mochilaConfig.formResponseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      body: params.toString(),
      redirect: 'follow'
    });
    // Google answers 200 on success; a redirect that resolved also counts.
    if (upstream.status >= 200 && upstream.status < 400) {
      return res.status(200).json({ ok: true });
    }
    return res.status(502).json({ error: 'forward_failed', status: upstream.status });
  } catch (err) {
    return res.status(502).json({ error: 'forward_failed', detail: err.message });
  }
}
