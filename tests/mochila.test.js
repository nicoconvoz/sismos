import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mochilaConfig, isConfigured } from '../lib/mochila-config.js';
import { MOCHILA_FIELDS, validateMochila, isHoneypotTripped } from '../lib/mochila.js';

const VALID = {
  nombre: 'Juan',
  apellido: 'Pérez',
  pais: 'Argentina',
  provincia: 'Mendoza',
  telefono: '+54 9 261 555-1234',
  email: 'juan.perez@example.com'
};

test('field list is exactly the six lead-form fields', () => {
  assert.deepEqual(MOCHILA_FIELDS, ['nombre', 'apellido', 'pais', 'provincia', 'telefono', 'email']);
});

test('config carries an entry id per field and is fully configured', () => {
  assert.match(mochilaConfig.formResponseUrl, /^https:\/\/docs\.google\.com\/forms\/d\/e\/.+\/formResponse$/);
  assert.deepEqual(Object.keys(mochilaConfig.fields).sort(), [...MOCHILA_FIELDS].sort());
  for (const [field, id] of Object.entries(mochilaConfig.fields)) {
    assert.match(id, /^entry\.\d+$/, `field ${field} has a Google entry id`);
  }
  assert.equal(isConfigured(), true);
});

test('isConfigured requires url AND every field id', () => {
  assert.equal(isConfigured({ ...mochilaConfig, formResponseUrl: null }), false);
  assert.equal(
    isConfigured({ ...mochilaConfig, fields: { ...mochilaConfig.fields, email: null } }),
    false
  );
});

test('validateMochila accepts a complete valid payload with trimming', () => {
  const result = validateMochila({ ...VALID, nombre: '  Juan  ' });
  assert.equal(result.ok, true);
  assert.equal(result.values.nombre, 'Juan');
  for (const field of MOCHILA_FIELDS) assert.equal(typeof result.values[field], 'string');
});

for (const field of MOCHILA_FIELDS) {
  test(`validateMochila rejects missing/empty ${field}`, () => {
    const payload = { ...VALID };
    delete payload[field];
    let result = validateMochila(payload);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'required');
    assert.equal(result.field, field);
    result = validateMochila({ ...VALID, [field]: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.field, field);
  });
}

test('validateMochila rejects malformed email', () => {
  for (const bad of ['no-arroba', 'a@b', 'a b@c.com', '@x.com', 'a@.com']) {
    const result = validateMochila({ ...VALID, email: bad });
    assert.equal(result.ok, false, `should reject ${bad}`);
    assert.equal(result.error, 'invalid_email');
    assert.equal(result.field, 'email');
  }
});

test('validateMochila requires at least 6 digits in telefono', () => {
  const result = validateMochila({ ...VALID, telefono: '12-34' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_phone');
  assert.equal(result.field, 'telefono');
  assert.equal(validateMochila({ ...VALID, telefono: '(261) 555-123' }).ok, true);
});

test('validateMochila caps every field at 200 chars', () => {
  const result = validateMochila({ ...VALID, apellido: 'x'.repeat(201) });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'too_long');
  assert.equal(result.field, 'apellido');
});

test('validateMochila rejects non-object payloads', () => {
  assert.equal(validateMochila(null).ok, false);
  assert.equal(validateMochila('str').ok, false);
});

test('isHoneypotTripped detects the website trap field', () => {
  assert.equal(isHoneypotTripped({ ...VALID }), false);
  assert.equal(isHoneypotTripped({ ...VALID, website: '' }), false);
  assert.equal(isHoneypotTripped({ ...VALID, website: 'http://spam.example' }), true);
  assert.equal(isHoneypotTripped(null), false);
});
