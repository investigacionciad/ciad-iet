/**
 * @fileoverview Servidor del Panel CIAD (aplicación web).
 * @author APONTE
 * Capa: Controlador. Recibe las llamadas de Panel.html (google.script.run) y responde con datos.
 *
 * Un solo lugar para moderar:
 *   - Solicitudes (hoja de solicitudes)
 *   - Artículos (hoja de artículos y borradores de Blogger)
 *   - Comentarios (Firestore del proyecto de Firebase)
 *
 * Depende de Codigo.gs en el mismo proyecto (usa su CONFIG y sus funciones auxiliares).
 * Quién puede abrirlo se define en la pestaña Usuarios (Usuarios.gs).
 * IMPORTANTE: las funciones que terminan en "_" son privadas; el navegador no puede llamarlas.
 */

const PANEL = {
  // ID del proyecto de Firebase (Firebase > Configuración del proyecto > ID del proyecto)
  FIREBASE_PROYECTO: 'ciad-blog-2026',

  COLECCION_COMENTARIOS: 'comentarios',
  COLECCION_BLOQUEADOS: 'bloqueados',
  COLECCION_USUARIOS: 'users', // La que llena el inicio de sesión del tema

  // Columnas que el panel lee o agrega (además de las de CONFIG)
  SOLICITUD: {
    fecha: 'Marca temporal',
    vinculo: '¿Cuál es tu vínculo?',
    unidad: 'Unidad académica',
    programa: 'Programa educativo',
    organizacion: '¿Con qué organización?',
    nota: 'Nota del moderador',
    moderador: 'Moderado por' // DEF-020: cuenta que aprobó o rechazó
  },
  ARTICULO: {
    fecha: 'Marca temporal',
    seccion: 'Sección asignada',
    etiquetas: 'Etiquetas adicionales',
    publicado: 'Enlace publicado',
    nota: 'Nota del moderador',
    portada: 'Imagen principal',  // La que se sube en el panel (si no hay, se usa la del Form: CONFIG.COLUMNAS_ARTICULO.portada)
    encuadrePc: 'Imagen principal: encuadre en computadora', // "x y z": posición 0–100 y acercamiento 100–300 (%)
    encuadreCelular: 'Imagen principal: encuadre en celular',
    encuadreTarjeta: 'Imagen principal: encuadre en tarjetas', // Inicio, «Todas las notas», buscador y secciones
    tarjeta: 'Imagen de las tarjetas', // Recorte 16:9 que genera el panel con ese encuadre
    editada: 'Editada en el panel', // Fecha y cuenta: «Rehacer desde el Word» avisa que borra lo editado
    clonDe: 'Copia de' // Enlace de la nota original (clonarNota)
  },

  // Filtro anti-spam (solo marca; el CIAD decide)
  PALABRAS_BLOQUEADAS: ['casino', 'apuestas', 'viagra', 'préstamo rápido', 'bitcoin gratis', 'onlyfans', 'gana dinero'],
  MAXIMO_ENLACES: 2,
  MAXIMO_POR_HORA: 3
};


// ===== Entrada y acceso =====

function doGet(e) {
  if (!tieneAcceso_()) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:48px;color:#14243a">Acceso restringido al equipo del CIAD.</p>'
    ).setTitle('Panel CIAD');
  }
  // OPT: el correo y las secciones van dentro de la página, así no hacen falta 2 llamadas (≈1.5 s) antes de cargar los datos
  const plantilla = HtmlService.createTemplateFromFile('Panel');
  // ?pestana=…: los avisos por correo abren el panel directamente en la pestaña que hay que atender
  const pestana = String((e && e.parameter && e.parameter.pestana) || '');
  plantilla.inicio = JSON.stringify({
    correo: Session.getActiveUser().getEmail(),
    admin: esAdmin_(Session.getActiveUser().getEmail()), // La pestaña Usuarios solo se muestra a administradores (el servidor también lo exige)
    secciones: obtenerOpcionesSeccion(),
    ocultas: seccionesOcultas_(), // ver Paginas.gs
    pestana: ['solicitudes', 'articulos', 'comentarios', 'metricas', 'paginas', 'mantenimiento', 'guia', 'usuarios'].indexOf(pestana) !== -1 ? pestana : ''
  })
    .replace(/</g, '\\u003c'); // IMPORTANTE: va dentro de <script>, así que ningún texto puede cerrar la etiqueta
  return plantilla.evaluate()
    .setTitle('Panel CIAD')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function tieneAcceso_() {
  return puedeUsarPanel_(Session.getActiveUser().getEmail()); // ver Usuarios.gs
}

function exigirAcceso_() {
  if (!tieneAcceso_()) throw new Error('Tu cuenta no tiene acceso al panel.');
}


// ===== Guía de uso (archivo Guia.html del proyecto) =====

function obtenerGuia() {
  exigirAcceso_();
  return contenidoGuia_();
}

/**
 * Texto de Guia.html sin cambios.
 * NOTA: getRawContent() no pasa el archivo por el validador de HtmlService
 * (createHtmlOutputFromFile lo rechaza con "Malformed HTML content").
 */
function contenidoGuia_() {
  return HtmlService.createTemplateFromFile('Guia').getRawContent();
}

/** La misma guía en PDF; el navegador la descarga. */
function descargarGuiaPdf() {
  exigirAcceso_();
  const html = '<html><head><meta charset="utf-8"></head><body>' +
    contenidoGuia_() + '</body></html>';
  const pdf = Utilities.newBlob(html, MimeType.HTML, 'guia.html').getAs(MimeType.PDF);
  return { nombre: 'Guia-de-uso-Panel-CIAD.pdf', base64: Utilities.base64Encode(pdf.getBytes()) };
}


// ===== Solicitudes =====

function obtenerSolicitudes() {
  exigirAcceso_();
  const C = CONFIG.COLUMNAS_SOLICITUD;
  const X = PANEL.SOLICITUD;

  return leerTabla_(CONFIG.HOJA_SOLICITUDES_ID)
    .filter(function (f) { return valor_(f, C.nombre) || valor_(f, C.correo); })
    .map(function (f) {
      const respuesta = valor_(f, C.respuesta);
      return {
        fila: f._fila,
        firma: valor_(f, C.folio) || valor_(f, C.correo),
        folio: valor_(f, C.folio),
        fecha: valor_(f, X.fecha),
        estado: valor_(f, C.estado) || 'Pendiente',
        respondida: !!respuesta && respuesta.indexOf('Error') !== 0,
        respuesta: respuesta,
        nombre: valor_(f, C.nombre),
        correo: valor_(f, C.correo),
        vinculo: valor_(f, X.vinculo),
        unidad: valor_(f, X.unidad),
        programa: valor_(f, X.programa),
        organizacion: valor_(f, X.organizacion),
        titulo: valor_(f, C.titulo),
        seccion: valor_(f, C.categoria),
        resumen: valor_(f, C.resumen),
        nota: valor_(f, X.nota),
        moderador: valor_(f, X.moderador)
      };
    })
    .reverse();
}

function aprobarSolicitud(fila, firma) {
  return moderarSolicitud_(fila, firma, 'Aprobada', '');
}

function rechazarSolicitud(fila, firma, nota) {
  // DEF-014: el motivo es obligatorio (RF-32); se valida aquí y no solo en el navegador
  const motivo = String(nota || '').trim();
  if (!motivo) throw new Error('Escribe el motivo del rechazo; se incluye en el correo al autor.');
  return moderarSolicitud_(fila, firma, 'Rechazada', motivo.slice(0, 2000));
}

/** moderador: quién moderó (por omisión, la cuenta del panel; desde la hoja, quien la editó). */
function moderarSolicitud_(fila, firma, estado, nota, moderador) {
  // Desde el panel se exige la lista de acceso; desde la hoja, alEditarSolicitud ya pasó por exigirPermiso_()
  // NOTA: en un disparador la cuenta activa puede venir vacía y aquí se rechazaría.
  if (!moderador) exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);

  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_SOLICITUDES_ID);
    const C = CONFIG.COLUMNAS_SOLICITUD;

    // La fila debe seguir siendo la misma que se ve en el panel
    const datosAntes = leerFila_(hoja, fila);
    const firmaActual = String(datosAntes[C.folio] || datosAntes[C.correo] || '').trim();
    if (firmaActual !== String(firma).trim()) throw new Error('La hoja cambió. Recarga el panel.');

    if (String(leerCelda_(hoja, fila, C.respuesta)).indexOf(' · ') !== -1) {
      throw new Error('Esta solicitud ya fue respondida.');
    }

    // Solicitudes antiguas sin folio: se les asigna uno al moderarlas
    if (!datosAntes[C.folio]) escribir_(hoja, fila, C.folio, 'SOL-' + ('0000' + (fila - 1)).slice(-4));

    const datos = leerFila_(hoja, fila);
    if (!datos[C.correo]) throw new Error('La solicitud no tiene correo.');

    if (estado === 'Aprobada') enviarCorreoAprobacion_(datos);
    else enviarRechazoSolicitud_(datos, nota);

    escribir_(hoja, fila, C.estado, estado);
    escribir_(hoja, fila, C.respuesta, estado + ' · ' + fechaHoy_());
    escribir_(hoja, fila, PANEL.SOLICITUD.moderador, moderador || Session.getActiveUser().getEmail());
    if (nota) escribir_(hoja, fila, PANEL.SOLICITUD.nota, nota);

    return 'Solicitud ' + datos[C.folio] + ' ' + estado.toLowerCase() + '. Se envió el correo a ' + datos[C.correo] + '.';
  } finally {
    bloqueo.releaseLock();
  }
}

function enviarRechazoSolicitud_(datos, nota) {
  const C = CONFIG.COLUMNAS_SOLICITUD;
  enviarCorreo_(datos[C.correo], 'Sobre tu propuesta para el blog del CIAD', {
    titulo: 'Sobre tu propuesta',
    nombre: datos[C.nombre],
    parrafos: [
      'Gracias por proponer <strong>«' + escaparHtml_(datos[C.titulo]) + '»</strong> para el blog del CIAD.',
      'En esta ocasión el equipo editorial no la aprobó para publicación.'
    ],
    nota: nota,
    boton: { texto: 'Enviar otra propuesta', url: CONFIG.CORREO.blog + '/p/solicitud-de-articulo.html' }
  });
}


// ===== Artículos =====

function obtenerArticulos() {
  exigirAcceso_();
  const reloj = cronometro_('obtenerArticulos');
  try { return obtenerArticulosSinMedir_(); } finally { reloj.fin(); }
}

function obtenerArticulosSinMedir_() {
  const A = CONFIG.COLUMNAS_ARTICULO;
  const S = CONFIG.COLUMNAS_SOLICITUD;
  const X = PANEL.ARTICULO;

  // OPT: cada hoja se lee una sola vez, en lugar de leer miles de celdas sueltas;
  // esta función se ejecuta cada 30 s por la recarga automática del panel.
  const solicitudes = leerTabla_(CONFIG.HOJA_SOLICITUDES_ID);
  const articulos = leerTabla_(CONFIG.HOJA_ARTICULOS_ID);

  // Sección de cada folio, según la hoja de solicitudes
  const seccionPorFolio = {};
  solicitudes.forEach(function (f) {
    const folio = valor_(f, S.folio).toUpperCase();
    if (folio) seccionPorFolio[folio] = valor_(f, S.categoria);
  });

  // Solicitudes aprobadas sin artículo, para vincular a mano (misma regla que solicitudesDisponibles_)
  const ocupados = {};
  articulos.forEach(function (f) {
    const estado = String(f[normalizar_(A.estado)] == null ? '' : f[normalizar_(A.estado)]);
    const folio = String(f[normalizar_(A.folio)] == null ? '' : f[normalizar_(A.folio)]).trim().toUpperCase();
    if (folio && (estado.indexOf('Borrador creado') === 0 || estado.indexOf('Publicado') === 0)) ocupados[folio] = true;
  });
  const disponibles = solicitudes
    .filter(function (f) {
      const folio = valor_(f, S.folio).toUpperCase();
      return folio && f[normalizar_(S.estado)] === 'Aprobada' && !ocupados[folio];
    })
    .map(function (f) {
      return { folio: valor_(f, S.folio).toUpperCase(), correo: valor_(f, S.correo), nombre: valor_(f, S.nombre), titulo: valor_(f, S.titulo) };
    });

  return articulos
    .filter(function (f) { return valor_(f, A.titulo) || valor_(f, A.documento) || valor_(f, A.pdfAnterior); })
    .map(function (f) {
      const folio = valor_(f, A.folio).toUpperCase();
      const estado = valor_(f, A.estado);
      const enlace = valor_(f, A.enlace);
      const idDocumento = idsDeDrive_(valor_(f, A.documento))[0];
      const idPdfAnterior = idsDeDrive_(valor_(f, A.pdfAnterior))[0];
      const idsImagenes = idsDeDrive_(valor_(f, A.imagen)).concat(idsDeDrive_(valor_(f, A.imagenAnterior)));
      const coincidencia = enlace.match(/\/(\d+)\s*$/);

      const tipo = tipoArticulo_(estado);
      const correosAutor = [valor_(f, A.cuenta) || valor_(f, A.correoAnterior)].filter(Boolean); // Solo la cuenta de Google

      return {
        fila: f._fila,
        folio: folio,
        // Solo las solicitudes de esa cuenta. Si no tiene ninguna (envió con otra cuenta), se muestran todas
        // para que el artículo no se quede detenido; el panel lo indica.
        opcionesVincular: tipo !== 'vincular' ? [] : (function () {
          const todas = disponibles.map(function (d) { return { folio: d.folio, titulo: d.titulo, nombre: d.nombre, correo: d.correo, coincide: correoCoincide_(d.correo, correosAutor) }; });
          const suyas = todas.filter(function (o) { return o.coincide; });
          return suyas.length ? suyas : todas;
        })(),
        esNotaCiad: !folio && esCuentaCiad_(valor_(f, A.cuenta)),
        fecha: valor_(f, X.fecha),
        estado: estado,
        tipo: tipo,
        titulo: valor_(f, A.titulo),
        autor: valor_(f, A.nombre),
        correo: valor_(f, A.cuenta) || valor_(f, A.correoAnterior), // La cuenta de Google que envió
        subtitulo: valor_(f, A.subtitulo),
        seccionSugerida: folio ? (seccionPorFolio[folio] || '') : '',
        seccionAsignada: valor_(f, X.seccion),
        etiquetasSugeridas: limpiarEtiquetasExtra_(valor_(f, A.palabrasClave)).join(', '), // El panel ya las muestra limpias
        etiquetasAsignadas: valor_(f, X.etiquetas),
        documento: idDocumento ? 'https://drive.google.com/file/d/' + idDocumento + '/view' : '',
        pdf: valor_(f, A.pdf) || (idPdfAnterior ? 'https://drive.google.com/file/d/' + idPdfAnterior + '/view' : ''),
        carpeta: valor_(f, A.carpeta),
        palabras: Number(valor_(f, A.palabras)) || 0,
        imagenes: idsImagenes.map(function (id) { return 'https://drive.google.com/file/d/' + id + '/view'; }),
        enlaceBorrador: enlace,
        postId: coincidencia ? coincidencia[1] : '',
        enlacePublicado: valor_(f, X.publicado),
        portada: idsDeDrive_(valor_(f, X.portada))[0] || idsDeDrive_(valor_(f, A.portada))[0] || '',
        encuadrePc: encuadre_(valor_(f, X.encuadrePc)),
        encuadreCelular: encuadre_(valor_(f, X.encuadreCelular)),
        encuadreTarjeta: encuadre_(valor_(f, X.encuadreTarjeta)),
        nota: valor_(f, X.nota),
        editada: valor_(f, X.editada),
        clonDe: valor_(f, X.clonDe)
      };
    })
    .reverse();
}

function tipoArticulo_(estado) {
  if (!estado) return 'procesando';
  if (estado.indexOf('Por vincular') === 0) return 'vincular';
  if (estado.indexOf('Borrador creado') === 0) return 'revision';
  if (estado.indexOf('Publicado') === 0) return 'publicado';
  if (estado.indexOf('Eliminado') === 0) return 'eliminado';
  if (estado.indexOf('Error') === 0) return 'error';
  return 'rechazado';
}

/**
 * Pestaña Métricas: solo los campos que se cuentan, una fila por solicitud y por envío del Form 2.
 * OPT: cada hoja se lee una sola vez; el panel agrupa y filtra sin volver al servidor.
 */
function obtenerMetricas() {
  exigirAcceso_();
  const reloj = cronometro_('obtenerMetricas');
  try {
    const A = CONFIG.COLUMNAS_ARTICULO;
    const S = CONFIG.COLUMNAS_SOLICITUD;
    const XS = PANEL.SOLICITUD;
    const XA = PANEL.ARTICULO;
    const seccionDe = function (texto) { return String(texto || '').split(':')[0].trim(); }; // "Sección: subapartado"

    const porFolio = {};
    const solicitudes = leerTabla_(CONFIG.HOJA_SOLICITUDES_ID)
      .filter(function (f) { return valor_(f, S.nombre) || valor_(f, S.correo); })
      .map(function (f) {
        const s = {
          fecha: valor_(f, XS.fecha),
          estado: valor_(f, S.estado) || 'Pendiente',
          vinculo: valor_(f, XS.vinculo),
          unidad: valor_(f, XS.unidad),
          programa: valor_(f, XS.programa),
          organizacion: valor_(f, XS.organizacion),
          seccion: seccionDe(valor_(f, S.categoria))
        };
        const folio = valor_(f, S.folio).toUpperCase();
        if (folio) porFolio[folio] = s;
        return s;
      });

    const articulos = leerTabla_(CONFIG.HOJA_ARTICULOS_ID)
      .filter(function (f) { return valor_(f, A.titulo) || valor_(f, A.documento) || valor_(f, A.pdfAnterior); }) // Igual que en obtenerArticulos
      .map(function (f) {
        const s = porFolio[valor_(f, A.folio).toUpperCase()];
        const ciad = !s && esCuentaCiad_(valor_(f, A.cuenta));
        return {
          fecha: valor_(f, XA.fecha),
          tipo: tipoArticulo_(valor_(f, A.estado)),
          seccion: seccionDe(valor_(f, XA.seccion)) || (s ? s.seccion : ''),
          vinculo: s ? s.vinculo : (ciad ? 'CIAD' : ''),
          unidad: s ? s.unidad : '',
          programa: s ? s.programa : '',
          organizacion: s ? s.organizacion : '',
          palabras: Number(valor_(f, A.palabras)) || 0
        };
      });

    return { solicitudes: solicitudes, articulos: articulos };
  } finally { reloj.fin(); }
}

/** Opciones de sección para el selector del panel ("Sección: subapartado"). */
function obtenerOpcionesSeccion() {
  exigirAcceso_();
  const opciones = [];
  CONFIG.SECCIONES.forEach(function (s) {
    Object.keys(s.subapartados).forEach(function (sub) { opciones.push(s.nombre + ': ' + sub); });
  });
  return opciones;
}

function publicarArticulo(fila, postId, seccion, etiquetasTexto) {
  exigirAcceso_();
  const etiquetasSeccion = etiquetasDe_(seccion);
  if (!etiquetasSeccion) throw new Error('Elige la sección del blog antes de publicar.');
  exigirSeccionVisible_(seccion); // ver Paginas.gs
  const extra = limpiarEtiquetasExtra_(etiquetasTexto);
  const reloj = cronometro_('publicarArticulo (fila ' + fila + ')'); // ver Código.gs
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  reloj.paso('espera de turno');

  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const A = CONFIG.COLUMNAS_ARTICULO;
    verificarArticulo_(hoja, fila, postId);
    if (!idPortada_(leerFila_(hoja, fila))) throw new Error('Falta la imagen principal: agrégala en la tarjeta del artículo antes de publicar.');

    // 1. Etiquetas: se quitan las de cualquier sección y se ponen las elegidas.
    //    Se conservan las que el CIAD haya agregado a mano en Blogger (rol, facultad…).
    const rutaEntrada = '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId;
    let actuales = [];
    try {
      actuales = blogger_('GET', rutaEntrada + '?view=ADMIN&fetchBody=false').labels || [];
    } catch (err) {
      actuales = [];
    }
    reloj.paso('verificar y leer etiquetas');
    const deSecciones = etiquetasDeTodasLasSecciones_();
    const base = actuales
      .filter(function (e) { return deSecciones.indexOf(e) === -1; })
      .concat(etiquetasSeccion);
    const ajuste = sumarEtiquetas_(base, extra);
    const etiquetas = ajuste.etiquetas;

    // 2. Etiquetas y publicación en una sola llamada (OPT: evita un PATCH y un POST /publish por separado).
    //    Si Blogger no la deja publicada, se publica con una segunda llamada.
    let entrada = blogger_('PATCH', rutaEntrada + '?publish=true', { labels: etiquetas });
    if (entrada.status !== 'LIVE' || !entrada.url) entrada = blogger_('POST', rutaEntrada + '/publish');
    reloj.paso('publicar en Blogger');

    escribir_(hoja, fila, PANEL.ARTICULO.seccion, seccion);
    escribir_(hoja, fila, PANEL.ARTICULO.etiquetas, ajuste.agregadas.join(', '));
    escribir_(hoja, fila, A.estado, 'Publicado · ' + fechaHoy_());
    escribir_(hoja, fila, PANEL.ARTICULO.publicado, entrada.url);

    const datos = leerFila_(hoja, fila);
    if (correoAutor_(datos) && !esCuentaCiad_(correoAutor_(datos))) {
      enviarCorreo_(correoAutor_(datos), 'Tu artículo ya está publicado en el blog del CIAD', {
        titulo: '¡Tu artículo ya está publicado!',
        nombre: datos[A.nombre],
        parrafos: [
          'Tu artículo <strong>«' + escaparHtml_(datos[A.titulo]) + '»</strong> ya forma parte del blog del CIAD, en la sección <strong>' + escaparHtml_(seccion) + '</strong>.',
          'Gracias por colaborar y compartir tu experiencia con la comunidad.'
        ],
        boton: { texto: 'Ver mi artículo', url: entrada.url }
      });
    }

    reloj.paso('hoja y correo al autor');
    registrarHistorial_('Publicado', {
      folio: datos[A.folio], titulo: datos[A.titulo], autor: datos[A.nombre], correo: correoAutor_(datos),
      seccion: seccion, etiquetas: ajuste.agregadas.join(', '), enlace: entrada.url
    });
    reloj.paso('historial');
    const avisoDepuracion = depurarDespues_('publicar', datos); // OPT: en segundo plano (Codigo.gs)
    reloj.paso('depuración de Drive');

    let mensaje = 'Artículo publicado.';
    if (ajuste.descartadas.length) mensaje += ' No cupieron estas etiquetas (Blogger permite 200 caracteres en total): ' + ajuste.descartadas.join(', ') + '.';
    mensaje += avisoDepuracion;
    return { mensaje: mensaje, url: entrada.url };
  } finally {
    bloqueo.releaseLock();
    reloj.fin();
  }
}

function rechazarArticulo(fila, postId, nota) {
  exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);

  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const A = CONFIG.COLUMNAS_ARTICULO;
    verificarArticulo_(hoja, fila, postId);

    blogger_('DELETE', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId); // Borra el borrador

    escribir_(hoja, fila, A.estado, 'Rechazado por el CIAD · ' + fechaHoy_());
    if (nota) escribir_(hoja, fila, PANEL.ARTICULO.nota, nota);

    const datos = leerFila_(hoja, fila);
    if (correoAutor_(datos) && !esCuentaCiad_(correoAutor_(datos))) {
      enviarCorreo_(correoAutor_(datos), 'Sobre tu artículo «' + datos[A.titulo] + '»', {
        titulo: 'Sobre tu artículo',
        nombre: datos[A.nombre],
        parrafos: ['Revisamos tu artículo <strong>«' + escaparHtml_(datos[A.titulo]) + '»</strong> y por ahora no se publicará.']
          .concat(datos[A.folio] ? ['Si haces los ajustes, puedes volver a enviarlo con el mismo enlace de tu correo de aprobación, usando la misma cuenta de Google.'] : []),
        nota: nota
      });
    }
    registrarHistorial_('Rechazado', { folio: datos[A.folio], titulo: datos[A.titulo], autor: datos[A.nombre], correo: correoAutor_(datos), nota: nota });
    return 'Artículo rechazado y borrador eliminado.' + depurarDespues_('rechazar', datos);
  } finally {
    bloqueo.releaseLock();
  }
}

/** Asigna a mano el folio de un artículo "Por vincular" y crea su borrador. */
function vincularArticulo(fila, folio) {
  exigirAcceso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const A = CONFIG.COLUMNAS_ARTICULO;

  if (String(leerCelda_(hoja, fila, A.estado)).indexOf('Por vincular') !== 0) throw new Error('Este artículo ya no está por vincular. Recarga el panel.');

  const elegido = String(folio || '').trim().toUpperCase();
  const valido = solicitudesDisponibles_(hoja).some(function (d) { return d.folio === elegido; });
  if (!valido) throw new Error('Esa solicitud ya no está disponible. Recarga el panel.');

  escribir_(hoja, fila, A.folio, elegido);
  escribir_(hoja, fila, A.estado, '');
  publicarFila_(hoja, fila);

  const resultado = String(leerCelda_(hoja, fila, A.estado));
  if (resultado.indexOf('Borrador creado') !== 0) throw new Error('No se pudo crear el borrador: ' + resultado);
  return 'Vinculado con ' + elegido + '. Borrador creado; ya puedes revisarlo y publicarlo.';
}

/** Descarta un artículo "Por vincular" (no tiene borrador en Blogger). */
function descartarArticulo(fila, nota) {
  exigirAcceso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const A = CONFIG.COLUMNAS_ARTICULO;

  if (String(leerCelda_(hoja, fila, A.estado)).indexOf('Por vincular') !== 0) throw new Error('Este artículo ya no está por vincular. Recarga el panel.');

  escribir_(hoja, fila, A.estado, 'Rechazado por el CIAD · ' + fechaHoy_());
  if (nota) escribir_(hoja, fila, PANEL.ARTICULO.nota, nota);

  const datos = leerFila_(hoja, fila);
  const correo = correoAutor_(datos);
  if (correo && !esCuentaCiad_(correo)) {
    enviarCorreo_(correo, 'Sobre tu artículo «' + datos[A.titulo] + '»', {
      titulo: 'Sobre tu artículo',
      nombre: datos[A.nombre],
      parrafos: ['Recibimos tu artículo <strong>«' + escaparHtml_(datos[A.titulo]) + '»</strong>, pero no pudimos procesarlo.'],
      nota: nota
    });
  }
  registrarHistorial_('Descartado', { titulo: datos[A.titulo], autor: datos[A.nombre], correo: correo, nota: nota });
  return 'Artículo descartado.' + depurarDespues_('rechazar', datos);
}

/** Borra del blog un artículo publicado y envía a la papelera de Drive todos sus archivos (recuperables durante 30 días). */
function eliminarArticuloPublicado(fila, postId, motivo) {
  exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);

  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const A = CONFIG.COLUMNAS_ARTICULO;
    const enlace = String(leerCelda_(hoja, fila, A.enlace));
    const estado = String(leerCelda_(hoja, fila, A.estado));

    if (!postId || !new RegExp('/' + postId + '\\s*$').test(enlace)) throw new Error('La hoja cambió. Recarga el panel.');
    if (estado.indexOf('Publicado') !== 0) throw new Error('Este artículo no está publicado.');

    blogger_('DELETE', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId);

    const enlacePublicado = String(leerCelda_(hoja, fila, PANEL.ARTICULO.publicado));
    escribir_(hoja, fila, A.estado, 'Eliminado por el CIAD · ' + fechaHoy_());
    escribir_(hoja, fila, PANEL.ARTICULO.publicado, '');
    if (motivo) escribir_(hoja, fila, PANEL.ARTICULO.nota, motivo);

    const datos = leerFila_(hoja, fila);
    registrarHistorial_('Eliminado del blog', {
      folio: datos[A.folio], titulo: datos[A.titulo], autor: datos[A.nombre], correo: correoAutor_(datos),
      seccion: leerCelda_(hoja, fila, PANEL.ARTICULO.seccion), enlace: enlacePublicado, nota: motivo
    });

    return 'Artículo eliminado del blog.' + depurarDespues_('rechazar', datos); // Carpeta, Word e imágenes a la papelera
  } finally {
    bloqueo.releaseLock();
  }
}

/**
 * «Eliminar copia»: borra una nota hecha con «Clonar» (borrador o publicada) y su fila.
 * No avisa a nadie, no va al historial y no toca Drive, porque la copia comparte Word, carpeta
 * e imágenes con la original.
 */
function eliminarCopia(fila, postId) {
  exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    verificarArticulo_(hoja, fila, postId, EDITABLES_);
    if (!String(leerCelda_(hoja, fila, PANEL.ARTICULO.clonDe) || '').trim()) throw new Error('Esta nota no es una copia. Usa Rechazar o Eliminar del blog.');
    try { blogger_('DELETE', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId); }
    catch (err) { if (!/404|not found/i.test(err.message)) throw err; } // Ya la habían borrado en Blogger
    hoja.deleteRow(fila);
    return 'Copia eliminada. La nota original no cambió y no se avisó a nadie.';
  } finally {
    bloqueo.releaseLock();
  }
}

/** Botón "Rehacer" (en pruebas): vuelve a generar el contenido de la entrada desde el Word (ver reconvertirArticulo_ en Código.gs). */
function volverAConvertirArticulo(fila, postId) {
  exigirAcceso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const enlace = String(leerCelda_(hoja, fila, CONFIG.COLUMNAS_ARTICULO.enlace));
  if (!postId || !new RegExp('/' + postId + '\\s*$').test(enlace)) throw new Error('La hoja cambió. Recarga el panel.');
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    return reconvertirArticulo_(fila);
  } finally {
    bloqueo.releaseLock();
  }
}

/**
 * Imagen principal (una por artículo, obligatoria), desde la tarjeta del panel. Funciona en borrador y en publicado.
 *   imagen: data URL para cambiarla (el panel reduce las fotos a ≤2000 px en JPEG; un GIF va sin cambios);
 *     '' = solo cambiar el encuadre.
 *   pc, cel, tar: { x, y } 0–100, posición de la imagen en computadora, en el banner de celular (4:1)
 *     y en las tarjetas (16:9); z: acercamiento 100–300 %.
 *   tarjeta: imagen de las tarjetas ya recortada por el panel (data URL JPEG); '' = sin recorte
 *     (con GIF, las tarjetas usan la principal).
 * Solo cambia la imagen dentro de la entrada; el resto del contenido en Blogger queda igual.
 */
function guardarImagenPrincipal(fila, postId, imagen, pc, cel, tar, tarjeta) {
  exigirAcceso_();
  const X = PANEL.ARTICULO;
  const limpio = function (e) {
    const x = Math.round(Number(e && e.x)), y = Math.round(Number(e && e.y)), z = Math.round(Number(e && e.z) || 100);
    if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100 && z >= 100 && z <= 300)) throw new Error('Encuadre no válido.');
    return { x: x, y: y, z: z };
  };
  pc = limpio(pc); cel = limpio(cel); tar = limpio(tar || { x: 50, y: 50, z: 100 });
  let blobTarjeta = null;
  if (tarjeta) {
    const t = String(tarjeta).match(/^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/);
    if (!t) throw new Error('La imagen de las tarjetas no es válida.');
    blobTarjeta = Utilities.newBlob(Utilities.base64Decode(t[1]), 'image/jpeg', 'tarjeta.jpg');
    if (blobTarjeta.getBytes().length > 5 * 1024 * 1024) throw new Error('La imagen de las tarjetas pesa más de 5 MB.');
  }
  let blob = null;
  if (imagen) {
    const m = String(imagen).match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+\/=]+)$/);
    if (!m) throw new Error('El archivo no es una imagen JPG, PNG, WebP o GIF.');
    blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'imagen-principal.' + m[1].split('/')[1]);
    if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error('La imagen pesa más de 15 MB.');
  }

  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const datos = leerFila_(hoja, fila);
    if (!postId || !new RegExp('/' + postId + '\\s*$').test(String(datos[CONFIG.COLUMNAS_ARTICULO.enlace] || ''))) throw new Error('La hoja cambió. Recarga el panel.');
    const delPanel = idsDeDrive_(datos[X.portada])[0] || ''; // La del autor (Form) no se borra al cambiarla
    const tarjetaAntes = idsDeDrive_(datos[X.tarjeta])[0] || '';
    // Con imagen nueva y sin recorte nuevo, la tarjeta anterior ya no corresponde
    let idTarjeta = blob && !blobTarjeta ? '' : tarjetaAntes;
    if (blobTarjeta) {
      const t = carpetaImagenesDeFila_(datos, 'Imágenes de las tarjetas').createFile(blobTarjeta);
      t.setName(String(datos[CONFIG.COLUMNAS_ARTICULO.folio] || 'Nota CIAD') + ' · tarjeta');
      idTarjeta = t.getId();
      compartirConEnlace_(idTarjeta);
    }
    let id = idPortada_(datos);
    if (blob) {
      const archivo = carpetaImagenesDeFila_(datos, 'Imágenes principales').createFile(blob);
      archivo.setName(String(datos[CONFIG.COLUMNAS_ARTICULO.folio] || 'Nota CIAD') + ' · imagen principal');
      id = archivo.getId();
    }
    if (!id) throw new Error('Primero elige una imagen.');
    compartirConEnlace_(id);

    const ruta = '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId;
    const entrada = blogger_('GET', ruta + '?view=ADMIN');
    const titulo = String(datos[CONFIG.COLUMNAS_ARTICULO.titulo] || entrada.title || '');
    blogger_('PATCH', ruta, { content: conPortada_(entrada.content || '', portadaHtml_(id, pc, cel, titulo, idTarjeta, tar)) });

    if (blob) escribir_(hoja, fila, X.portada, 'https://drive.google.com/open?id=' + id);
    escribir_(hoja, fila, X.encuadrePc, pc.x + ' ' + pc.y + ' ' + pc.z);
    escribir_(hoja, fila, X.encuadreCelular, cel.x + ' ' + cel.y + ' ' + cel.z);
    escribir_(hoja, fila, X.encuadreTarjeta, tar.x + ' ' + tar.y + ' ' + tar.z);
    escribir_(hoja, fila, X.tarjeta, idTarjeta ? 'https://drive.google.com/open?id=' + idTarjeta : '');
    if (blob && delPanel) papelera_(delPanel); // La que se reemplazó (30 días en la papelera)
    if (tarjetaAntes && tarjetaAntes !== idTarjeta) papelera_(tarjetaAntes);
    return 'Imagen principal guardada' + (entrada.status === 'LIVE' ? ' y ya se ve en el blog.' : ' en el borrador.');
  } finally {
    bloqueo.releaseLock();
  }
}

/**
 * Imagen principal de una fila como data URL (miniatura de 1600 px), para que el panel recorte la de
 * las tarjetas. NOTA: desde la página del panel no se puede leer una imagen de Drive (el navegador
 * lo bloquea). Devuelve '' si es GIF (no se recorta).
 * IMPORTANTE: solo devuelve la de esa fila; no sirve para leer otros archivos de Drive.
 */
function imagenDePortada(fila, postId) {
  exigirAcceso_();
  const datos = leerFila_(hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID), fila);
  if (!postId || !new RegExp('/' + postId + '\\s*$').test(String(datos[CONFIG.COLUMNAS_ARTICULO.enlace] || ''))) throw new Error('La hoja cambió. Recarga el panel.');
  const id = idPortada_(datos);
  if (!id) throw new Error('Esta nota no tiene imagen principal.');
  const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const blob = r.getResponseCode() === 200 ? r.getBlob() : DriveApp.getFileById(id).getBlob();
  const tipo = blob.getContentType() || '';
  if (/gif/i.test(tipo)) return '';
  if (blob.getBytes().length > 12 * 1024 * 1024) throw new Error('La imagen principal es demasiado grande para recortar la de las tarjetas.');
  return 'data:' + tipo + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/**
 * Lo que queda a la izquierda de la imagen principal en la nota (título, subtítulo, ficha y tiempo
 * de lectura), como texto, para que la vista previa del panel tenga la misma altura que la nota real.
 */
function cabeceraDeNota(postId) {
  exigirAcceso_();
  if (!/^\d+$/.test(String(postId))) throw new Error('Entrada no válida.');
  const entrada = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId + '?view=ADMIN');
  const html = entrada.content || '';
  const texto = textoDeHtml_;
  const parte = function (re) { const m = html.match(re); return m ? m[1] : ''; };
  return {
    titulo: entrada.title || '',
    subtitulo: texto(parte(/<h2 class="articulo-subtitulo"[^>]*>([\s\S]*?)<\/h2>/)),
    ficha: parte(/<div class="articulo-ficha"[^>]*>([\s\S]*?)<\/div>/).split(/<\/p>/).map(texto).filter(Boolean),
    lectura: texto(parte(/<p class="articulo-lectura"[^>]*>([\s\S]*?)<\/p>/))
  };
}

function textoDeHtml_(h) {
  return String(h || '').replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}


// --- Editar una nota publicada (sin volver a convertir el Word) ---

const CUERPO_INICIO_ = '<div class="articulo-cuerpo">'; // Igual que en armarContenido_ (Código.gs)
const EDITABLES_ = ['Publicado', 'Borrador creado']; // «Editar nota» y «Clonar»: notas publicadas y en revisión

/** Posición justo después del </div> que cierra el <div> abierto en `inicio` (cuenta los internos, como los videos). -1 si no cierra. */
function finDeDiv_(html, inicio) {
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = inicio;
  let nivel = 0, m;
  while ((m = re.exec(html))) {
    nivel += m[0].charAt(1) === '/' ? -1 : 1;
    if (!nivel) return re.lastIndex;
  }
  return -1;
}

/**
 * Ficha del autor (fichaHtml_) → { nombre, fecha, correo, cargo, vinculo }.
 * Cargo y vínculo no tienen marca: con dos líneas van en ese orden; con una, se decide por palabras
 * como "Universidad" (las mismas que usa fichaDelDocumento_).
 */
function fichaDeHtml_(h) {
  const f = { nombre: '', fecha: '', correo: '', cargo: '', vinculo: '' }, otros = [];
  (String(h || '').match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).forEach(function (p) {
    const t = textoDeHtml_(p);
    if (!f.nombre && /font-weight:700/.test(p)) f.nombre = t;
    else if (!f.correo && /mailto:/.test(p)) f.correo = t;
    else if (!f.fecha && /font-size:\.92em/.test(p)) f.fecha = t;
    else if (t) otros.push(t);
  });
  if (otros.length > 1) { f.cargo = otros[0]; f.vinculo = otros.slice(1).join(', '); }
  else if (otros.length) {
    const n = normalizar_(otros[0]);
    f[DOCUMENTO.PALABRAS_VINCULO.some(function (p) { return n.indexOf(p) !== -1; }) ? 'vinculo' : 'cargo'] = otros[0];
  }
  return f;
}

/**
 * El texto editado en el panel va directo al blog: sin scripts, sin on…=, sin javascript: y solo
 * con iframes de YouTube.
 * IMPORTANTE: el panel ya lo limpia al cargarlo; esta es la segunda revisión, del lado del servidor.
 */
function htmlSeguro_(h) {
  return String(h || '')
    .replace(/<(script|style|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:script|style|object|embed|form|base|meta|link)\b[^>]*>/gi, '')
    .replace(/<iframe\b(?![^>]*\ssrc="https:\/\/www\.youtube\.com\/embed\/)[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\b(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, function (todo, attr, valor) {
      // NOTA: el navegador decodifica entidades y quita espacios antes de leer el esquema: "&#106;avascript:" es "javascript:"
      const limpio = valor.replace(/^["']|["']$/g, '')
        .replace(/&#x([0-9a-f]+);?/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&#(\d+);?/g, function (_, d) { return String.fromCharCode(Number(d)); })
        .replace(/&(tab|newline);/gi, '').replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      return /^(javascript|vbscript|data):/.test(limpio) ? attr + '="#"' : todo;
    });
}

/**
 * Copia una nota (publicada o en revisión) como borrador nuevo, para cambiar algo y publicarla aparte.
 * La original no cambia.
 * La copia es «Nota del CIAD» (sin folio, a nombre de la cuenta del CIAD): al publicarla no se escribe
 * al autor original. Comparte imagen principal, Word y carpeta con la original; la depuración de Drive
 * no los toca mientras otra fila los use.
 */
function clonarNota(fila, postId) {
  exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const A = CONFIG.COLUMNAS_ARTICULO, X = PANEL.ARTICULO;
    verificarArticulo_(hoja, fila, postId, EDITABLES_);
    const entrada = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId + '?view=ADMIN');
    const titulo = ('Copia de ' + (entrada.title || '')).slice(0, 300);
    const copia = blogger_('POST', '/blogs/' + CONFIG.BLOG_ID + '/posts/?isDraft=true',
      { kind: 'blogger#post', title: titulo, content: entrada.content || '', labels: entrada.labels || [] });

    // Fila nueva = la original con los datos de la copia (las columnas que falten se crean antes de copiar la fila)
    const cambios = {};
    cambios[A.estado] = 'Borrador creado · ' + fechaHoy_();
    cambios[A.enlace] = 'https://www.blogger.com/blog/post/edit/' + CONFIG.BLOG_ID + '/' + copia.id;
    cambios[A.folio] = '';
    cambios[A.cuenta] = CONFIG.CUENTAS_CIAD[0];
    cambios[A.titulo] = titulo;
    cambios[X.fecha] = new Date();
    cambios[X.publicado] = '';
    cambios[X.editada] = '';
    cambios[X.nota] = '';
    cambios[X.clonDe] = String(leerCelda_(hoja, fila, X.publicado) || leerCelda_(hoja, fila, A.enlace));
    Object.keys(cambios).forEach(function (h) { columnaDe_(hoja, h, true); });
    const ancho = hoja.getLastColumn();
    const valores = hoja.getRange(fila, 1, 1, ancho).getValues()[0];
    Object.keys(cambios).forEach(function (h) { valores[columnaDe_(hoja, h, false) - 1] = cambios[h]; });
    const nuevaFila = hoja.getLastRow() + 1;
    hoja.getRange(nuevaFila, 1, 1, ancho).setValues([valores]);
    return { mensaje: 'Copia creada como borrador: «' + titulo + '». Ya está abierta para editarla.', fila: nuevaFila, postId: copia.id };
  } finally {
    bloqueo.releaseLock();
  }
}

/** Lo que se puede editar de una nota publicada: título, subtítulo, ficha y texto (HTML de .articulo-cuerpo; null si no hay). */
function notaParaEditar(fila, postId) {
  exigirAcceso_();
  verificarArticulo_(hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID), fila, postId, EDITABLES_);
  const entrada = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId + '?view=ADMIN');
  const html = entrada.content || '';
  const sub = html.match(/<h2 class="articulo-subtitulo"[^>]*>([\s\S]*?)<\/h2>/);
  const ficha = html.match(/<div class="articulo-ficha"[^>]*>([\s\S]*?)<\/div>/);
  const i = html.indexOf(CUERPO_INICIO_), fin = i === -1 ? -1 : finDeDiv_(html, i);
  return {
    titulo: entrada.title || '',
    subtitulo: sub ? textoDeHtml_(sub[1]) : '',
    ficha: fichaDeHtml_(ficha ? ficha[1] : ''),
    cuerpo: fin === -1 ? null : citasAMarcas_(html.slice(i + CUERPO_INICIO_.length, fin - '</div>'.length))
  };
}

/**
 * Lo contrario de citasNumeradas_ (Documento.gs): el número volado con burbuja y el "[n]" de la
 * referencia vuelven a ser [[n]] para editarlos a mano; al guardar, citasNumeradas_ vuelve a crear
 * los enlaces y las burbujas.
 */
function citasAMarcas_(html) {
  return String(html || '')
    .replace(/<sup class="cita">[\s\S]*?<\/sup>/g, function (s) { const n = s.match(/\[(\d{1,3})\]/); return n ? '[[' + n[1] + ']]' : s; })
    .replace(/(<(?:p|li)\b[^>]*?) id="ref-\d{1,3}">((?:<[^>]+>)*)<span class="ref-n">\[(\d{1,3})\]<\/span>\s*/g, '$1>$2[[$3]] ');
}

/** Palabras del texto sin las referencias (igual que la conversión) → "Lectura de N min". */
function palabrasDelCuerpo_(html) {
  const titulo = html.search(/<h2[^>]*>(?:(?!<\/h2>)[\s\S])*?(?:referencias|bibliograf)/i);
  const corte = titulo !== -1 ? titulo : html.search(/<(?:p|li)[^>]*>(?:<[^>]+>)*\s*\[\[\s*\d{1,3}\s*\]\]/);
  const t = (corte === -1 ? html : html.slice(0, corte)).replace(/<[^>]+>/g, ' ');
  return contarPalabras_(textoDeHtml_(t).replace(/\[\[\s*\d{1,3}\s*\]\]/g, ''));
}

/** Imagen nueva dentro del texto de una nota publicada (botón «Imagen» del editor). Devuelve el id del archivo en Drive. */
function subirImagenNota(fila, postId, imagen) {
  exigirAcceso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  verificarArticulo_(hoja, fila, postId, EDITABLES_);
  const m = String(imagen || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) throw new Error('El archivo no es una imagen JPG, PNG, WebP o GIF.');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'imagen.' + m[1].split('/')[1]);
  if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error('La imagen pesa más de 15 MB.');
  const archivo = carpetaImagenesDeFila_(leerFila_(hoja, fila), 'Imágenes de las notas').createFile(blob);
  archivo.setName(postId + ' · imagen del texto');
  compartirConEnlace_(archivo.getId());
  return archivo.getId();
}

/**
 * Guarda en el blog lo editado en el panel con una sola llamada a Blogger (título, contenido y
 * etiquetas); la nota sigue publicada.
 *   d: { titulo, subtitulo, ficha: {nombre, fecha, correo, cargo, vinculo},
 *        cuerpo (HTML, o null si no se tocó), seccion, etiquetas }
 * Subtítulo y ficha se generan con las mismas piezas que la conversión; la imagen principal y lo demás
 * quedan igual.
 */
function guardarNotaEditada(fila, postId, d) {
  exigirAcceso_();
  d = d || {};
  const una = function (t, max) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, max); };
  const titulo = una(d.titulo, 300), subtitulo = una(d.subtitulo, 1500);
  if (!titulo) throw new Error('El título no puede quedar vacío.');
  const etiquetasSeccion = etiquetasDe_(d.seccion);
  if (!etiquetasSeccion) throw new Error('Elige la sección del blog.');
  exigirSeccionVisible_(d.seccion); // ver Paginas.gs
  const ficha = {};
  ['nombre', 'fecha', 'correo', 'cargo', 'vinculo'].forEach(function (k) { ficha[k] = una((d.ficha || {})[k], 300); });
  if (ficha.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ficha.correo)) throw new Error('El correo de la ficha no es válido.');
  const extra = limpiarEtiquetasExtra_(d.etiquetas);

  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
    const A = CONFIG.COLUMNAS_ARTICULO, X = PANEL.ARTICULO;
    verificarArticulo_(hoja, fila, postId, EDITABLES_);
    const ruta = '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId;
    const entrada = blogger_('GET', ruta + '?view=ADMIN');
    const inicio = '<div class="articulo-ciad">';
    let html = entrada.content || '';
    if (html.indexOf(inicio) === -1) throw new Error('Esta entrada no tiene el formato del publicador; usa “Rehacer” primero.');

    // Cabecera: se quitan subtítulo y ficha; los nuevos van después de la imagen principal (mismo orden que armarContenido_)
    html = html.replace(/<h2 class="articulo-subtitulo"[^>]*>[\s\S]*?<\/h2>/, '').replace(/<div class="articulo-ficha"[^>]*>[\s\S]*?<\/div>/, '');
    const cabecera = (subtitulo ? '<h2 class="articulo-subtitulo" style="line-height:1.35;margin:0 0 1em;">' + escaparHtml_(subtitulo) + '</h2>' : '') + fichaHtml_(ficha);
    const figura = html.match(/<figure class="articulo-portada"[\s\S]*?<\/figure>/);
    const pos = figura ? html.indexOf(figura[0]) + figura[0].length : html.indexOf(inicio) + inicio.length;
    html = html.slice(0, pos) + cabecera + html.slice(pos);

    let palabras = 0;
    if (d.cuerpo !== null && d.cuerpo !== undefined) {
      const limpio = htmlSeguro_(d.cuerpo);
      palabras = palabrasDelCuerpo_(limpio);
      const i = html.indexOf(CUERPO_INICIO_), fin = i === -1 ? -1 : finDeDiv_(html, i);
      if (fin === -1) throw new Error('No encontré el texto de la nota; usa “Rehacer”.');
      html = html.slice(0, i + CUERPO_INICIO_.length) + citasNumeradas_(limpio) + html.slice(fin - '</div>'.length);
      const lectura = '<p class="articulo-lectura">⏱ Lectura de ' + Math.max(1, Math.round(palabras / PALABRAS_POR_MINUTO_)) + ' min</p>';
      html = /<p class="articulo-lectura">[\s\S]*?<\/p>/.test(html)
        ? html.replace(/<p class="articulo-lectura">[\s\S]*?<\/p>/, lectura)
        : html.replace(CUERPO_INICIO_, lectura + CUERPO_INICIO_);
    }

    // Etiquetas: igual que publicarArticulo, y además se quitan las extra que se borraron en el panel
    const antes = limpiarEtiquetasExtra_(leerCelda_(hoja, fila, X.etiquetas)).map(normalizar_);
    const deSecciones = etiquetasDeTodasLasSecciones_();
    const base = (entrada.labels || [])
      .filter(function (e) { return deSecciones.indexOf(e) === -1 && antes.indexOf(normalizar_(e)) === -1; })
      .concat(etiquetasSeccion);
    const ajuste = sumarEtiquetas_(base, extra);

    // Estilos actualizados (como conPortada_): así la nota recibe los ajustes de diseño al guardarla
    html = conEstiloAlDia_(html);

    blogger_('PATCH', ruta, { title: titulo, content: html, labels: ajuste.etiquetas });

    // También en la hoja: el panel muestra estos datos y «Rehacer desde el Word» toma de aquí el título y el subtítulo
    escribir_(hoja, fila, A.titulo, titulo);
    escribir_(hoja, fila, A.subtitulo, subtitulo);
    if (ficha.nombre) escribir_(hoja, fila, A.nombre, ficha.nombre);
    escribir_(hoja, fila, X.seccion, d.seccion);
    escribir_(hoja, fila, X.etiquetas, ajuste.agregadas.join(', '));
    if (palabras) escribir_(hoja, fila, A.palabras, palabras);
    escribir_(hoja, fila, X.editada, fechaHoy_() + ' · ' + Session.getActiveUser().getEmail());

    return (entrada.status === 'LIVE' ? 'Cambios guardados; ya se ven en el blog.' : 'Cambios guardados en el borrador.') +
      (ajuste.descartadas.length ? ' No cupieron estas etiquetas (Blogger permite 200 caracteres en total): ' + ajuste.descartadas.join(', ') + '.' : '');
  } finally {
    bloqueo.releaseLock();
  }
}

/** Subcarpeta (por ejemplo "Imágenes principales") de la carpeta de archivos del blog, compartida con enlace (las imágenes heredan el permiso). */
// Carpetas sueltas antiguas (en «archivos del blog»): solo para notas sin carpeta propia (hechas a mano en Blogger)
const CARPETAS_DEL_PANEL_ = ['Imágenes principales', 'Imágenes de las tarjetas', 'Imágenes de las notas'];

/** Imágenes que se suben desde el panel: van a «<carpeta del artículo>/Imágenes», junto a las del Word y la galería. */
function carpetaImagenesDeFila_(datos, suelta) {
  const id = idCarpeta_(datos[CONFIG.COLUMNAS_ARTICULO.carpeta]);
  if (id) {
    try {
      const c = DriveApp.getFolderById(id);
      if (!c.isTrashed()) { const it = c.getFoldersByName('Imágenes'); return it.hasNext() ? it.next() : c.createFolder('Imágenes'); }
    } catch (err) { /* La carpeta ya no existe: va a la suelta */ }
  }
  return carpetaDelBlog_(suelta);
}

function carpetaDelBlog_(nombre) {
  const principal = carpetaGuardadaCodigo_('CARPETA_ARCHIVOS');
  if (!principal) throw new Error('No se encontró la carpeta de archivos del blog (propiedad CARPETA_ARCHIVOS).');
  const it = principal.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  const nueva = principal.createFolder(nombre);
  try { nueva.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* Se comparte cada archivo */ }
  return nueva;
}

function reintentarArticulo(fila) {
  exigirAcceso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  publicarFila_(hoja, fila); // de Codigo.gs
  return 'Resultado: ' + leerCelda_(hoja, fila, CONFIG.COLUMNAS_ARTICULO.estado);
}

/**
 * "IA, #Realidad aumentada, ia" → ['IA', 'Realidad aumentada'] (sin repetir, sin etiquetas internas).
 * Acepta como escriba el autor: coma, punto y coma o salto de línea; espacios de más; coma o punto
 * al final; "#".
 * Descarta lo que no es palabra clave ("1", "w", "--").
 */
function limpiarEtiquetasExtra_(texto) {
  const vistas = {};
  return String(texto || '').split(/[,;\n\r]/)
    .map(function (e) {
      return e.replace(/<[^>]*>/g, '').replace(/[#<>"«»“”]/g, '').replace(/\s+/g, ' ').trim()
        .replace(/^[\s.\-–·*•]+|[\s.\-–·*•:]+$/g, '').slice(0, CONFIG.ETIQUETAS_EXTRA_LARGO).trim();
    })
    .filter(function (e) {
      const k = normalizar_(e);
      if (!/[a-zñ]{2}/.test(k)) return false; // Al menos dos letras seguidas: "IA" sí, "1" o "w" no
      if (vistas[k] || /^(categoria|formato|facultad)-/.test(k)) return false;
      vistas[k] = true;
      return true;
    })
    .slice(0, CONFIG.ETIQUETAS_EXTRA_MAXIMO);
}

/** Agrega las etiquetas extra sin pasar el límite de 200 caracteres de Blogger. */
function sumarEtiquetas_(base, extra) {
  const etiquetas = base.filter(function (e, i, arr) { return arr.indexOf(e) === i; });
  const agregadas = [], descartadas = [];
  const largo = function (lista) { return lista.join(',').length; };
  extra.forEach(function (e) {
    if (etiquetas.some(function (x) { return normalizar_(x) === normalizar_(e); })) return;
    if (largo(etiquetas.concat([e])) <= 200) { etiquetas.push(e); agregadas.push(e); }
    else descartadas.push(e);
  });
  return { etiquetas: etiquetas, agregadas: agregadas, descartadas: descartadas };
}

function etiquetasDeTodasLasSecciones_() {
  const lista = [];
  CONFIG.SECCIONES.forEach(function (s) {
    lista.push(s.etiqueta);
    Object.keys(s.subapartados).forEach(function (sub) { lista.push(s.subapartados[sub]); });
  });
  return lista;
}

/** prefijo: estado(s) que debe tener la fila ('Borrador creado' para revisar; también 'Publicado' para editar o clonar). */
function verificarArticulo_(hoja, fila, postId, prefijo) {
  const permitidos = [].concat(prefijo || 'Borrador creado');
  const A = CONFIG.COLUMNAS_ARTICULO;
  const enlace = String(leerCelda_(hoja, fila, A.enlace));
  const estado = String(leerCelda_(hoja, fila, A.estado));
  if (!postId || !new RegExp('/' + postId + '\\s*$').test(enlace)) throw new Error('La hoja cambió. Recarga el panel.');
  if (!permitidos.some(function (p) { return estado.indexOf(p) === 0; })) {
    throw new Error(prefijo ? 'Este artículo cambió de estado (' + (estado.split(' · ')[0] || 'sin estado') + '). Recarga el panel.' : 'Este artículo ya no está en revisión.');
  }
}


// ===== Comentarios (Firestore) =====

function obtenerComentarios(estado) {
  exigirAcceso_();
  const lista = consultarPorEstado_(estado || 'pendiente');

  if ((estado || 'pendiente') === 'pendiente') {
    lista.forEach(function (c) { c.spam = evaluarSpam_(c, lista); });
    lista.sort(function (a, b) { return (a.creado || '').localeCompare(b.creado || ''); });
  } else {
    lista.sort(function (a, b) { return (b.moderadoEn || '').localeCompare(a.moderadoEn || ''); });
  }

  return { comentarios: lista, bloqueados: listarBloqueados_() };
}

function aprobarComentario(id) {
  exigirAcceso_();
  const comentario = actualizarComentario_(id, 'publicado', '');
  const avisado = avisarAutorDeComentario_(comentario); // ver Avisos.gs; si falla, el comentario ya quedó publicado
  return 'Comentario publicado.' + (avisado ? ' Se avisó al autor de la nota (' + avisado + ').' : '');
}

function rechazarComentario(id, nota) {
  exigirAcceso_();
  const comentario = actualizarComentario_(id, 'rechazado', nota || '');

  if (nota) {
    const correo = correoDeUsuario_(comentario.uid);
    if (correo) {
      enviarCorreo_(correo, 'Sobre tu comentario en el blog del CIAD', {
        titulo: 'Sobre tu comentario',
        nombre: comentario.nombre,
        parrafos: ['Tu comentario en <strong>«' + escaparHtml_(comentario.postTitulo || 'una entrada') + '»</strong> no fue publicado.'],
        nota: nota
      });
      return 'Comentario rechazado. Se avisó a ' + correo + '.';
    }
  }
  return 'Comentario rechazado.';
}

/** Borra un comentario (publicado o rechazado). No se puede deshacer. */
function eliminarComentario(id) {
  exigirAcceso_();
  if (!id) throw new Error('Falta el comentario.');
  firestore_('DELETE', '/' + PANEL.COLECCION_COMENTARIOS + '/' + encodeURIComponent(id));
  return 'Comentario eliminado.';
}

function bloquearUsuario(uid, nombre, motivo) {
  exigirAcceso_();
  if (!uid) throw new Error('El comentario no tiene usuario.');

  firestore_('PATCH', '/' + PANEL.COLECCION_BLOQUEADOS + '/' + encodeURIComponent(uid), {
    fields: aCampos_({
      uid: uid,
      nombre: nombre || '',
      correo: correoDeUsuario_(uid) || '',
      motivo: motivo || '',
      fecha: new Date(),
      bloqueadoPor: Session.getActiveUser().getEmail()
    })
  });

  // Rechazar todos sus pendientes
  const pendientes = consultarPorEstado_('pendiente').filter(function (c) { return c.uid === uid; });
  pendientes.forEach(function (c) { actualizarComentario_(c.id, 'rechazado', 'Cuenta bloqueada'); });

  return 'Cuenta bloqueada. Se rechazaron ' + pendientes.length + ' comentario(s) pendiente(s).';
}

function desbloquearUsuario(uid) {
  exigirAcceso_();
  firestore_('DELETE', '/' + PANEL.COLECCION_BLOQUEADOS + '/' + encodeURIComponent(uid));
  return 'Cuenta desbloqueada.';
}

function consultarPorEstado_(estado) {
  const respuesta = firestore_('POST', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: PANEL.COLECCION_COMENTARIOS }],
      where: { fieldFilter: { field: { fieldPath: 'estado' }, op: 'EQUAL', value: { stringValue: estado } } },
      limit: 300
    }
  });

  return (respuesta || [])
    .filter(function (r) { return r.document; })
    .map(function (r) { return documento_(r.document); });
}

function actualizarComentario_(id, estado, nota) {
  const campos = ['estado', 'notaModerador', 'moderadoPor', 'moderadoEn'];
  const ruta = '/' + PANEL.COLECCION_COMENTARIOS + '/' + encodeURIComponent(id) +
    '?' + campos.map(function (c) { return 'updateMask.fieldPaths=' + c; }).join('&') +
    '&currentDocument.exists=true';

  const doc = firestore_('PATCH', ruta, {
    fields: aCampos_({
      estado: estado,
      notaModerador: nota,
      moderadoPor: Session.getActiveUser().getEmail(),
      moderadoEn: new Date()
    })
  });
  return documento_(doc);
}

function listarBloqueados_() {
  const respuesta = firestore_('GET', '/' + PANEL.COLECCION_BLOQUEADOS + '?pageSize=300');
  return ((respuesta && respuesta.documents) || []).map(documento_);
}

function correoDeUsuario_(uid) {
  if (!uid) return '';
  try {
    const doc = firestore_('GET', '/' + PANEL.COLECCION_USUARIOS + '/' + encodeURIComponent(uid));
    return doc ? documento_(doc).email || '' : '';
  } catch (err) {
    return '';
  }
}

function evaluarSpam_(c, todos) {
  const motivos = [];
  const texto = String(c.texto || '');
  const bajo = normalizar_(texto);

  const enlaces = (texto.match(/https?:\/\/|www\./gi) || []).length;
  if (enlaces > PANEL.MAXIMO_ENLACES) motivos.push(enlaces + ' enlaces');

  PANEL.PALABRAS_BLOQUEADAS.forEach(function (p) {
    if (bajo.indexOf(normalizar_(p)) !== -1) motivos.push('palabra "' + p + '"');
  });

  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  if (letras.length >= 20 && mayus.length / letras.length > 0.7) motivos.push('casi todo en mayúsculas');

  if (/(.)\1{5,}/.test(texto)) motivos.push('caracteres repetidos');

  if (todos.some(function (o) { return o.id !== c.id && normalizar_(o.texto) === bajo; })) motivos.push('texto repetido');

  const t0 = new Date(c.creado).getTime();
  const enHora = todos.filter(function (o) {
    return o.uid === c.uid && Math.abs(new Date(o.creado).getTime() - t0) < 3600000;
  }).length;
  if (enHora > PANEL.MAXIMO_POR_HORA) motivos.push(enHora + ' comentarios en 1 hora');

  return motivos;
}


// ===== Firestore REST (con la cuenta del CIAD, sin pasar por las reglas) =====

function firestore_(metodo, ruta, cuerpo) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PANEL.FIREBASE_PROYECTO +
    '/databases/(default)/documents' + ruta;

  const opciones = {
    method: metodo.toLowerCase(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (cuerpo) {
    opciones.contentType = 'application/json';
    opciones.payload = JSON.stringify(cuerpo);
  }

  const r = UrlFetchApp.fetch(url, opciones);
  const codigo = r.getResponseCode();
  const texto = r.getContentText();

  if (codigo === 404 && metodo === 'GET') return null;
  if (codigo === 403) throw new Error('Sin permiso en Firestore. Revisa el rol de la cuenta del CIAD en el proyecto (GUIA-panel, paso 3).');
  if (codigo >= 300) throw new Error('Firestore ' + codigo + ': ' + texto.slice(0, 300));
  return texto ? JSON.parse(texto) : {};
}

function aCampos_(objeto) {
  const campos = {};
  Object.keys(objeto).forEach(function (k) { campos[k] = aValor_(objeto[k]); });
  return campos;
}

function aValor_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

function deValor_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor_);
  if ('mapValue' in v) {
    const o = {};
    Object.keys(v.mapValue.fields || {}).forEach(function (k) { o[k] = deValor_(v.mapValue.fields[k]); });
    return o;
  }
  return null;
}

function documento_(doc) {
  const datos = { id: doc.name.split('/').pop() };
  Object.keys(doc.fields || {}).forEach(function (k) { datos[k] = deValor_(doc.fields[k]); });
  return datos;
}


// ===== Blogger (acepta respuestas vacías, como en DELETE) =====

function blogger_(metodo, ruta, cuerpo) {
  const opciones = {
    method: metodo.toLowerCase(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (cuerpo) {
    opciones.contentType = 'application/json';
    opciones.payload = JSON.stringify(cuerpo);
  }
  // Reintenta fallas temporales (429, 5xx y 403 por límite de uso) a los 2 s y a los 6 s.
  let r, codigo, texto;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      r = UrlFetchApp.fetch('https://www.googleapis.com/blogger/v3' + ruta, opciones);
    } catch (err) {
      if (intento === 3) throw new Error('No hubo respuesta de Blogger (' + err.message + '). Intenta de nuevo en unos minutos; no se guardó ningún cambio.');
      Utilities.sleep(2000 * intento);
      continue;
    }
    codigo = r.getResponseCode();
    texto = r.getContentText();
    const temporal = codigo === 429 || codigo >= 500 || (codigo === 403 && /rate ?limit|quota|userRateLimitExceeded/i.test(texto));
    if (!temporal || intento === 3) break;
    Utilities.sleep(2000 * intento + 2000 * (intento - 1));
  }

  if (metodo === 'DELETE' && codigo === 404) return {}; // Ya estaba borrado
  if (codigo >= 300) {
    console.error('Blogger ' + codigo + ' ' + metodo + ' ' + ruta + ': ' + texto.slice(0, 500));
    throw new Error(mensajeBlogger_(codigo, texto));
  }
  return texto ? JSON.parse(texto) : {};
}

/** Error de la Blogger API en palabras claras para el personal del CIAD (el detalle técnico queda en Ejecuciones). */
function mensajeBlogger_(codigo, texto) {
  const detalle = ' (Blogger ' + codigo + ')';
  if (codigo === 401) return 'La autorización con Blogger expiró. Recarga el panel; si sigue, la cuenta del CIAD debe volver a autorizar el script' + detalle + '.';
  if (codigo === 403) return 'Blogger no dio permiso para esta acción. La cuenta que ejecuta el panel debe ser administradora del blog' + detalle + '.';
  if (codigo === 404) return 'Blogger no encontró la página o la entrada; puede que se haya borrado. Recarga el panel' + detalle + '.';
  if (codigo === 409) return 'Blogger rechazó el cambio porque la página cambió al mismo tiempo. Recarga el panel e inténtalo de nuevo' + detalle + '.';
  if (codigo === 429) return 'Blogger está limitando las solicitudes. Espera un minuto y vuelve a intentar; no se guardó ningún cambio' + detalle + '.';
  if (codigo >= 500) return 'Blogger tuvo una falla temporal. Intenta de nuevo en unos minutos; no se guardó ningún cambio' + detalle + '.';
  return 'Blogger rechazó la solicitud' + detalle + ': ' + String(texto || '').slice(0, 200);
}


// ===== Hojas =====

/** Filas como objetos { encabezadoNormalizado: valor, _fila }. Si hay encabezados repetidos, gana el primero. */
function leerTabla_(idArchivo) {
  const valores = hojaDeRespuestas_(idArchivo).getDataRange().getValues();
  const encabezados = valores[0].map(normalizar_);
  const filas = [];

  for (let i = 1; i < valores.length; i++) {
    const fila = { _fila: i + 1 };
    encabezados.forEach(function (h, j) {
      if (h && !(h in fila)) fila[h] = valores[i][j];
    });
    filas.push(fila);
  }
  return filas;
}

function valor_(fila, encabezado) {
  const v = fila[normalizar_(encabezado)];
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Tijuana', 'dd/MM/yyyy HH:mm');
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * OPT: { encabezadoNormalizado: columna }, leído una vez por ejecución, para que cada
 * leerCelda_/escribir_ no vuelva a leer toda la fila 1.
 */
const MEMORIA_ENCABEZADOS_ = new Map();

function mapaEncabezados_(hoja) {
  const clave = claveHoja_(hoja); // ver Codigo.gs
  if (MEMORIA_ENCABEZADOS_.has(clave)) return MEMORIA_ENCABEZADOS_.get(clave);
  const mapa = {};
  hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].forEach(function (h, i) {
    const k = normalizar_(h);
    if (k && !(k in mapa)) mapa[k] = i + 1; // Si hay encabezados repetidos, gana el primero
  });
  MEMORIA_ENCABEZADOS_.set(clave, mapa);
  return mapa;
}

function columnaDe_(hoja, encabezado, crear) {
  const mapa = mapaEncabezados_(hoja);
  const buscado = normalizar_(encabezado);
  if (mapa[buscado]) return mapa[buscado];
  if (!crear) return 0;
  const nueva = hoja.getLastColumn() + 1;
  hoja.getRange(1, nueva).setValue(encabezado).setFontWeight('bold');
  mapa[buscado] = nueva;
  MEMORIA_COLUMNAS_.delete(claveHoja_(hoja)); // La memoria de Codigo.gs debe ver la columna nueva
  return nueva;
}

function leerCelda_(hoja, fila, encabezado) {
  const col = columnaDe_(hoja, encabezado, false);
  return col ? hoja.getRange(fila, col).getValue() : '';
}

function escribir_(hoja, fila, encabezado, valor) {
  hoja.getRange(fila, columnaDe_(hoja, encabezado, true)).setValue(valor);
}