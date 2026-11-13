/**
 * @fileoverview Usuarios del Panel CIAD y sus avisos (pestaña "Usuarios", solo administradores).
 * @author APONTE
 * Capa: Modelo. Define quién abre el panel, quién lo administra y qué avisos por correo recibe cada quien.
 *
 * Se guarda en la propiedad del script USUARIOS_PANEL:
 *   [{ correo, nombre, admin, avisos: { solicitudes, articulos, comentarios } }]
 * La primera vez se crea con CONFIG.ACCESO_PANEL: todos como administradores y con todos los avisos.
 *
 * IMPORTANTE: las cuentas de CONFIG.CUENTAS_CIAD siempre son administradoras y no se pueden quitar,
 * para que nadie deje al CIAD fuera de su propio panel. Solo esas cuentas deciden quién es
 * administrador (dar, quitar o sacar de la lista a un administrador); los demás administradores
 * manejan todo lo demás.
 */

const AREAS_AVISO_ = ['solicitudes', 'articulos', 'comentarios'];
const CLAVE_USUARIOS_ = 'USUARIOS_PANEL';
let USUARIOS_MEMORIA_ = null; // OPT: una sola lectura por ejecución (exigirAcceso_ se llama en cada función)

function usuariosPanel_() {
  if (USUARIOS_MEMORIA_) return USUARIOS_MEMORIA_;
  const guardado = PropertiesService.getScriptProperties().getProperty(CLAVE_USUARIOS_);
  let lista = null;
  try { lista = guardado ? JSON.parse(guardado) : null; } catch (err) { console.error('USUARIOS_PANEL dañada; se usa CONFIG.ACCESO_PANEL: ' + err.message); }
  if (!Array.isArray(lista)) lista = CONFIG.ACCESO_PANEL.map(function (c) {
    return { correo: c.trim().toLowerCase(), nombre: '', admin: true, avisos: { solicitudes: true, articulos: true, comentarios: true } };
  });
  USUARIOS_MEMORIA_ = conCuentasCiad_(lista);
  return USUARIOS_MEMORIA_;
}

/** Agrega las cuentas del CIAD si faltan y las deja siempre como administradoras. */
function conCuentasCiad_(lista) {
  const fijas = CONFIG.CUENTAS_CIAD.map(function (c) { return c.trim().toLowerCase(); });
  fijas.forEach(function (c) {
    if (!lista.some(function (u) { return u.correo === c; })) {
      lista.unshift({ correo: c, nombre: 'CIAD', admin: true, avisos: { solicitudes: true, articulos: true, comentarios: true } });
    }
  });
  lista.forEach(function (u) { if (fijas.indexOf(u.correo) !== -1) u.admin = true; });
  return lista;
}

function usuario_(correo) {
  const c = String(correo || '').trim().toLowerCase();
  return c ? usuariosPanel_().filter(function (u) { return u.correo === c; })[0] || null : null;
}

function puedeUsarPanel_(correo) { return !!usuario_(correo); }
function esAdmin_(correo) { const u = usuario_(correo); return !!(u && u.admin); }
function esCuentaFija_(correo) { return CONFIG.CUENTAS_CIAD.some(function (c) { return c.trim().toLowerCase() === String(correo || '').trim().toLowerCase(); }); }

function exigirAdmin_() {
  if (!esAdmin_(Session.getActiveUser().getEmail())) throw new Error('Solo los administradores del panel pueden ver y cambiar los usuarios.');
}

/** Correos (separados por coma) de quienes reciben los avisos de un área. */
function destinatariosCiad_(area) {
  return usuariosPanel_().filter(function (u) { return u.avisos && u.avisos[area]; })
    .map(function (u) { return u.correo; }).join(',');
}

/** Datos para la pestaña Usuarios. "version" es la lista tal como está guardada; sirve para detectar cambios de otro administrador. */
function obtenerUsuarios() {
  exigirAdmin_();
  const guardado = PropertiesService.getScriptProperties().getProperty(CLAVE_USUARIOS_) || '';
  return {
    usuarios: usuariosPanel_(),
    fijas: CONFIG.CUENTAS_CIAD.map(function (c) { return c.trim().toLowerCase(); }),
    yo: String(Session.getActiveUser().getEmail() || '').toLowerCase(),
    version: guardado
  };
}

function guardarUsuarios(lista, version) {
  exigirAdmin_();
  const yo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const limpia = validarUsuarios_(lista, yo, usuariosPanel_());

  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    if ((props.getProperty(CLAVE_USUARIOS_) || '') !== String(version || '')) {
      throw new Error('Otro administrador cambió los usuarios mientras editabas. Recarga el panel (F5) y vuelve a hacer tus cambios.');
    }
    props.setProperty(CLAVE_USUARIOS_, JSON.stringify(limpia));
    USUARIOS_MEMORIA_ = null;
    compartirDestinatarios_(props); // Ver Avisos.gs: de ahí lee el Receptor a quién avisar de las solicitudes nuevas
  } finally {
    candado.releaseLock();
  }
  return obtenerUsuarios();
}

/** Valida lo que llega del navegador: forma, correos, duplicados y reglas de seguridad. */
function validarUsuarios_(lista, yo, actual) {
  if (!Array.isArray(lista) || !lista.length) throw new Error('La lista de usuarios está vacía.');
  if (lista.length > 100) throw new Error('Máximo 100 usuarios.');
  const vistos = {};
  const limpia = conCuentasCiad_(lista.map(function (u) {
    const correo = String(u && u.correo || '').trim().toLowerCase();
    if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(correo)) throw new Error('Correo no válido: "' + correo + '".');
    if (vistos[correo]) throw new Error('El correo ' + correo + ' está repetido.');
    vistos[correo] = true;
    const avisos = {};
    AREAS_AVISO_.forEach(function (a) { avisos[a] = !!(u.avisos && u.avisos[a]); });
    return { correo: correo, nombre: String(u.nombre || '').replace(/\s+/g, ' ').trim().slice(0, 80), admin: !!u.admin, avisos: avisos };
  }));
  if (!esCuentaFija_(yo)) {
    const admins = function (l) { return l.filter(function (u) { return u.admin; }).map(function (u) { return u.correo; }).sort().join(','); };
    if (admins(limpia) !== admins(actual)) {
      throw new Error('Solo la cuenta del CIAD (' + CONFIG.CUENTAS_CIAD.join(', ') + ') puede dar o quitar el rol de administrador, o quitar a un administrador de la lista.');
    }
  }
  AREAS_AVISO_.forEach(function (a) {
    if (!limpia.some(function (u) { return u.avisos[a]; })) {
      throw new Error('Nadie recibiría los avisos de ' + { solicitudes: 'solicitudes', articulos: 'artículos', comentarios: 'comentarios' }[a] + '. Deja al menos una persona.');
    }
  });
  return limpia;
}
