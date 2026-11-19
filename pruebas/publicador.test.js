// @fileoverview Pruebas del Publicador sin conectarse a Google. Se corren antes de cada `clasp push`:
// @author APONTE
//   node --test ~/ciad/pruebas
// Cubren lo que se rompe con más facilidad sin que se note: conversión del Word, citas, fechas, filtro de HTML y etiquetas.
const test = require('node:test');
const assert = require('node:assert');
const P = require('./cargar')();
// Lo que devuelve el código está en otro contexto de Node, así que se compara por valor
const igual = (real, esperado) => assert.deepStrictEqual(JSON.parse(JSON.stringify(real)), esperado);

test('citas: [[n]] se vuelve número volado con burbuja y la referencia queda con ancla', () => {
  const html = P.citasNumeradas_('<p>Texto [[1]].</p><p>[[1]] Autor (2020). Libro.</p>');
  assert.match(html, /<sup class="cita"><a href="#ref-1" aria-label="Referencia 1">\[1\]<\/a>/);
  assert.match(html, /cita-caja">Autor \(2020\)\. Libro\./);
  assert.match(html, /<p id="ref-1"><span class="ref-n">\[1\]<\/span> Autor \(2020\)\. Libro\.<\/p>/);
});

test('citas: ida y vuelta (convertir → editar en el panel) deja el texto igual', () => {
  const original = '<p>Texto [[1]] y [[2]].</p><p>[[1]] Autor.</p><p>[[2]] Otro.</p>';
  assert.strictEqual(P.citasAMarcas_(P.citasNumeradas_(original)), original);
});

test('fechas del Word', () => {
  assert.strictEqual(P.normalizarFecha_('3 de marzo de 2025'), '03/03/2025');
  assert.strictEqual(P.normalizarFecha_('12/03/2025'), '12/03/2025');
  assert.strictEqual(P.normalizarFecha_('basura'), 'basura');
  assert.strictEqual(P.esFecha_('12 de noviembre de 2026'), true);
  assert.strictEqual(P.esFecha_('Hola mundo'), false);
});

test('videos de YouTube', () => {
  assert.strictEqual(P.idYoutube_('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(P.idYoutube_('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5'), 'dQw4w9WgXcQ');
  assert.strictEqual(P.idYoutube_('https://vimeo.com/1'), '');
});

test('texto: palabras, nombres de carpeta y comparación sin acentos', () => {
  assert.strictEqual(P.contarPalabras_('  uno dos   tres '), 3);
  assert.strictEqual(P.nombreSeguro_('a/b:c*?"<>|  d'), 'abc d');
  assert.strictEqual(P.nombreSeguro_(''), 'articulo');
  assert.strictEqual(P.normalizar_('  Ética  y SOCIEDAD '), 'etica y sociedad');
  igual(P.datoEtiquetado_('Correo: a@b.mx'), { campo: 'correo', valor: 'a@b.mx' });
  igual(P.idsDeDrive_('https://drive.google.com/open?id=AAA, https://drive.google.com/open?id=BBB'), ['AAA', 'BBB']);
});

test('filtro de HTML del editor: quita lo peligroso y deja lo normal', () => {
  const s = P.htmlSeguro_;
  assert.strictEqual(s('<p onclick="x()">hola<script>alert(1)</script></p>'), '<p>hola</p>');
  assert.strictEqual(s('<IMG SRC=x ONERROR=alert(1)>'), '<IMG SRC=x>');
  assert.strictEqual(s('<iframe src="https://evil"></iframe>'), '');
  assert.strictEqual(s('<form action=x><input></form>'), '');
  for (const malo of [' JaVaScRiPt:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,hola']) {
    assert.strictEqual(s('<a href="' + malo + '">x</a>'), '<a href="#">x</a>', malo);
  }
  assert.strictEqual(s('<a href="https://ok.mx" target="_blank">ok</a>'), '<a href="https://ok.mx" target="_blank">ok</a>');
  assert.strictEqual(s('<a href="#ref-1">[1]</a>'), '<a href="#ref-1">[1]</a>');
});

test('etiquetas de una sección del formulario', () => {
  igual(P.etiquetasDe_('Tecnologías Emergentes: Inteligencia Artificial'),
    ['formato-articulo', 'categoria-tecnologias-emergentes', 'Inteligencia Artificial']);
});

test('estilo de las notas: se puede aplicar dos veces y ya no trae el patrón de garabatos', () => {
  const una = P.conEstiloAlDia_('<div class="articulo-ciad">hola</div>');
  assert.strictEqual(P.conEstiloAlDia_(una), una);
  assert.strictEqual((una.match(/<style>/g) || []).length, 1);
  assert.strictEqual((una.match(/ciad-citas/g) || []).length, 1); // El script de la burbuja tampoco se repite
  assert.doesNotMatch(P.CITAS_SCRIPT_, /<(?!\/?script)|&&/); // Blogger alteraría "<" y "&&"
  assert.doesNotMatch(una, /svg\+xml/);
});

test('mantenimiento: qué imágenes se reducen (JPG/PNG grandes; nunca GIF)', () => {
  assert.strictEqual(P.esImagenReducible_('image/jpeg', 600 * 1024), true);
  assert.strictEqual(P.esImagenReducible_('image/png', 100), false);
  assert.strictEqual(P.esImagenReducible_('image/gif', 6e6), false);
});

test('mantenimiento: las carpetas de imágenes del panel nunca cuentan como «artículo sin fila»', () => {
  // hijos_ guarda lo que leyó de Drive: se llena a mano para no conectarse
  P.HIJOS_.raiz = { archivos: [], carpetas: [
    { id: 'p1', nombre: 'Imágenes principales' }, { id: 'p2', nombre: 'Imágenes de las tarjetas' }, { id: 'p3', nombre: 'Imágenes de las notas' },
    { id: 'rev', nombre: 'Mi artículo · 12-11-2026' }, { id: 'pub', nombre: 'Publicados 2026' }] };
  P.HIJOS_.pub = { archivos: [], carpetas: [{ id: 'a1', nombre: 'SOL-0001 · Nota' }] };
  igual(P.carpetasDeArticulos_('raiz').map(c => c.id), ['rev', 'a1']);
});

test('usuarios: la cuenta del CIAD no se puede quitar y solo ella cambia administradores', () => {
  const fija = P.CONFIG.CUENTAS_CIAD[0].trim().toLowerCase();
  const otro = { correo: 'otro@uabc.edu.mx', admin: true, avisos: { solicitudes: true, articulos: true, comentarios: true } };
  const actual = P.validarUsuarios_([otro], fija, []);
  const cuenta = actual.filter(u => u.correo === fija)[0];
  assert.ok(cuenta && cuenta.admin); // Si se borra de la lista, vuelve como administradora
  const sinAdmin = Object.assign({}, otro, { admin: false });
  assert.throws(() => P.validarUsuarios_([sinAdmin], 'otro@uabc.edu.mx', actual), /Solo la cuenta del CIAD/);
  assert.doesNotThrow(() => P.validarUsuarios_([sinAdmin], fija, actual));
});
