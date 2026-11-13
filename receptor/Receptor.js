/**
 * @fileoverview Receptor de solicitudes CIAD (DEF-013).
 * @author APONTE
 * Capa: Controlador web (doPost). Proyecto de Apps Script separado del Panel.
 *
 * Recibe la solicitud de artículo desde la página del blog, verifica la sesión de Google del autor
 * (token de Firebase), la guarda en la hoja de solicitudes con Folio y Estado "Pendiente" y
 * responde si quedó registrada o no. Así la página solo muestra "Solicitud enviada" cuando es cierto.
 *
 * NOTA: es un proyecto aparte del panel porque debe publicarse con acceso "Cualquier persona",
 * y el panel no.
 *
 * Instalación: ver "Instrucciones" al final de este archivo.
 */

const RECEPTOR = {
  // Misma hoja que CONFIG.HOJA_SOLICITUDES_ID del panel (primera pestaña)
  HOJA_SOLICITUDES_ID: '1uMKjWWnLnP2V5gQZAP7-mpVYggM_SU0lX8UVQd1khq0',

  // La clave web de Firebase no va en el código: está en Propiedades del script (FIREBASE_API_KEY). Ver claveFirebase_().
  // La clave está restringida al blog en Google Cloud, por eso se envía este Referer
  REFERER: 'https://ciad-innovaedutec.blogspot.com/',

  // IMPORTANTE: encabezados exactos de la hoja (los mismos que usa el panel)
  COLUMNAS: {
    fecha: 'Marca temporal',
    nombre: 'Nombre completo',
    correo: 'Ingresa tu correo electronico',
    vinculo: '¿Cuál es tu vínculo?',
    unidad: 'Unidad académica',
    programa: 'Programa educativo',
    organizacion: '¿Con qué organización?',
    titulo: 'Título tentativo del artículo',
    resumen: '¿De qué trata tu nota?',
    folio: 'Folio',
    estado: 'Estado',
    aviso: 'Aviso enviado' // Lo llena este receptor al enviar los correos; el panel solo reintenta las filas vacías
  },

  // Correos al instante: confirmación al colaborador y aviso al CIAD y a los administradores, con botón al panel.
  // NOTA: la lista de administradores no está aquí; el panel (CONFIG.ACCESO_PANEL) la guarda en un metadato
  // de la hoja de solicitudes y este receptor la lee (ver destinatariosCiad_).
  AVISOS: {
    ACTIVOS: true,
    PANEL_URL: 'https://script.google.com/a/macros/uabc.edu.mx/s/AKfycbyx-LJuhH9F2Xh8UR5HfSiM9sbtv8rnThnGv0uNr5ODOfUpdxzcv99JO7lBvLjTcwAL/exec?pestana=solicitudes',
    REMITENTE: 'Blog del CIAD',
    CONTACTO: 'investigacion.ciad@uabc.edu.mx',
    BLOG: 'https://ciad-innovaedutec.blogspot.com',
    LOGO: 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgQuk0rhmA8psCIKRt7bSEi7hkCPrXxhj6PdsL9mhyOdDjxiMiv9xMbcs1N7pe-yHsQJ0BZJpbE7TfcNNSnXgWpBWQIFj0KeNFrwkscqmMwCojp2EXUw0rRZ3s3_HNPchtbMc9CaB79xkEpPZ5j9ONkECbHtI7wkVqI8kP7JBZhUyIwKXGicWuvjBLTOBM/s400/LOGO_CIAD_2023_PNG%20%281%29.png'
  },

  VINCULOS: ['UABC', 'Otra institución u organización', 'Independiente'],
  // Máximo de palabras (sin mínimo), igual que los contadores de la página y el formulario de envío
  PALABRAS_TITULO: 20,
  PALABRAS_RESUMEN: 100,
  // Misma cuenta + mismo título dentro de estos minutos = doble clic o reenvío: se devuelve el folio anterior.
  // Fuera de ese tiempo es una solicitud nueva.
  MINUTOS_REENVIO: 10
};


// ===== Entrada web =====

function doPost(e) {
  try {
    const datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sesion = verificarSesion_(datos.idToken);
    const registro = registrarSolicitud_(datos, sesion);
    console.log((registro.repetida ? 'Reenvío, se devolvió ' : 'Registrada ') + registro.folio + ' · ' + sesion.correo);
    if (!registro.repetida) avisarSolicitud_(registro, sesion); // Nunca lanza error: la solicitud ya quedó guardada
    return respuesta_({ ok: true, correo: sesion.correo, folio: registro.folio, repetida: registro.repetida });
  } catch (err) {
    if (!err.paraUsuario) console.error(err.stack || err);
    return respuesta_({
      ok: false,
      mensaje: err.paraUsuario ? err.message : 'No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos.'
    });
  }
}

/** Para comprobar que el receptor está publicado (abrir la URL en el navegador). */
function doGet() {
  return respuesta_({ ok: true, servicio: 'Receptor de solicitudes CIAD' });
}

function respuesta_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

/** Error con un mensaje que sí se le muestra al autor. */
function fallaUsuario_(mensaje) {
  const err = new Error(mensaje);
  err.paraUsuario = true;
  throw err;
}


// ===== Sesión (IMPORTANTE: el correo sale del token de Firebase, no de lo que envíe el navegador) =====

/**
 * Clave web de Firebase (la misma de firebaseConfig.apiKey en el tema), guardada en
 * Configuración del proyecto > Propiedades del script > FIREBASE_API_KEY.
 * IMPORTANTE: si falta, falla con un mensaje claro en Ejecuciones en lugar de enviar una petición sin clave.
 */
function claveFirebase_() {
  const clave = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
  if (!clave) throw new Error('Falta la propiedad del script FIREBASE_API_KEY (ver README > Seguridad).');
  return clave;
}

function verificarSesion_(idToken) {
  if (!idToken) fallaUsuario_('Inicia sesión con Google para enviar tu solicitud.');

  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + claveFirebase_(), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    headers: { Referer: RECEPTOR.REFERER },
    muteHttpExceptions: true
  });

  if (r.getResponseCode() === 400) fallaUsuario_('Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.');
  if (r.getResponseCode() !== 200) throw new Error('Firebase ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));

  const usuario = (JSON.parse(r.getContentText()).users || [])[0];
  if (!usuario || !usuario.email) fallaUsuario_('Tu cuenta de Google no tiene correo. Inicia sesión con otra cuenta.');

  return { correo: String(usuario.email).toLowerCase() };
}


// ===== Validación y registro =====

/** Palabras = partes separadas por espacios o saltos de línea (la misma regla que la página y el formulario). */
function contarPalabras_(texto) {
  const t = String(texto || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function hastaPalabras_(nombre, texto, maximo) {
  const n = contarPalabras_(texto);
  if (!n) fallaUsuario_(nombre + ' está vacío.');
  if (n > maximo) fallaUsuario_(nombre + ' puede tener máximo ' + maximo + ' palabras; tiene ' + n + '.');
}

function limpio_(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
}

function normalizar_(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function registrarSolicitud_(d, sesion) {
  const s = {
    nombre: limpio_(d.nombre, 150),
    vinculo: limpio_(d.vinculo, 60),
    unidad: limpio_(d.unidad, 150),
    programa: limpio_(d.programa, 150),
    organizacion: limpio_(d.organizacion, 150),
    titulo: limpio_(d.titulo, 2000),  // Se validan más abajo, sin cortarlos
    resumen: limpio_(d.resumen, 5000)
  };

  // Mismas reglas que la página
  if (!s.nombre) fallaUsuario_('Escribe tu nombre completo.');
  if (RECEPTOR.VINCULOS.indexOf(s.vinculo) === -1) fallaUsuario_('Elige tu institución.');
  if (s.vinculo === 'UABC' && (!s.unidad || !s.programa)) fallaUsuario_('Escribe tu unidad académica y tu programa educativo.');
  if (s.vinculo === 'Otra institución u organización' && !s.organizacion) fallaUsuario_('Escribe el nombre de tu institución u organización.');
  if (!s.titulo) fallaUsuario_('Escribe un título tentativo.');
  hastaPalabras_('El título', s.titulo, RECEPTOR.PALABRAS_TITULO);
  hastaPalabras_('El resumen', s.resumen, RECEPTOR.PALABRAS_RESUMEN);
  if (d.aceptaLineamientos !== true) fallaUsuario_('Acepta los lineamientos editoriales para continuar.');

  // Solo se guardan los datos del vínculo elegido
  if (s.vinculo !== 'UABC') { s.unidad = ''; s.programa = ''; }
  if (s.vinculo !== 'Otra institución u organización') s.organizacion = '';

  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    const hoja = SpreadsheetApp.openById(RECEPTOR.HOJA_SOLICITUDES_ID).getSheets()[0];
    const C = RECEPTOR.COLUMNAS;
    const col = columnas_(hoja, [C.folio, C.estado, C.aviso]);
    const valores = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues() : [];

    // Doble clic o reenvío: si ya existe la misma propuesta del mismo correo, no se duplica
    // y se le avisa a la página.
    const limite = Date.now() - RECEPTOR.MINUTOS_REENVIO * 60000;
    const anterior = valores.filter(function (f) {
      const fecha = col[C.fecha] ? f[col[C.fecha] - 1] : null;
      return fecha && typeof fecha.getTime === 'function' && fecha.getTime() >= limite &&
        normalizar_(f[col[C.correo] - 1]) === sesion.correo && normalizar_(f[col[C.titulo] - 1]) === normalizar_(s.titulo);
    }).pop();
    if (anterior) return { folio: String(anterior[col[C.folio] - 1] || ''), repetida: true };

    // Folio: mayor existente + 1, y nunca menor que "fila − 1", que es lo que el panel
    // asigna a solicitudes antiguas sin folio al moderarlas (así no se repiten)
    let mayor = 0;
    valores.forEach(function (f) {
      const m = String(f[col[C.folio] - 1] || '').match(/^SOL-(\d+)$/i);
      if (m) mayor = Math.max(mayor, Number(m[1]));
    });
    const filaNueva = hoja.getLastRow() + 1;
    const folio = 'SOL-' + ('0000' + Math.max(mayor + 1, filaNueva - 1)).slice(-4);

    const fila = new Array(hoja.getLastColumn()).fill('');
    function poner(clave, valor) { if (col[C[clave]]) fila[col[C[clave]] - 1] = valor; }
    poner('fecha', new Date());
    poner('nombre', s.nombre);
    poner('correo', sesion.correo);   // El de la cuenta verificada, no el que envíe el navegador
    poner('vinculo', s.vinculo);
    poner('unidad', s.unidad);
    poner('programa', s.programa);
    poner('organizacion', s.organizacion);
    poner('titulo', s.titulo);
    poner('resumen', s.resumen);
    poner('folio', folio);
    poner('estado', 'Pendiente');

    hoja.appendRow(fila);
    SpreadsheetApp.flush(); // Se confirma la escritura antes de responder "ok"
    return { folio: folio, repetida: false, fila: filaNueva, columnaAviso: col[C.aviso], datos: s };
  } finally {
    bloqueo.releaseLock();
  }
}

// ===== Correos al instante =====

function avisarSolicitud_(registro, sesion) {
  const K = RECEPTOR.AVISOS;
  if (!K.ACTIVOS) return;
  const s = registro.datos;
  const esc = escaparHtml_;
  try {
    const libro = SpreadsheetApp.openById(RECEPTOR.HOJA_SOLICITUDES_ID);
    enviarCorreo_(sesion.correo, 'Recibimos tu solicitud ' + registro.folio + ' para el blog del CIAD', {
      titulo: 'Recibimos tu solicitud',
      nombre: s.nombre,
      parrafos: [
        'Tu propuesta <strong>«' + esc(s.titulo) + '»</strong> quedó registrada con el folio <strong>' + esc(registro.folio) + '</strong>.',
        'El equipo editorial la revisará y te responderemos a este correo si se aprueba o no. No necesitas hacer nada más por ahora.'
      ]
    });
    const institucion = s.vinculo === 'UABC' ? [s.unidad, s.programa].filter(Boolean).join(' · ') : (s.organizacion || s.vinculo);
    enviarCorreo_(destinatariosCiad_(libro), 'Nueva solicitud ' + registro.folio + ': «' + s.titulo + '»', {
      titulo: 'Llegó una solicitud nueva',
      parrafos: [
        '<strong>' + esc(registro.folio) + ' · «' + esc(s.titulo) + '»</strong><br>' + esc(s.nombre) + ' · ' + esc(sesion.correo) +
          (institucion ? '<br>' + esc(institucion) : ''),
        '<span style="color:#5d6b7c;">' + esc(s.resumen.length > 400 ? s.resumen.slice(0, 399) + '…' : s.resumen) + '</span>',
        'Revísala en el panel para aprobarla o rechazarla; el autor recibe la respuesta por correo.'
      ],
      boton: { texto: 'Atender en el Panel CIAD', url: K.PANEL_URL }
    });
    // Marca para que el panel no la vuelva a avisar
    if (registro.columnaAviso) {
      libro.getSheets()[0].getRange(registro.fila, registro.columnaAviso).setValue(new Date());
    }
  } catch (err) {
    console.error('Aviso de ' + registro.folio + ' no enviado (el panel lo reintenta en 1 min): ' + err.message);
  }
}

/**
 * CIAD y administradores: la lista que el panel publica en la hoja (metadato CIAD_DESTINATARIOS).
 * Si no se puede leer, se usa al menos el correo del CIAD, para que ninguna solicitud quede sin aviso.
 */
function destinatariosCiad_(libro) {
  try {
    const md = libro.createDeveloperMetadataFinder().withKey('CIAD_DESTINATARIOS').find();
    const lista = md.length ? String(md[0].getValue() || '').trim() : '';
    if (lista) return lista;
    console.warn('Sin lista de administradores en la hoja: se avisa solo a ' + RECEPTOR.AVISOS.CONTACTO);
  } catch (err) {
    console.warn('Lista de administradores: ' + err.message);
  }
  return RECEPTOR.AVISOS.CONTACTO;
}

/** Se ejecuta desde el editor para ver a quién se avisaría. */
function verDestinatarios() {
  const lista = destinatariosCiad_(SpreadsheetApp.openById(RECEPTOR.HOJA_SOLICITUDES_ID));
  console.log(lista);
  return lista;
}

function enviarCorreo_(para, asunto, d) {
  const K = RECEPTOR.AVISOS;
  const verde = '#00723f';
  let cuerpo = d.nombre ? '<p style="margin:0 0 14px;">Hola ' + escaparHtml_(d.nombre) + ':</p>' : '';
  d.parrafos.forEach(function (p) { cuerpo += '<p style="margin:0 0 14px;">' + p + '</p>'; });
  if (d.boton) {
    cuerpo += '<p style="margin:22px 0;"><a href="' + escaparHtml_(d.boton.url) + '" style="background:' + verde +
      ';color:#ffffff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">' + escaparHtml_(d.boton.texto) + '</a></p>';
  }
  const html = '<div style="background:#f4f6f8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e7ed;">' +
    '<tr><td style="padding:18px 28px;border-bottom:4px solid ' + verde + ';"><img src="' + K.LOGO + '" alt="CIAD" height="40" style="display:block;height:40px;width:auto;border:0;"></td></tr>' +
    '<tr><td style="padding:26px 28px 8px;color:#1d2a3a;font-size:15px;line-height:1.6;"><h1 style="font-size:20px;color:' + verde + ';margin:0 0 16px;">' + escaparHtml_(d.titulo) + '</h1>' + cuerpo + '</td></tr>' +
    '<tr><td style="padding:16px 28px 22px;border-top:1px solid #e2e7ed;color:#5d6b7c;font-size:12px;line-height:1.5;">' +
    '<strong style="color:#1d2a3a;">Equipo editorial · Blog del CIAD</strong><br>Centro de Investigación para el Aprendizaje Digital (CIAD) · Universidad Autónoma de Baja California<br>' +
    '<a href="mailto:' + K.CONTACTO + '" style="color:' + verde + ';">' + K.CONTACTO + '</a> · <a href="' + K.BLOG + '" style="color:' + verde + ';">' + K.BLOG.replace(/^https?:\/\//, '') + '</a></td></tr></table></div>';
  MailApp.sendEmail({ to: para, subject: asunto, htmlBody: html, name: K.REMITENTE, replyTo: K.CONTACTO });
}

function escaparHtml_(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Se ejecuta una sola vez desde el editor: pide el permiso de enviar correo (sin enviar nada). */
function autorizarCorreo() {
  Logger.log('Correos disponibles hoy: ' + MailApp.getRemainingDailyQuota());
}

/** { 'Encabezado': númeroDeColumna }. Crea al final las columnas indicadas si no existen. */
function columnas_(hoja, crearSiFaltan) {
  const C = RECEPTOR.COLUMNAS;
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(normalizar_);
  const col = {};
  Object.keys(C).forEach(function (k) {
    const i = encabezados.indexOf(normalizar_(C[k]));
    if (i !== -1) col[C[k]] = i + 1;
  });
  crearSiFaltan.forEach(function (nombre) {
    if (!col[nombre]) {
      const nueva = hoja.getLastColumn() + 1;
      hoja.getRange(1, nueva).setValue(nombre).setFontWeight('bold');
      col[nombre] = nueva;
    }
  });
  [C.nombre, C.correo, C.titulo].forEach(function (nombre) {
    if (!col[nombre]) throw new Error('Falta la columna "' + nombre + '" en la hoja de solicitudes.');
  });
  return col;
}


// ===== Prueba desde el editor: revisa la hoja y las columnas sin escribir nada =====

function probarConfiguracion() {
  const hoja = SpreadsheetApp.openById(RECEPTOR.HOJA_SOLICITUDES_ID).getSheets()[0];
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(normalizar_);
  Object.keys(RECEPTOR.COLUMNAS).forEach(function (k) {
    const ok = encabezados.indexOf(normalizar_(RECEPTOR.COLUMNAS[k])) !== -1;
    Logger.log((ok ? 'OK      ' : 'FALTA   ') + RECEPTOR.COLUMNAS[k]);
  });
  Logger.log('Hoja: ' + hoja.getParent().getName() + ' › ' + hoja.getName());
  const clave = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
  Logger.log((clave ? 'OK      ' : 'FALTA   ') + 'Propiedad del script FIREBASE_API_KEY');
}

/*
 * Instrucciones
 * 1. script.google.com → Nuevo proyecto, con la cuenta investigacion.ciad@uabc.edu.mx
 *    (la dueña de la hoja). Nombre: "Receptor de solicitudes CIAD". Pegar este archivo.
 * 2. Configuración del proyecto → Propiedades del script → agregar FIREBASE_API_KEY con la clave web
 *    de Firebase (la de firebaseConfig.apiKey en el tema; está en CREDENCIALES.md).
 *    Ejecutar probarConfiguracion() y aceptar los permisos. Si algo sale "FALTA", corregirlo
 *    (las columnas, en RECEPTOR.COLUMNAS; Folio y Estado se crean solas).
 * 3. Implementar → Nueva implementación → Aplicación web.
 *    Ejecutar como: Yo. Quién tiene acceso: Cualquier persona.
 * 4. Copiar la URL que termina en /exec y pegarla en RECEPTOR_URL de la página
 *    "Solicitud de artículo" en Blogger.
 * 5. En el Google Form de solicitud: Respuestas → desactivar "Aceptar respuestas",
 *    para que nadie envíe solicitudes por fuera de la página.
 */