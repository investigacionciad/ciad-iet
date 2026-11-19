// @fileoverview Pruebas del Receptor sin conectarse a Google.
// @author APONTE
const test = require('node:test');
const assert = require('node:assert');
const R = require('./cargar')('receptor');

test('receptor: lo que parece fórmula entra a la hoja como texto', () => {
  ['=IMAGE("https://x")', '+1', '-1', '@a'].forEach(v => assert.strictEqual(R.comoTexto_(v), "'" + v));
  assert.strictEqual(R.comoTexto_('Mi título = bueno'), 'Mi título = bueno');
  assert.strictEqual(R.comoTexto_(''), '');
  const fecha = new Date(0);
  assert.strictEqual(R.comoTexto_(fecha), fecha); // Fechas y números no se tocan
});
