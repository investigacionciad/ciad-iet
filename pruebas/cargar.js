// @fileoverview Carga el código del Publicador en Node con servicios de Apps Script falsos (no se conecta a Google).
// @author APONTE
const fs = require('fs'), path = require('path'), vm = require('vm');

// Cualquier objeto de Apps Script (DriveApp.x.y, MimeType.FOLDER…) devuelve otro falso; llamarlo no hace nada
function falso(nombre) {
  return new Proxy(function () {}, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => nombre : k === 'toString' ? () => nombre : falso(nombre + '.' + String(k))),
    apply: () => falso(nombre + '()')
  });
}
const SERVICIOS = ['DriveApp', 'DocumentApp', 'SpreadsheetApp', 'FormApp', 'PropertiesService', 'ScriptApp', 'Session', 'LockService',
  'UrlFetchApp', 'Utilities', 'MailApp', 'GmailApp', 'HtmlService', 'Logger', 'CacheService', 'Drive', 'ContentService', 'MimeType'];

module.exports = function cargar() {
  const dir = path.join(__dirname, '..', 'publicador-ciad');
  const ctx = { console };
  SERVICIOS.forEach(s => { ctx[s] = falso(s); });
  vm.createContext(ctx);
  // NOTA: los const/let del nivel superior no quedan en el contexto, así que se exportan por nombre al final
  const codigo = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const nombres = [...codigo.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  vm.runInContext(codigo + '\n;this.__ = {' + [...new Set(nombres)].join(',') + '};', ctx, { filename: 'publicador' });
  return ctx.__;
};
