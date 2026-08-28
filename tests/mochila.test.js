import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mochilaConfig, isConfigured } from '../lib/mochila-config.js';
import { MOCHILA_FIELDS, validateMochila, isHoneypotTripped } from '../lib/mochila.js';

const VALID = {
  nombre: 'Juan Pérez',
  edad: '34',
  sexo: 'Masculino',
  fechaNacimiento: '1992-03-14',
  dni: '32456789',
  telefono: '+54 9 261 555-1234',
  localidad: 'San Martín',
  provincia: 'Mendoza',
  direccion: 'Calle Falsa 123',
  email: 'juan.perez@example.com'
};

test('config points at the live Google Form and is fully configured', () => {
  assert.match(
    mochilaConfig.formResponseUrl,
    /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/
  );
  for (const field of MOCHILA_FIELDS) {
    assert.ok(field in mochilaConfig.fields, `config has field ${field}`);
    assert.match(mochilaConfig.fields[field], /^entry\.\d+$/, `field ${field} has an entry id`);
  }
  assert.equal(isConfigured(), true);
});

test('isConfigured requires url AND every field id', () => {
  const full = {
    formResponseUrl: 'https://docs.google.com/forms/d/e/FAKE/formResponse',
    fields: Object.fromEntries(MOCHILA_FIELDS.map((f, i) => [f, `entry.${1000 + i}`]))
  };
  assert.equal(isConfigured(full), true);
  assert.equal(isConfigured({ ...full, formResponseUrl: null }), false);
  assert.equal(isConfigured({ ...full, fields: { ...full.fields, email: null } }), false);
});

test('validateMochila accepts a complete valid payload with trimming', () => {
  const result = validateMochila({ ...VALID, nombre: '  Juan Pérez  ' });
  assert.equal(result.ok, true);
  assert.equal(result.values.nombre, 'Juan Pérez');
  for (const field of MOCHILA_FIELDS) assert.equal(typeof result.values[field], 'string');
});

for (const field of MOCHILA_FIELDS) {
  test(`validateMochila rejects missing/empty ${field}`, () => {
    const payload = { ...VALID };
    delete payload[field];
    let result = validateMochila(payload);
    assert.equal(result.ok, false);
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
    assert.equal(result.field, 'email');
  }
});

test('validateMochila rejects out-of-range or non-numeric edad', () => {
  for (const bad of ['0', '121', '-5', 'abc', '12.5']) {
    const result = validateMochila({ ...VALID, edad: bad });
    assert.equal(result.ok, false, `should reject edad ${bad}`);
    assert.equal(result.field, 'edad');
  }
  assert.equal(validateMochila({ ...VALID, edad: '1' }).ok, true);
  assert.equal(validateMochila({ ...VALID, edad: '120' }).ok, true);
});

test('validateMochila requires at least 6 digits in telefono', () => {
  const result = validateMochila({ ...VALID, telefono: '12-34' });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'telefono');
  assert.equal(validateMochila({ ...VALID, telefono: '(261) 555-123' }).ok, true);
});

test('validateMochila requires dni of 6-10 digits', () => {
  for (const bad of ['12345', '12345678901', 'abcdef']) {
    const result = validateMochila({ ...VALID, dni: bad });
    assert.equal(result.ok, false, `should reject dni ${bad}`);
    assert.equal(result.field, 'dni');
  }
  assert.equal(validateMochila({ ...VALID, dni: '32.456.789' }).ok, true, 'dots stripped');
});

test('validateMochila caps every field at 200 chars', () => {
  const result = validateMochila({ ...VALID, direccion: 'x'.repeat(201) });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'direccion');
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
