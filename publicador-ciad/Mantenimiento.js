/**
 * @fileoverview Mantenimiento del espacio: Drive, Blogger y Firestore.
 * @author APONTE
 * Capa: Servicio (se ejecuta desde el editor o desde la pestaña Mantenimiento del panel).
 *
 * Tres pasos, siempre en este orden:
 *   1. auditarEspacio(): no borra nada. Llena la pestaña "Mantenimiento" de la hoja de
 *      artículos con lo que sobra y el motivo.
 *   2. Un administrador revisa la pestaña y escribe "Sí" en la columna "Aplicar" de lo que
 *      quiere limpiar.
 *   3. aplicarLimpieza(): hace solo lo marcado con "Sí" y anota el resultado.
 *
 * organizarCarpetas() reúne en una carpeta las carpetas que usa el sistema. No cambia ningún ID,
 * así que el código y los enlaces siguen funcionando.
 *
 * IMPORTANTE: lo que va a la papelera de Drive se puede recuperar durante 30 días, pero borrar
 * un borrador de Blogger o un comentario de Firestore no se puede deshacer.
 */

const MANTENIMIENTO = {
  PESTANA: 'Mantenimiento',

  // Artículos eliminados del blog: días que se conserva su carpeta como respaldo
  DIAS_RESPALDO_ELIMINADOS: 0,   // 0 = se limpian siempre (ya se borran al eliminar; esto recoge los anteriores)
  // Comentarios rechazados: días después de los cuales se proponen para borrar
  DIAS_COMENTARIOS_RECHAZADOS: 90,

  // organizarCarpetas(): carpeta de Mi unidad que reúne todo lo del sistema
  CARPETA_SISTEMA: 'Blog CIAD · sistema',
  CARPETA_ARCHIVO: '99 · Archivo (revisar)',
  // Carpeta de subidas del Form de envío. Moverla dentro de Mi unidad no cambia su ID.
  // TODO: después de moverla, enviar un artículo de prueba para confirmar que las subidas siguen llegando.
  MOVER_CARPETA_DEL_FORMULARIO: true,

  // Archivos que la auditoría nunca propone limpiar (parte del nombre; no importan mayúsculas ni acentos).
  // "Demo Articulo" es la plantilla a la que enlaza el Form de envío.
  CONSERVAR: ['Demo Articulo', 'Plantilla de nota · Blog CIAD', 'Ejemplo de nota · Blog CIAD'],

  // Imágenes: el blog las muestra a 2000 px de ancho como máximo (galería ampliada); más que eso es espacio perdido.
  IMAGEN_ANCHO: 2000,
  IMAGEN_MINIMA_BYTES: 500 * 1024, // Por debajo de este tamaño no vale la pena reducir

  // Límite de seguridad: Apps Script detiene una ejecución a los 6 minutos
  TIEMPO_MAXIMO_MS: 5 * 60 * 1000
};

const COLUMNAS_MANTENIMIENTO_ = ['Aplicar', 'Categoría', 'Elemento', 'Motivo', 'Tamaño', 'Acción', 'Tipo', 'ID', 'Enlace', 'Resultado'];


// ===== 1. Auditoría (solo lectura) =====

function auditarEspacio() {
  exigirPermiso_();
  const inicio = Date.now();
  const h = [];   // hallazgos
  const propuestos = {}; // IDs que ya tienen una acción sugerida (para no repetirlos)
  const agregar = function (categoria, elemento, motivo, bytes, accion, tipo, id, enlace) {
    if (tipo !== 'info' && id) propuestos[id] = true;
    h.push(['', categoria, elemento, motivo, bytes ? tamano_(bytes) : '', accion, tipo, id || '', enlace || '', '']);
  };

  const ref = referenciasDeArticulos_();

  auditarCarpetasDeArticulos_(ref, agregar);
  auditarSubidasDelFormulario_(ref, agregar);
  auditarSinUso_(ref, agregar, propuestos);
  auditarImagenesPesadas_(agregar, propuestos);
  auditarBorradoresBlogger_(ref, agregar);
  auditarComentarios_(agregar);
  auditarRespaldos_(agregar);
  auditarDisparadores_(agregar);
  auditarPapelera_(agregar);
  const sistema = carpetaGuardada_('CARPETA_SISTEMA');
  if (sistema) agregar('Resumen', 'Espacio del blog', 'Todo lo que guarda "' + sistema.getName() + '"', tamanoCarpeta_(sistema.getId()).bytes, '—', 'info', sistema.getId(), sistema.getUrl());

  escribirInforme_(h);
  PropertiesService.getScriptProperties().setProperty('ULTIMA_AUDITORIA', fechaHoy_());
  const accionables = h.filter(function (f) { return f[6] !== 'info'; }).length;
  const mensaje = 'Auditoría lista en ' + Math.round((Date.now() - inicio) / 1000) + ' s: ' + accionables +
    ' elemento(s) con acción sugerida. Revisa la pestaña "' + MANTENIMIENTO.PESTANA + '" y marca "Sí" en lo que quieras limpiar.';
  Logger.log(mensaje);
  return mensaje;
}

/** Archivos y carpetas que usa cada fila de la hoja de artículos, y su estado. */
function referenciasDeArticulos_() {
  const A = CONFIG.COLUMNAS_ARTICULO;
  const ref = { filas: [], archivos: {}, carpetas: {}, borradores: {} };

  leerTabla_(CONFIG.HOJA_ARTICULOS_ID).forEach(function (f) {
    const estado = valor_(f, A.estado);
    const fila = {
      numero: f._fila,
      titulo: valor_(f, A.titulo) || '(sin título)',
      estado: estado,
      fechaEstado: fechaDeEstado_(estado),
      word: idsDeDrive_(valor_(f, A.documento)),
      pdfAnterior: idsDeDrive_(valor_(f, A.pdfAnterior)),
      imagenes: idsDeDrive_(valor_(f, A.imagen)).concat(idsDeDrive_(valor_(f, A.imagenAnterior))),
      pdf: (valor_(f, A.pdf).match(/\/d\/([\w-]+)/) || [])[1] || '',
      carpeta: idCarpeta_(valor_(f, A.carpeta)),
      postId: (valor_(f, A.enlace).match(/\/(\d+)\s*$/) || [])[1] || ''
    };
    ref.filas.push(fila);
    // Una copia ("Clonar") comparte archivos con su original: cuenta la fila que sigue activa, para no proponer borrarlos
    const poner = function (mapa, id) { const otra = mapa[id]; if (!otra || esRechazado_(otra.estado) || esEliminado_(otra.estado)) mapa[id] = fila; };
    fila.word.concat(fila.pdfAnterior, fila.imagenes, fila.pdf ? [fila.pdf] : []).forEach(function (id) { poner(ref.archivos, id); });
    if (fila.carpeta) poner(ref.carpetas, fila.carpeta);
    if (fila.postId && estado.indexOf('Borrador creado') === 0) ref.borradores[fila.postId] = fila;
  });
  return ref;
}

/** "Rechazado por el CIAD · 23/09/2026 14:05" → Date (o null). */
function fechaDeEstado_(estado) {
  const m = String(estado || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

function diasDesde_(fecha) {
  return fecha ? (Date.now() - fecha.getTime()) / 86400000 : 0;
}

function esRechazado_(estado) { return String(estado).indexOf('Rechazado') === 0; }
function esEliminado_(estado) { return String(estado).indexOf('Eliminado') === 0; }
function esPublicado_(estado) { return String(estado).indexOf('Publicado') === 0; }

// --- Carpetas por artículo ("Publicador CIAD · archivos del blog") ---

function auditarCarpetasDeArticulos_(ref, agregar) {
  const principal = carpetaGuardada_('CARPETA_ARCHIVOS');
  if (!principal) { agregar('Carpetas de artículos', DOCUMENTO.CARPETA_PRINCIPAL, 'No se encontró (se crea sola al recibir un artículo)', 0, '—', 'info'); return; }

  let total = 0, n = 0;
  carpetasDeArticulos_(principal.getId()).forEach(function (c) {
    const id = c.id;
    const tam = tamanoCarpeta_(id);
    const fila = ref.carpetas[id];
    total += tam.bytes; n++;

    if (!tam.archivos) {
      agregar('Carpetas de artículos', c.nombre, 'Carpeta vacía', 0, 'Papelera', 'carpeta', id, c.url);
    } else if (!fila) {
      agregar('Carpetas de artículos', c.nombre, 'Ninguna fila la usa (intento fallido, reintento o fila borrada)', tam.bytes, 'Papelera', 'carpeta', id, c.url);
    } else if (esRechazado_(fila.estado)) {
      agregar('Carpetas de artículos', c.nombre, 'Artículo rechazado (fila ' + fila.numero + ')', tam.bytes, 'Papelera', 'carpeta', id, c.url);
    } else if (esEliminado_(fila.estado) && diasDesde_(fila.fechaEstado) >= MANTENIMIENTO.DIAS_RESPALDO_ELIMINADOS) {
      agregar('Carpetas de artículos', c.nombre, 'Eliminado del blog (fila ' + fila.numero + ')', tam.bytes, 'Papelera', 'carpeta', id, c.url);
    } else if (esPublicado_(fila.estado) && fila.word.length) {
      // Publicado: solo deben quedar las imágenes; el Google Doc y el PDF de respaldo sobran.
      hijos_(id).archivos.forEach(function (f) {
        if (f.tipo === MimeType.GOOGLE_DOCS || f.tipo === MimeType.PDF) {
          agregar('Carpetas de artículos', c.nombre + ' › ' + f.nombre, 'Respaldo de un artículo ya publicado', f.bytes, 'Papelera', 'archivo', f.id, f.url);
        }
      });
    }
  });
  agregar('Carpetas de artículos', DOCUMENTO.CARPETA_PRINCIPAL, n + ' carpeta(s) en total', total, '—', 'info', principal.getId(), principal.getUrl());
}

// --- Subidas del Form de envío ("… (File responses)") ---

function auditarSubidasDelFormulario_(ref, agregar) {
  const raiz = carpetaDeSubidas_(ref);
  if (!raiz) { agregar('Subidas del formulario', '(File responses)', 'No se pudo ubicar la carpeta (ninguna fila tiene archivos)', 0, '—', 'info'); return; }

  let total = 0, n = 0;
  recorrerArchivos_(raiz.getId(), function (f, ruta) {
    const id = f.id;
    const fila = ref.archivos[id];
    const tam = f.bytes;
    total += tam; n++;
    if (seConserva_(f.nombre)) return;
    if (!fila) {
      agregar('Subidas del formulario', ruta, 'Ninguna fila lo usa (la respuesta se borró)', tam, 'Papelera', 'archivo', id, f.url);
    } else if (esRechazado_(fila.estado)) {
      agregar('Subidas del formulario', ruta, 'Artículo rechazado (fila ' + fila.numero + ')', tam, 'Papelera', 'archivo', id, f.url);
    } else if (esPublicado_(fila.estado) && fila.word.indexOf(id) !== -1) {
      agregar('Subidas del formulario', ruta, 'Word de un artículo ya publicado (la entrada no lo usa)', tam, 'Papelera', 'archivo', id, f.url);
    }
    // Las imágenes de la galería y el PDF de envíos antiguos se muestran en la entrada publicada: no se tocan.
  });
  agregar('Subidas del formulario', raiz.getName(), n + ' archivo(s) en total', total, '—', 'info', raiz.getId(), raiz.getUrl());
}

/**
 * Carpetas de artículos: las del primer nivel (en revisión) y las que están dentro de "Publicados <año>".
 * NOTA: las carpetas "Publicados <año>" no son artículos y nunca se proponen para borrar.
 */
function carpetasDeArticulos_(idPrincipal) {
  const lista = [];
  hijos_(idPrincipal).carpetas.forEach(function (c) {
    if (/^Publicados \d{4}$/.test(c.nombre)) lista.push.apply(lista, hijos_(c.id).carpetas);
    else if (CARPETAS_DEL_PANEL_.indexOf(c.nombre) === -1) lista.push(c); // Las del panel tienen imágenes que el blog muestra
  });
  return lista;
}

/** Carpeta "… (File responses)" del Form 2, a partir de un archivo subido. */
function carpetaDeSubidas_(ref) {
  for (let i = 0; i < ref.filas.length; i++) {
    const fila = ref.filas[i];
    const ids = fila.word.concat(fila.imagenes, fila.pdfAnterior);
    for (let j = 0; j < ids.length; j++) {
      try {
        const padres = DriveApp.getFileById(ids[j]).getParents();
        if (!padres.hasNext()) continue;
        const pregunta = padres.next();               // "<Pregunta> (File responses)"
        const abuelos = pregunta.getParents();
        if (abuelos.hasNext()) {
          const raiz = abuelos.next();                // "<Formulario> (File responses)"
          if (/file responses|respuestas/i.test(raiz.getName())) return raiz;
        }
        return pregunta;
      } catch (err) { /* El archivo ya se borró: se prueba con el siguiente */ }
    }
  }
  return null;
}

// --- Archivos que el blog ya no muestra (revisión estricta) ---

/**
 * Recorre todo "Blog CIAD · sistema" y propone los archivos que no muestra ninguna entrada, página
 * ni el diseño del blog.
 * IMPORTANTE: nunca toca los archivos de un artículo en proceso, los respaldos de páginas,
 * formularios, hojas ni lo que está en MANTENIMIENTO.CONSERVAR.
 */
function auditarSinUso_(ref, agregar, propuestos) {
  const CATEGORIA = 'Sin uso en el blog';
  const sistema = carpetaGuardada_('CARPETA_SISTEMA');
  if (!sistema) return;
  let uso;
  try { uso = idsUsadosEnElBlog_(); } catch (err) {
    agregar(CATEGORIA, 'Contenido del blog', 'No se pudo leer (' + err.message + '); por seguridad no se propone nada', 0, '—', 'info'); return;
  }
  // IMPORTANTE: si no se leyó ninguna nota, todo parecería "sin uso"
  if (!uso.notas) { agregar(CATEGORIA, 'Contenido del blog', 'No se leyó ninguna nota; por seguridad no se propone nada', 0, '—', 'info'); return; }

  const respaldos = PropertiesService.getScriptProperties().getProperty('CARPETA_RESPALDOS');
  const tiposProtegidos = [MimeType.GOOGLE_FORMS, MimeType.GOOGLE_SHEETS, MimeType.GOOGLE_APPS_SCRIPT];
  let n = 0, bytes = 0;
  const recorrer = function (idCarpeta, ruta, enProceso) {
    if (idCarpeta === respaldos || propuestos[idCarpeta]) return;
    const fila = ref.carpetas[idCarpeta];
    if (fila && enProceso_(fila.estado)) enProceso = true;
    const h = hijos_(idCarpeta);
    h.archivos.forEach(function (f) {
      const filaArchivo = ref.archivos[f.id];
      if (enProceso || uso.usados[f.id] || propuestos[f.id] || seConserva_(f.nombre) ||
          tiposProtegidos.indexOf(f.tipo) !== -1 || (filaArchivo && enProceso_(filaArchivo.estado))) return;
      n++; bytes += f.bytes;
      agregar(CATEGORIA, ruta + f.nombre, 'Ninguna nota, página ni el diseño del blog lo muestra', f.bytes, 'Papelera', 'archivo', f.id, f.url);
    });
    h.carpetas.forEach(function (c) { recorrer(c.id, ruta + c.nombre + ' › ', enProceso); });
  };
  recorrer(sistema.getId(), '', false);
  agregar(CATEGORIA, 'Revisión estricta', uso.notas + ' nota(s) y ' + uso.paginas + ' página(s) leídas; ' + n + ' archivo(s) sin uso', bytes, '—', 'info');
}

/** IDs de Drive que se muestran en las entradas (publicadas, borradores, programadas), las páginas y el diseño. */
function idsUsadosEnElBlog_() {
  const usados = {};
  const anotar = function (html) {
    String(html || '').replace(/(?:[?&]id=|\/d\/)([\w-]{25,})/g, function (_, id) { usados[id] = true; });
  };
  let token = '', notas = 0;
  do {
    const r = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts?status=live&status=draft&status=scheduled&view=ADMIN&fetchBodies=true&maxResults=50&fields=nextPageToken,items(content)' + (token ? '&pageToken=' + token : ''));
    (r.items || []).forEach(function (p) { notas++; anotar(p.content); });
    token = r.nextPageToken || '';
  } while (token);
  const paginas = (blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/pages?status=live&status=draft&view=ADMIN&fetchBodies=true&fields=items(content)').items || []);
  paginas.forEach(function (p) { anotar(p.content); });
  anotar(UrlFetchApp.fetch(CONFIG.CORREO.blog, { muteHttpExceptions: true }).getContentText()); // El diseño (logos, banners)
  return { usados: usados, notas: notas, paginas: paginas.length };
}

/** Artículo que aún no termina (recibido, en revisión, borrador): sus archivos no se tocan. */
function enProceso_(estado) { return !esPublicado_(estado) && !esRechazado_(estado) && !esEliminado_(estado); }

// --- Imágenes más grandes de lo que el blog muestra ---

function auditarImagenesPesadas_(agregar, propuestos) {
  const sistema = carpetaGuardada_('CARPETA_SISTEMA');
  if (!sistema) return;
  let n = 0, bytes = 0;
  recorrerArchivos_(sistema.getId(), function (f, ruta) {
    if (propuestos[f.id] || !esImagenReducible_(f.tipo, f.bytes)) return;
    // TODO: el ahorro se estima en 80 % (el real se conoce al reducir); medirlo obligaría a descargar cada miniatura al revisar
    const ahorro = Math.round(f.bytes * 0.8);
    n++; bytes += ahorro;
    agregar('Imágenes pesadas', ruta, 'Pesa ' + tamano_(f.bytes) + '; se guarda a ' + MANTENIMIENTO.IMAGEN_ANCHO + ' px (lo máximo que muestra el blog). Mismo enlace, la nota no cambia', ahorro, 'Reducir', 'imagen', f.id, f.url);
  });
  agregar('Imágenes pesadas', 'Imágenes', n + ' imagen(es) se pueden reducir (≈ ' + tamano_(bytes) + ')', 0, '—', 'info');
}

function esImagenReducible_(tipo, bytes) {
  // GIF y WebP no se incluyen: pueden ser animados y la miniatura perdería la animación
  return /^image\/(jpeg|png)$/.test(tipo) && bytes >= MANTENIMIENTO.IMAGEN_MINIMA_BYTES;
}

/**
 * Reemplaza el contenido de la imagen por su miniatura de IMAGEN_ANCHO px (la genera Drive).
 * Mantiene el ID, así que las notas la siguen mostrando. La versión anterior queda en el
 * historial de Drive y Google la borra a los 30 días.
 * Devuelve los bytes liberados (0 si no convenía o la miniatura aún no está lista).
 */
function reducirImagen_(f) {
  if (!esImagenReducible_(f.getMimeType(), f.getSize())) return 0;
  const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w' + MANTENIMIENTO.IMAGEN_ANCHO,
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return 0;
  const blob = r.getBlob();
  if (!/^image\//.test(blob.getContentType() || '')) return 0; // Drive respondió otra cosa (por ejemplo, una página de error)
  const ahorro = f.getSize() - blob.getBytes().length;
  if (ahorro < f.getSize() * 0.2) return 0; // Ya era ligera
  Drive.Files.update({ mimeType: blob.getContentType() }, f.getId(), blob);
  return ahorro;
}

// --- Blogger ---

function auditarBorradoresBlogger_(ref, agregar) {
  let token = '', n = 0;
  do {
    const r = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts?status=draft&view=ADMIN&fetchBodies=false&maxResults=100' + (token ? '&pageToken=' + token : ''));
    (r.items || []).forEach(function (p) {
      n++;
      const delSistema = (p.labels || []).indexOf(CONFIG.ETIQUETAS_FIJAS[0]) !== -1;
      if (delSistema && !ref.borradores[p.id]) {
        agregar('Blogger', p.title || '(sin título)', 'Borrador del Publicador que ninguna fila "Borrador creado" usa', 0, 'Eliminar (sin deshacer)', 'borrador', p.id,
          'https://www.blogger.com/blog/post/edit/' + CONFIG.BLOG_ID + '/' + p.id);
      }
    });
    token = r.nextPageToken || '';
  } while (token);
  agregar('Blogger', 'Borradores', n + ' borrador(es) en total (los hechos a mano no se tocan)', 0, '—', 'info');
}

// --- Firestore (comentarios) ---

function auditarComentarios_(agregar) {
  let rechazados;
  try { rechazados = consultarPorEstado_('rechazado'); } catch (err) {
    agregar('Comentarios', 'Firestore', 'No se pudo consultar: ' + err.message, 0, '—', 'info'); return;
  }
  let viejos = 0;
  rechazados.forEach(function (c) {
    const fecha = c.moderadoEn ? new Date(c.moderadoEn) : null;
    if (diasDesde_(fecha) > MANTENIMIENTO.DIAS_COMENTARIOS_RECHAZADOS) {
      viejos++;
      agregar('Comentarios', String(c.nombre || 'Anónimo') + ': ' + String(c.texto || '').slice(0, 60),
        'Rechazado hace más de ' + MANTENIMIENTO.DIAS_COMENTARIOS_RECHAZADOS + ' días', 0, 'Eliminar (sin deshacer)', 'comentario', c.id, c.postUrl || '');
    }
  });
  agregar('Comentarios', 'Rechazados', rechazados.length + ' en total, ' + viejos + ' con más de ' + MANTENIMIENTO.DIAS_COMENTARIOS_RECHAZADOS + ' días', 0, '—', 'info');
}

// --- Respaldos de páginas, disparadores y papelera ---

function auditarRespaldos_(agregar) {
  const c = carpetaGuardada_('CARPETA_RESPALDOS');
  if (!c) return;
  const tam = tamanoCarpeta_(c.getId());
  agregar('Respaldos de páginas', c.getName(), tam.archivos + ' respaldo(s); se conservan los últimos ' + RESPALDOS_.POR_PAGINA + ' por página automáticamente', tam.bytes, '—', 'info', c.getId(), c.getUrl());
}

function auditarDisparadores_(agregar) {
  const vistos = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const nombre = t.getHandlerFunction();
    const clave = nombre + '|' + t.getEventType();
    if (vistos[clave]) {
      agregar('Disparadores', nombre, 'Repetido: se ejecuta dos veces por cada evento. Ejecuta instalar() para dejar uno solo', 0, '—', 'info');
    }
    vistos[clave] = true;
  });
  if (vistos['alRecibirSolicitud|' + ScriptApp.EventType.ON_FORM_SUBMIT]) {
    agregar('Disparadores', 'alRecibirSolicitud', 'Si el Form de solicitud ya no acepta respuestas (el Receptor lo reemplazó), este disparador sobra', 0, '—', 'info');
  }
}

function auditarPapelera_(agregar) {
  let n = 0, bytes = 0, token;
  do { // Solo se suma el tamaño: no se abre ni se modifica nada
    const p = Drive.Files.list({ q: "trashed = true and 'me' in owners", pageSize: 1000, pageToken: token, fields: 'nextPageToken,files(size)' });
    (p.files || []).forEach(function (f) { n++; bytes += Number(f.size || 0); });
    token = p.nextPageToken;
  } while (token && n < 5000);
  agregar('Papelera de Drive', 'Papelera', n + (n >= 5000 ? '+' : '') + ' archivo(s). Google los borra solos a los 30 días; todavía cuentan en el espacio', bytes, '—', 'info');
}


// ===== 2. Aplicar lo marcado con "Sí" =====

function aplicarLimpieza() {
  exigirPermiso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const hoja = SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID).getSheetByName(MANTENIMIENTO.PESTANA);
    if (!hoja || hoja.getLastRow() < 2) throw new Error('Primero ejecuta auditarEspacio().');
    const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS_MANTENIMIENTO_.length).getValues();
    const inicio = Date.now();
    let hechos = 0, errores = 0, pendientes = 0;

    for (let i = 0; i < valores.length; i++) {
      const [aplicar, , , , , accion, tipo, id, , resultado] = valores[i];
      if (normalizar_(aplicar) !== 'si' || resultado || !id) continue;
      if (Date.now() - inicio > MANTENIMIENTO.TIEMPO_MAXIMO_MS) { pendientes++; continue; }

      let texto;
      try {
        texto = aplicarUno_(tipo, String(accion), String(id));
        hechos++;
      } catch (err) {
        texto = 'Error: ' + err.message;
        errores++;
      }
      hoja.getRange(i + 2, COLUMNAS_MANTENIMIENTO_.length).setValue(texto + ' · ' + fechaHoy_());
    }

    const mensaje = 'Limpieza: ' + hechos + ' hecho(s), ' + errores + ' error(es)' +
      (pendientes ? ', ' + pendientes + ' pendiente(s): ejecuta aplicarLimpieza() otra vez' : '') + '.';
    Logger.log(mensaje);
    return mensaje;
  } finally {
    bloqueo.releaseLock();
  }
}

function aplicarUno_(tipo, accion, id) {
  if (tipo === 'archivo' && accion === 'Papelera') {
    const f = DriveApp.getFileById(id);
    if (seConserva_(f.getName())) return 'No se tocó: está en MANTENIMIENTO.CONSERVAR';
    f.setTrashed(true); return 'En la papelera';
  }
  if (tipo === 'imagen') {
    const ahorro = reducirImagen_(DriveApp.getFileById(id));
    return ahorro ? 'Reducida: ' + tamano_(ahorro) + ' menos' : 'Sin cambio (ya era ligera o Drive aún no tiene la miniatura)';
  }
  if (tipo === 'carpeta' && accion === 'Papelera') { DriveApp.getFolderById(id).setTrashed(true); return 'En la papelera'; }
  if (tipo === 'borrador') {
    const p = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + id + '?view=ADMIN&fetchBody=false');
    if (p.status && p.status !== 'DRAFT') throw new Error('ya no es borrador (' + p.status + '); no se borró');
    blogger_('DELETE', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + id);
    return 'Borrador eliminado';
  }
  if (tipo === 'comentario') { firestore_('DELETE', '/' + PANEL.COLECCION_COMENTARIOS + '/' + encodeURIComponent(id)); return 'Comentario eliminado'; }
  throw new Error('acción desconocida');
}


// ===== 3. Organizar carpetas (mover no cambia IDs ni enlaces) =====

/** Muestra qué movería organizarCarpetas(), sin mover nada. */
function verPlanDeCarpetas() {
  exigirPermiso_();
  const plan = planDeCarpetas_();
  Logger.log('Se moverían a "' + MANTENIMIENTO.CARPETA_SISTEMA + '":\n' +
    (plan.length ? plan.map(function (p) { return '  · ' + p.nombre + (p.tipo === 'folder' ? '/' : ''); }).join('\n') : '  (nada: ya está organizado)'));
}

/** Reúne en "Blog CIAD · sistema" (Mi unidad) todo lo que usa el sistema. */
function organizarCarpetas() {
  exigirPermiso_();
  const destino = carpetaSistema_();
  const plan = planDeCarpetas_();
  plan.forEach(function (p) {
    (p.tipo === 'folder' ? DriveApp.getFolderById(p.id) : DriveApp.getFileById(p.id)).moveTo(destino);
  });
  carpetaArchivo_(); // Deja creada la carpeta de archivo
  Logger.log('Listo: ' + plan.length + ' elemento(s) movidos a "' + destino.getName() + '" (' + destino.getUrl() + ').');
}

function planDeCarpetas_() {
  const destino = carpetaSistema_();
  const plan = [];
  const agregar = function (elemento, tipo) {
    if (!elemento) return;
    const padres = elemento.getParents();
    if (padres.hasNext() && padres.next().getId() === destino.getId()) return; // Ya está ahí
    plan.push({ id: elemento.getId(), nombre: elemento.getName(), tipo: tipo });
  };
  agregar(carpetaGuardada_('CARPETA_ARCHIVOS'), 'folder');
  agregar(carpetaGuardada_('CARPETA_RESPALDOS'), 'folder');
  if (MANTENIMIENTO.MOVER_CARPETA_DEL_FORMULARIO) agregar(carpetaDeSubidas_(referenciasDeArticulos_()), 'folder');

  // El Form de envío (un formulario con preguntas de subir archivo no puede estar en una unidad compartida)
  try {
    const url = SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID).getFormUrl();
    const id = (String(url || '').match(/\/d\/(?:e\/)?([\w-]+)/) || [])[1];
    if (id) {
      const form = DriveApp.getFileById(id);
      if (form.getOwner() && form.getOwner().getEmail() === Session.getEffectiveUser().getEmail()) agregar(form, 'file');
    }
  } catch (err) { console.warn('Form de envío: ' + err.message); }
  return plan;
}


/**
 * ===== 3b. Ordenar los artículos ya publicados (una sola vez) =====
 * Pasa cada artículo publicado a "Publicados <año>/<folio · título>" con todas sus imágenes
 * (Word y galería). Es lo mismo que ahora se hace automáticamente al publicar.
 */

function ordenarPublicados() {
  exigirPermiso_();
  const A = CONFIG.COLUMNAS_ARTICULO, X = PANEL.ARTICULO;
  const inicio = Date.now();
  let hechos = 0, pendientes = 0;
  leerTabla_(CONFIG.HOJA_ARTICULOS_ID).forEach(function (f) {
    if (!esPublicado_(valor_(f, A.estado)) || !valor_(f, A.carpeta)) return;
    if (valor_(f, X.clonDe)) return; // Una copia usa la carpeta de su original: la ordena la original
    if (Date.now() - inicio > MANTENIMIENTO.TIEMPO_MAXIMO_MS) { pendientes++; return; }
    const datos = {};
    camposDeArchivo_().forEach(function (k) { datos[k] = valor_(f, k); });
    try { if (archivarPublicado_(datos)) hechos++; } catch (err) { console.warn('Fila ' + f._fila + ': ' + err.message); }
  });
  const mensaje = hechos + ' artículo(s) publicados ordenados' + (pendientes ? '; faltan ' + pendientes + ', ejecuta otra vez' : '') + '.';
  Logger.log(mensaje);
  return mensaje;
}


/**
 * ===== 3c. Prueba: ¿se pueden guardar las imágenes en la unidad compartida? =====
 * Se ejecuta desde el editor y no mueve nada. Copia una imagen del blog a la unidad compartida,
 * la comparte con enlace, prueba si alguien sin sesión (como un lector del blog) la puede ver
 * y envía la copia a la papelera.
 */

const UNIDAD_COMPARTIDA_ = 'CIAD I&D';

function probarUnidadCompartida() {
  exigirPermiso_();
  const L = [], linea = function (t) { L.push(t); };
  const enTodas = { supportsAllDrives: true };

  const cuota = Drive.About.get({ fields: 'storageQuota' }).storageQuota;
  // NOTA: con espacio compartido de la institución, Google devuelve las cifras de toda la UABC, no las de esta cuenta
  linea('Espacio compartido de la institución: ' + tamano_(Number(cuota.usage || 0)) + ' usados' +
    (cuota.limit ? ' de ' + tamano_(Number(cuota.limit)) + ' (' + (Number(cuota.usage) / Number(cuota.limit) * 100).toFixed(1) + ' %)' : ' (sin límite)'));

  // Se compara sin espacios, acentos ni signos: "CIAD I&D", "CIAD I + D" y "ciad i&d" son la misma
  const clave = function (n) { return normalizar_(n).replace(/[^a-z0-9]/g, ''); };
  const unidades = Drive.Drives.list({ pageSize: 100, fields: 'drives(id,name)' }).drives || [];
  const unidad = unidades.filter(function (d) { return clave(d.name) === clave(UNIDAD_COMPARTIDA_); })[0];
  if (!unidad) {
    linea('✘ Esta cuenta no ve la unidad compartida "' + UNIDAD_COMPARTIDA_ + '". Unidades que sí ve: ' +
      (unidades.length ? unidades.map(function (d) { return '"' + d.name + '"'; }).join(', ') : 'ninguna (la cuenta no es miembro de ninguna unidad compartida)'));
    return fin_(L);
  }
  const r = Drive.Drives.get(unidad.id, { fields: 'restrictions' }).restrictions || {};
  linea('Unidad "' + UNIDAD_COMPARTIDA_ + '": ' + (r.domainUsersOnly ? 'SOLO personas de la UABC (los lectores del blog no verían las imágenes)' : 'permite compartir fuera de la UABC') +
    (r.driveMembersOnly ? '; solo sus miembros' : ''));

  // Una imagen que el blog ya muestra: las de las notas están en subcarpetas (Publicados <año>/…/Imágenes, Imágenes principales)
  const archivos = carpetaGuardada_('CARPETA_ARCHIVOS');
  let original = null;
  if (archivos) recorrerArchivos_(archivos.getId(), function (f) { if (!original && /^image\/(jpeg|png)$/.test(f.tipo)) original = f; });
  if (!original) { linea('✘ No encontré una imagen JPG o PNG del blog para probar.'); return fin_(L); }

  // Control: la imagen como la ve hoy un lector (si esto falla, la prueba no sirve)
  linea('Control (Mi unidad, "' + original.nombre + '"): ' + (sinSesionSeVe_(original.id) ? '✔ se ve sin sesión' : '✘ NO se ve sin sesión: prueba no concluyente'));

  let copia;
  try {
    copia = Drive.Files.copy({ name: 'Prueba del Publicador · se borra sola', parents: [unidad.id] }, original.id, enTodas);
  } catch (err) { linea('✘ No se pudo copiar a la unidad (¿la cuenta puede agregar archivos ahí?): ' + err.message); return fin_(L); }
  try {
    try {
      Drive.Permissions.create({ role: 'reader', type: 'anyone' }, copia.id, enTodas);
      linea('✔ Se pudo compartir con "cualquier persona con el enlace".');
    } catch (err) { linea('✘ La unidad no deja compartir con enlace público: ' + err.message); }
    linea('Copia en la unidad: ' + (sinSesionSeVe_(copia.id) ? '✔ se ve sin sesión → las imágenes del blog SÍ pueden vivir ahí' : '✘ NO se ve sin sesión → las imágenes del blog deben quedarse en Mi unidad'));
  } finally {
    try { Drive.Files.update({ trashed: true }, copia.id, null, enTodas); linea('La copia de prueba se mandó a la papelera de la unidad.'); }
    catch (err) { linea('⚠ No se pudo mandar la copia a la papelera; bórrala a mano: "Prueba del Publicador · se borra sola". (' + err.message + ')'); }
  }
  return fin_(L);
}

/** ¿Alguien sin sesión ve la miniatura tal como la pide el blog? Drive tarda unos segundos en generarla para un archivo nuevo. */
function sinSesionSeVe_(id) {
  for (let i = 0; i < 6; i++) {
    const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + id + '&sz=w400', { muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() === 200 && /^image\//.test(r.getBlob().getContentType() || '')) return true;
    Utilities.sleep(5000);
  }
  return false;
}

function fin_(lineas) { const t = lineas.join('\n'); Logger.log(t); return t; }


/**
 * ===== 4. Diagnóstico: qué está conectado con qué (solo lectura) =====
 * Se ejecuta desde el editor; luego se copia el "Registro de ejecución".
 */

function diagnosticarConexiones() {
  exigirPermiso_();
  const L = [];
  const linea = function (t) { L.push(t); };
  const opcionales = ['cargo', 'resumen', 'palabrasClave', 'pdfAnterior', 'imagenAnterior', 'correo', 'subtitulo', 'imagen',
    'unidad', 'programa', 'organizacion', 'vinculo', 'categoria'];

  // 1. Hojas, sus pestañas, columnas y formulario vinculado
  [['HOJA DE SOLICITUDES', CONFIG.HOJA_SOLICITUDES_ID, CONFIG.COLUMNAS_SOLICITUD],
   ['HOJA DE ARTÍCULOS', CONFIG.HOJA_ARTICULOS_ID, CONFIG.COLUMNAS_ARTICULO]].forEach(function (h) {
    try {
      const libro = SpreadsheetApp.openById(h[1]);
      linea('■ ' + h[0] + ': "' + libro.getName() + '"');
      linea('   ' + libro.getUrl());
      linea('   Pestañas: ' + libro.getSheets().map(function (p, i) {
        return (i === 0 ? '[1ª: la que usa el script] ' : '') + p.getName() + ' (' + Math.max(0, p.getLastRow() - 1) + ' filas)';
      }).join(' · '));
      const form = libro.getFormUrl();
      linea('   Google Form vinculado: ' + (form ? form + ' → ' + estadoFormulario_(form) : 'ninguno'));

      const hoja = libro.getSheets()[0];
      const col = columnas_(hoja);
      const faltan = Object.keys(h[2]).filter(function (k) { return !col[h[2][k]]; });
      const graves = faltan.filter(function (k) { return opcionales.indexOf(k) === -1; });
      linea('   Columnas que el script necesita y NO encuentra: ' + (graves.length ? graves.map(function (k) { return '"' + h[2][k] + '"'; }).join(', ') : 'ninguna ✔'));
      if (faltan.length > graves.length) linea('   Columnas opcionales ausentes (no pasa nada): ' + faltan.filter(function (k) { return graves.indexOf(k) === -1; }).map(function (k) { return '"' + h[2][k] + '"'; }).join(', '));

      const fechas = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().map(function (f) { return f[0]; }).filter(function (v) { return v instanceof Date; }) : [];
      const ultima = fechas.length ? new Date(Math.max.apply(null, fechas)) : null;
      linea('   Última respuesta: ' + (ultima ? Utilities.formatDate(ultima, 'America/Tijuana', 'dd/MM/yyyy HH:mm') : '—'));
    } catch (err) {
      linea('■ ' + h[0] + ': NO SE PUDO ABRIR (' + err.message + ')');
    }
  });

  // 2. Páginas de Blogger: a dónde envían sus formularios HTML
  linea('■ PÁGINAS DE BLOGGER QUE ENVÍAN DATOS');
  try {
    const paginas = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/pages?status=live&fetchBodies=true').items || [];
    let alguna = false;
    paginas.forEach(function (p) {
      const html = String(p.content || '');
      const scripts = unicos_(html.match(/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/g));
      const forms = unicos_(html.match(/https:\/\/docs\.google\.com\/forms\/[^"'\s<>)]+/g));
      if (!scripts.length && !forms.length) return;
      alguna = true;
      linea('   "' + p.title + '" (' + p.url + ')');
      scripts.forEach(function (u) { linea('      → Apps Script: ' + u + (u === urlPropia_() ? '  (es el Panel/Publicador)' : '  (compárala con la URL del Receptor)')); });
      forms.forEach(function (u) { linea('      → Google Form: ' + u + (/formResponse/.test(u) ? '  (envía respuestas al Form)' : '  (enlace al Form)')); });
    });
    if (!alguna) linea('   Ninguna página tiene enlaces a Apps Script ni a Google Forms (pueden estar en el tema; revisa Tema → Editar HTML).');
  } catch (err) {
    linea('   No se pudieron leer las páginas: ' + err.message);
  }

  // 3. Disparadores
  linea('■ DISPARADORES DE ESTE PROYECTO');
  const nombres = {};
  [CONFIG.HOJA_SOLICITUDES_ID, CONFIG.HOJA_ARTICULOS_ID].forEach(function (id) {
    try { nombres[id] = SpreadsheetApp.openById(id).getName(); } catch (err) { nombres[id] = id; }
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const origen = t.getTriggerSourceId ? t.getTriggerSourceId() : '';
    linea('   ' + t.getHandlerFunction() + ' · ' + t.getEventType() + (origen ? ' · ' + (nombres[origen] || origen) : ''));
  });

  linea('■ REVISAR A MANO (Google no lo expone al script)');
  linea('   En cada hoja: Extensiones → Apps Script. Si abre un proyecto vacío ("Código.gs" sin funciones), la hoja no tiene macros propias.');

  const texto = L.join('\n');
  Logger.log(texto);
  return texto;
}

/** ¿El Form acepta respuestas? Se consulta su página pública. */
function estadoFormulario_(url) {
  try {
    const r = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
    const destino = String((r.getHeaders() || {}).Location || '');
    const html = r.getContentText();
    if (/closedform/.test(destino) || /closedform|ya no acepta respuestas|no longer accepting responses/i.test(html)) return 'CERRADO (no acepta respuestas)';
    if (r.getResponseCode() === 200 && /formResponse/.test(html)) return 'ABIERTO (acepta respuestas)';
    return 'no se pudo saber (ábrelo: pestaña Respuestas → "Aceptar respuestas")';
  } catch (err) {
    return 'no se pudo saber (' + err.message + ')';
  }
}

function urlPropia_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

function unicos_(lista) {
  return (lista || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
}


/**
 * ===== 5. Mantenimiento desde el panel (pestaña "Mantenimiento") =====
 * Para que los administradores no tengan que abrir el editor ni la hoja.
 */

function obtenerMantenimiento() {
  exigirAcceso_();
  const hoja = SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID).getSheetByName(MANTENIMIENTO.PESTANA);
  const fecha = PropertiesService.getScriptProperties().getProperty('ULTIMA_AUDITORIA') || '';
  if (!hoja || hoja.getLastRow() < 2) return { fecha: fecha, filas: [] };
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS_MANTENIMIENTO_.length).getDisplayValues();
  return {
    fecha: fecha,
    filas: valores.map(function (v, i) {
      return { fila: i + 2, categoria: v[1], elemento: v[2], motivo: v[3], tamano: v[4], accion: v[5], tipo: v[6], enlace: v[8], resultado: v[9] };
    })
  };
}

function auditarDesdePanel() {
  exigirAcceso_();
  const mensaje = auditarEspacio();
  return { mensaje: mensaje, datos: obtenerMantenimiento() };
}

/** filas: números de fila de la pestaña Mantenimiento que eligió el administrador. */
function aplicarDesdePanel(filas) {
  exigirAcceso_();
  const hoja = SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID).getSheetByName(MANTENIMIENTO.PESTANA);
  if (!hoja) throw new Error('Primero revisa el espacio.');
  const ultima = hoja.getLastRow();
  (filas || []).map(Number).filter(function (n) { return n >= 2 && n <= ultima; }).forEach(function (n) {
    if (hoja.getRange(n, 7).getValue() !== 'info') hoja.getRange(n, 1).setValue('Sí');
  });
  const mensaje = aplicarLimpieza();
  return { mensaje: mensaje, datos: obtenerMantenimiento() };
}

function ordenarDesdePanel() {
  exigirAcceso_();
  return ordenarPublicados();
}


// ===== Funciones auxiliares =====

function seConserva_(nombre) {
  const n = normalizar_(nombre);
  return MANTENIMIENTO.CONSERVAR.some(function (c) { return n.indexOf(normalizar_(c)) !== -1; });
}

function carpetaGuardada_(propiedad) {
  const id = PropertiesService.getScriptProperties().getProperty(propiedad);
  if (!id) return null;
  try { const c = DriveApp.getFolderById(id); return c.isTrashed() ? null : c; } catch (err) { return null; }
}

function carpetaSistema_() {
  const props = PropertiesService.getScriptProperties();
  let c = carpetaGuardada_('CARPETA_SISTEMA');
  if (!c) {
    c = DriveApp.createFolder(MANTENIMIENTO.CARPETA_SISTEMA);
    props.setProperty('CARPETA_SISTEMA', c.getId());
  }
  return c;
}

function carpetaArchivo_() {
  const sistema = carpetaSistema_();
  const it = sistema.getFoldersByName(MANTENIMIENTO.CARPETA_ARCHIVO);
  return it.hasNext() ? it.next() : sistema.createFolder(MANTENIMIENTO.CARPETA_ARCHIVO);
}

/** { bytes, archivos } de una carpeta y sus subcarpetas. */
function tamanoCarpeta_(idCarpeta) {
  const r = { bytes: 0, archivos: 0 };
  recorrerArchivos_(idCarpeta, function (f) { r.bytes += f.bytes; r.archivos++; });
  return r;
}

/** Llama a fn({ id, nombre, tipo, bytes, url }, ruta) por cada archivo de la carpeta y sus subcarpetas. */
function recorrerArchivos_(idCarpeta, fn, ruta) {
  const base = ruta ? ruta + ' › ' : '';
  const h = hijos_(idCarpeta);
  h.archivos.forEach(function (f) { fn(f, base + f.nombre); });
  h.carpetas.forEach(function (c) { recorrerArchivos_(c.id, fn, base + c.nombre); });
}

/**
 * Contenido directo de una carpeta (sin la papelera).
 * OPT: una consulta a Drive por carpeta y por ejecución; la revisión pasa varias veces por las
 * mismas carpetas y así no se hace una llamada por archivo.
 */
const HIJOS_ = {};
function hijos_(idCarpeta) {
  if (HIJOS_[idCarpeta]) return HIJOS_[idCarpeta];
  const r = { archivos: [], carpetas: [] };
  let token;
  do {
    const p = Drive.Files.list({ q: "'" + idCarpeta + "' in parents and trashed = false", pageSize: 1000, pageToken: token,
      fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink)', supportsAllDrives: true, includeItemsFromAllDrives: true });
    (p.files || []).forEach(function (f) {
      if (f.mimeType === MimeType.FOLDER) r.carpetas.push({ id: f.id, nombre: f.name, url: f.webViewLink });
      else r.archivos.push({ id: f.id, nombre: f.name, tipo: f.mimeType, bytes: Number(f.size || 0), url: f.webViewLink });
    });
    token = p.nextPageToken;
  } while (token);
  return (HIJOS_[idCarpeta] = r);
}

function tamano_(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function escribirInforme_(filas) {
  const libro = SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID);
  let hoja = libro.getSheetByName(MANTENIMIENTO.PESTANA);
  if (!hoja) hoja = libro.insertSheet(MANTENIMIENTO.PESTANA, libro.getSheets().length); // Al final: la primera sigue siendo la de respuestas
  hoja.clear();
  hoja.getRange(1, 1, 1, COLUMNAS_MANTENIMIENTO_.length).setValues([COLUMNAS_MANTENIMIENTO_]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (filas.length) {
    // Primero lo que tiene acción, después lo informativo
    filas.sort(function (a, b) { return (a[6] === 'info') - (b[6] === 'info'); });
    hoja.getRange(2, 1, filas.length, COLUMNAS_MANTENIMIENTO_.length).setValues(filas);
    const accionables = filas.filter(function (f) { return f[6] !== 'info'; }).length;
    if (accionables) {
      hoja.getRange(2, 1, accionables, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sí'], true).build());
    }
  }
  hoja.autoResizeColumns(2, 4);
}
