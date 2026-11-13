/**
 * @fileoverview Publicador CIAD: configuración y flujo principal del sistema.
 * @author APONTE
 * Capa: Controlador (disparadores de las hojas) y Configuración (CONFIG).
 *
 * Hoja 1 (solicitudes):
 *   - Al llegar una solicitud: le asigna Folio y Estado "Pendiente".
 *   - Al cambiar Estado a "Aprobada": envía al autor el Form 2 prellenado.
 *   - Al cambiar Estado a "Rechazada": le avisa por correo.
 *
 * Hoja 2 (artículos):
 *   - Autor externo: el script busca su solicitud aprobada por su cuenta de Google (el autor
 *     nunca ve el folio), se lo asigna y crea la entrada en Blogger como borrador.
 *     Si no hay una sola coincidencia, queda "Por vincular" en el Panel.
 *   - Cuenta del CIAD sin folio: crea el borrador directamente.
 *   - El CIAD asigna la sección definitiva en el Panel al publicar.
 *
 * Instalación: llenar CONFIG y ejecutar instalar() una sola vez.
 *
 * IMPORTANTE (seguridad): el panel se publica para toda la UABC, así que el navegador podría
 * llamar a cualquier función pública del proyecto. Por eso las funciones auxiliares terminan
 * en "_" (privadas) y las públicas empiezan con exigirPermiso_().
 */

const CONFIG = {
  BLOG_ID: '3238130712979741887',

  HOJA_SOLICITUDES_ID: '1uMKjWWnLnP2V5gQZAP7-mpVYggM_SU0lX8UVQd1khq0',
  HOJA_ARTICULOS_ID: '14GyBkPCQgt4iVPrKwBjRUcR37BSsfkVUEdn367IDk-Q',

  // Form 2: enlace "viewform" y los entry del enlace prellenado (el folio ya no va en el formulario)
  FORM2_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeG2WJrlD3a8BLtavq-ZJ50bXdbxMwN69pJlFRGtT1sIiGCrw/viewform',
  FORM2_CAMPOS: {
    nombre: 'entry.2079811391'
    // Sin correo: "Correo de contacto (opcional)" es público en la nota; si está vacío se muestra el de la cuenta (correoParaMostrar_)
  },

  PUBLICAR_COMO_BORRADOR: true,

  // Cuentas que pueden enviar el Form 2 sin folio (notas propias del CIAD).
  // Se compara con el correo que Google registra en el Form 2, no con lo que escribe la persona.
  CUENTAS_CIAD: [
    'investigacion.ciad@uabc.edu.mx'
  ],

  // Solo se usa la primera vez (o si se daña la lista guardada) para crear los usuarios del panel.
  // Las demás personas se agregan en la pestaña Usuarios (Usuarios.gs); sus correos no van en el código.
  ACCESO_PANEL: [
    'investigacion.ciad@uabc.edu.mx'
  ],
  NOMBRE_REMITENTE: 'Blog del CIAD',
  VINCULO_CIAD: 'Centro de Investigación para el Aprendizaje Digital (CIAD), UABC',

  // Enlace del panel para los avisos al CIAD (lleva /a/macros/uabc.edu.mx/; sin eso, Google no lo abre)
  PANEL_URL: 'https://script.google.com/a/macros/uabc.edu.mx/s/AKfycbyx-LJuhH9F2Xh8UR5HfSiM9sbtv8rnThnGv0uNr5ODOfUpdxzcv99JO7lBvLjTcwAL/exec',

  // IMPORTANTE: encabezados exactos de cada hoja (= texto de la pregunta del Form)
  COLUMNAS_SOLICITUD: {
    nombre:    'Nombre completo',
    correo:    'Ingresa tu correo electronico',
    titulo:    'Título tentativo del artículo',
    categoria: 'Sección del blog',
    resumen:   '¿De qué trata tu nota?',
    vinculo:   '¿Cuál es tu vínculo?',
    unidad:    'Unidad académica',
    programa:  'Programa educativo',
    organizacion: '¿Con qué organización?',
    // Columnas que agrega el script
    folio:     'Folio',
    estado:    'Estado',
    respuesta: 'Respuesta enviada'
  },
  COLUMNAS_ARTICULO: {
    cuenta:  'Dirección de correo electrónico', // La registra Google (recopilar correos)
    enviado: 'Marca temporal',
    cargo:   'Cargo (opcional)',                // Pregunta opcional del Form 2 (si se agrega)
    folio:   'Folio de solicitud',              // La escribe el script; no es pregunta del Form
    subtitulo: 'Subtítulo del artículo',
    resumen: 'Resumen del artículo (máximo 100 palabras)', // = texto de la pregunta del Form 2 (se muestra en azul bajo el título)
    nombre:  'Nombre completo del autor(es)',
    correo:  'Correo de contacto (opcional)',   // Solo se muestra en la nota; los avisos van a la cuenta
    correoAnterior: 'Correo electrónico de contacto', // Pregunta anterior (envíos que no registraron la cuenta)
    titulo:  'Título del artículo (máximo 20 palabras)', // = texto de la pregunta del Form 2 (si cambia la pregunta, cambia la columna)
    documento: 'Adjuntar el artículo en Word (.docx)',
    pdfAnterior: 'Adjuntar PDF del artículo Edu bits', // Envíos antiguos en PDF
    imagen:  'Adjuntar imágenes para la galería (opcional)',     // Van a la galería, al final
    imagenAnterior: 'Adjuntar imagen o foto representativa (opcional)', // Envíos antiguos
    portada: 'Imagen principal de la nota', // Obligatoria en el Form 2; el panel puede cambiarla (PANEL.ARTICULO.portada)
    palabrasClave: 'Palabras clave (opcional)',  // Pregunta opcional del Form 2: hashtags separados por coma
    // Columnas que agrega el script
    estado:  'Estado publicación',
    enlace:  'Enlace del borrador',
    pdf:     'PDF del artículo',
    carpeta: 'Carpeta de archivos',
    palabras: 'Palabras'
  },

  // Etiquetas que llevan todas las entradas
  ETIQUETAS_FIJAS: ['formato-articulo'],

  // Etiquetas adicionales (hashtags): máximo por entrada y largo de cada una.
  // NOTA: Blogger acepta como máximo 200 caracteres sumando todas las etiquetas de una entrada.
  ETIQUETAS_EXTRA_MAXIMO: 5,
  ETIQUETAS_EXTRA_LARGO: 30,

  // Al publicar, el Word, su copia en Google Docs y el PDF de respaldo van a la papelera
  // (las imágenes se conservan porque la entrada las muestra desde Drive).
  // Al rechazar, todo lo del envío va a la papelera. La papelera de Drive guarda 30 días.
  DEPURAR_DRIVE: true,
  // true = la papelera se vacía en segundo plano (Publicar responde más rápido; los archivos se van en ≤ 5 min).
  // false = se hace en el momento, dentro del clic de Publicar/Rechazar (tarda más).
  DEPURAR_EN_SEGUNDO_PLANO: true,

  // Historial de todas las notas (publicadas, rechazadas, descartadas y eliminadas).
  // Vacío = pestaña "Historial" dentro de la hoja de artículos.
  HISTORIAL_ID: '',
  HISTORIAL_PESTANA: 'Historial',

  // Firma y logotipo de los correos
  CORREO: {
    contacto: 'investigacion.ciad@uabc.edu.mx',
    blog: 'https://ciad-innovaedutec.blogspot.com',
    logo: 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgQuk0rhmA8psCIKRt7bSEi7hkCPrXxhj6PdsL9mhyOdDjxiMiv9xMbcs1N7pe-yHsQJ0BZJpbE7TfcNNSnXgWpBWQIFj0KeNFrwkscqmMwCojp2EXUw0rRZ3s3_HNPchtbMc9CaB79xkEpPZ5j9ONkECbHtI7wkVqI8kP7JBZhUyIwKXGicWuvjBLTOBM/s400/LOGO_CIAD_2023_PNG%20%281%29.png',
    firma: 'Equipo editorial · Blog del CIAD',
    institucion: 'Centro de Investigación para el Aprendizaje Digital (CIAD) · Universidad Autónoma de Baja California'
  },

  /**
   * Secciones del blog.
   * La opción del formulario es "<nombre>: <subapartado>". Cada opción recibe la etiqueta de la
   * sección y la del subapartado.
   *   - Subapartado (lado derecho): verificado contra el objeto `etiquetas` de cada página; es lo
   *     que hace que la entrada aparezca en la página.
   *   - `etiqueta` de la sección: la usan el buscador y el orden del panel, no las páginas.
   * IMPORTANTE: si cambia una etiqueta en una página, hay que cambiarla también aquí.
   */
  SECCIONES: [
    {
      nombre: 'Tecnología Educativa',
      etiqueta: 'categoria-tecnologia-educativa',
      subapartados: {
        'Herramientas y plataformas': 'Herramientas y plataformas',
        'Metodologías de enseñanza': 'Metodologías de enseñanza',
        'Accesibilidad e inclusión digital': 'Accesibilidad e inclusión digital',
        'Analítica y evaluación del aprendizaje': 'Analítica y evaluación del aprendizaje'
      }
    },
    {
      nombre: 'Tecnologías Emergentes',
      etiqueta: 'categoria-tecnologias-emergentes',
      subapartados: {
        'Inteligencia Artificial': 'Inteligencia Artificial',
        'Ciberseguridad': 'Ciberseguridad',
        'Realidad Virtual / Aumentada': 'Realidad Virtual / Aumentada',
        'Blockchain': 'Blockchain',
        'IoT y ciudades inteligentes': 'IoT y ciudades inteligentes',
        'Computación cuántica': 'Computación cuántica'
      }
    },
    {
      nombre: 'Ética y Sociedad Digital',
      etiqueta: 'categoria-etica-sociedad-digital',
      subapartados: {
        'Privacidad y protección de datos': 'Privacidad y protección de datos',
        'Sesgos algorítmicos': 'Sesgos algorítmicos',
        'Honestidad académica e IA': 'Honestidad académica e IA',
        'Brecha digital': 'Brecha digital'
      }
    },
    {
      nombre: 'Innovación',
      etiqueta: 'categoria-innovacion',
      subapartados: {
        'Investigación y proyectos institucionales': 'Investigación y proyectos',
        'Casos de éxito': 'Casos de éxito',
        'Startups y emprendimiento tecnológico': 'Startups y emprendimiento',
        'Transformación digital administrativa': 'Transformación digital'
      }
    }
  ]
};

const ESTADOS = ['Pendiente', 'Aprobada', 'Rechazada'];


// ===== Instalación (se ejecuta una sola vez desde el editor) =====

function instalar() {
  exigirPermiso_();
  // Quitar los disparadores anteriores de este proyecto
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  const hojaSolicitudes = hojaDeRespuestas_(CONFIG.HOJA_SOLICITUDES_ID);
  const hojaArticulos = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);

  // Columnas del script
  asegurarColumnas_(hojaSolicitudes, [CONFIG.COLUMNAS_SOLICITUD.folio, CONFIG.COLUMNAS_SOLICITUD.estado, CONFIG.COLUMNAS_SOLICITUD.respuesta]);
  asegurarColumnas_(hojaArticulos, [CONFIG.COLUMNAS_ARTICULO.folio, CONFIG.COLUMNAS_ARTICULO.estado, CONFIG.COLUMNAS_ARTICULO.enlace]);

  // Lista desplegable en Estado
  const colEstado = columnas_(hojaSolicitudes)[CONFIG.COLUMNAS_SOLICITUD.estado];
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).build();
  hojaSolicitudes.getRange(2, colEstado, hojaSolicitudes.getMaxRows() - 1, 1).setDataValidation(regla);

  // Disparadores
  ScriptApp.newTrigger('alRecibirSolicitud').forSpreadsheet(CONFIG.HOJA_SOLICITUDES_ID).onFormSubmit().create();
  ScriptApp.newTrigger('alEditarSolicitud').forSpreadsheet(CONFIG.HOJA_SOLICITUDES_ID).onEdit().create();
  ScriptApp.newTrigger('alRecibirArticulo').forSpreadsheet(CONFIG.HOJA_ARTICULOS_ID).onFormSubmit().create();
  ScriptApp.newTrigger('procesarColaDrive').timeBased().everyMinutes(INTERVALO_COLA_MIN_).create(); // OPT: depuración de Drive en segundo plano
  PropertiesService.getScriptProperties().setProperty('COLA_INTERVALO', String(INTERVALO_COLA_MIN_));

  // Validar etiquetas y acceso al blog
  const blog = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID);
  Logger.log('Instalado. Blog conectado: ' + blog.name + ' (' + blog.url + ')');
}


// ===== Hoja 1: solicitudes =====

function alRecibirSolicitud(e) {
  exigirPermiso_();
  const hoja = e.range.getSheet();
  const fila = e.range.getRow();
  const col = columnas_(hoja);
  const C = CONFIG.COLUMNAS_SOLICITUD;

  // NOTA: misma regla de folio que el Receptor (mayor existente + 1, nunca menor que fila − 1),
  // para no repetir un folio que ya asignó el Receptor.
  // Solo se activa si alguien responde el Google Form de solicitud (debería estar cerrado).
  if (String(hoja.getRange(fila, col[C.folio]).getValue()).trim()) return;
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    const ultima = hoja.getLastRow();
    let mayor = 0;
    hoja.getRange(2, col[C.folio], Math.max(1, ultima - 1), 1).getValues().forEach(function (f) {
      const m = String(f[0] || '').match(/^SOL-(\d+)$/i);
      if (m) mayor = Math.max(mayor, Number(m[1]));
    });
    hoja.getRange(fila, col[C.folio]).setValue('SOL-' + ('0000' + Math.max(mayor + 1, fila - 1)).slice(-4));
    hoja.getRange(fila, col[C.estado]).setValue('Pendiente');
  } finally {
    bloqueo.releaseLock();
  }
}

/**
 * Moderar editando la hoja (columna Estado → "Aprobada" o "Rechazada").
 * Hace lo mismo que el panel (moderarSolicitud_ en PanelServidor.gs): mismo correo, asigna folio si
 * falta y deja en la hoja quién moderó y la nota.
 * Para rechazar con motivo desde la hoja: escribir primero la "Nota del moderador" y después
 * cambiar el Estado.
 */
function alEditarSolicitud(e) {
  exigirPermiso_();
  const hoja = e.range.getSheet();
  const col = columnas_(hoja);
  const C = CONFIG.COLUMNAS_SOLICITUD;

  if (!col[C.estado] || e.range.getColumn() !== col[C.estado] || e.range.getNumRows() !== 1) return;

  const fila = e.range.getRow();
  if (fila < 2) return;

  const estado = String(e.range.getValue()).trim();
  if (estado !== 'Aprobada' && estado !== 'Rechazada') return;

  const celdaRespuesta = hoja.getRange(fila, col[C.respuesta]);
  if (String(celdaRespuesta.getValue()).indexOf(' · ') !== -1) return; // Ya se respondió antes

  const datos = leerFila_(hoja, fila);
  const firma = String(datos[C.folio] || datos[C.correo] || '').trim();
  const nota = String(leerCelda_(hoja, fila, PANEL.SOLICITUD.nota) || '').trim();
  let quien = '';
  try { quien = e.user && e.user.getEmail ? e.user.getEmail() : ''; } catch (err) { quien = ''; }

  try {
    moderarSolicitud_(fila, firma, estado, nota.slice(0, 2000), (quien || 'Edición en la hoja'));
  } catch (err) {
    celdaRespuesta.setValue('Error: ' + err.message);
  }
}

/**
 * "&entry.N=…" con el título y el resumen de la solicitud, para que el autor no los vuelva a
 * escribir en el Form 2 (ahí puede corregirlos). Las preguntas se buscan por su texto (= CONFIG) y
 * Google genera el enlace (toPrefilledUrl), así no hay números de pregunta que mantener.
 * Si algo falla, el correo se envía igual, solo sin estos dos campos.
 */
function tituloYResumenPrellenados_(datos) {
  const C = CONFIG.COLUMNAS_SOLICITUD, A = CONFIG.COLUMNAS_ARTICULO;
  const valores = {};
  valores[normalizar_(A.titulo)] = String(datos[C.titulo] || '').trim();
  valores[normalizar_(A.resumen)] = String(datos[C.resumen] || '').trim();
  try {
    const form = FormApp.openByUrl(SpreadsheetApp.openById(CONFIG.HOJA_ARTICULOS_ID).getFormUrl());
    const respuesta = form.createResponse();
    let puestos = 0;
    form.getItems().forEach(function (item) {
      const v = valores[normalizar_(item.getTitle())];
      if (!v) return;
      if (item.getType() === FormApp.ItemType.TEXT) respuesta.withItemResponse(item.asTextItem().createResponse(v));
      else if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) respuesta.withItemResponse(item.asParagraphTextItem().createResponse(v));
      else return;
      puestos++;
    });
    if (!puestos) return '';
    const url = respuesta.toPrefilledUrl();
    return url.slice(url.indexOf('?') + 1).split('&')
      .filter(function (par) { return par.indexOf('entry.') === 0; })
      .map(function (par) { return '&' + par; }).join('');
  } catch (err) {
    console.warn('Sin título/resumen prellenados en el Form 2: ' + err.message);
    return '';
  }
}

function enviarCorreoAprobacion_(datos) {
  const C = CONFIG.COLUMNAS_SOLICITUD;
  const F = CONFIG.FORM2_CAMPOS;

  const enlace = CONFIG.FORM2_URL + '?usp=pp_url' +
    '&' + F.nombre + '=' + encodeURIComponent(datos[C.nombre] || '') +
    tituloYResumenPrellenados_(datos);

  enviarCorreo_(datos[C.correo], 'Tu propuesta para el blog del CIAD fue aprobada', {
    titulo: 'Tu propuesta fue aprobada',
    nombre: datos[C.nombre],
    parrafos: [
      'El equipo editorial del CIAD aprobó tu propuesta <strong>«' + escaparHtml_(datos[C.titulo]) + '»</strong>.',
      'El siguiente paso es enviarnos tu artículo en Word y una <strong>imagen principal</strong> que lo represente (obligatoria) con el formulario de envío. <strong>Ábrelo con la misma cuenta de Google (' +
        escaparHtml_(datos[C.correo]) + ')</strong> con la que hiciste tu propuesta; así la relacionamos automáticamente.',
      'Tu nombre, el título y el resumen de tu propuesta ya vienen escritos en el formulario; puedes corregirlos ahí. ' +
        'Antes de enviarlo, revisa los requisitos de formato que aparecen al inicio del formulario.'
    ],
    boton: { texto: 'Enviar mi artículo', url: enlace }
  });
}

// NOTA: el correo de rechazo está en PanelServidor.gs (enviarRechazoSolicitud_): una sola plantilla para el panel y la hoja.


// ===== Hoja 2: artículos → Blogger =====

function alRecibirArticulo(e) {
  exigirPermiso_();
  const hoja = e.range.getSheet(), fila = e.range.getRow();
  try {
    publicarFila_(hoja, fila);
  } finally {
    avisarArticuloNuevo_(hoja, fila); // ver Avisos.gs: aviso al CIAD y a los administradores, con el estado en que quedó
  }
}

/** Se ejecuta a mano para reintentar filas sin publicar o con error. */
function reintentarPendientes() {
  exigirPermiso_();
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const col = columnas_(hoja);
  const colEstado = col[CONFIG.COLUMNAS_ARTICULO.estado];
  const ultima = hoja.getLastRow();
  if (!colEstado || ultima < 2) return;
  // OPT: la columna de estado se lee una sola vez
  const estados = hoja.getRange(2, colEstado, ultima - 1, 1).getValues();

  for (let fila = 2; fila <= ultima; fila++) {
    const estado = String(estados[fila - 2][0]);
    if (!estado || estado.indexOf('Error') === 0) {
      publicarFila_(hoja, fila);
      Utilities.sleep(3000);
    }
  }
}

function publicarFila_(hoja, fila) {
  const reloj = cronometro_('Recibir artículo (fila ' + fila + ')');
  const bloqueo = LockService.getScriptLock();
  const A = CONFIG.COLUMNAS_ARTICULO;
  try {
    bloqueo.waitLock(60000);
  } catch (err) {
    // Sin esto la fila se queda en "Procesando" para siempre; así el panel ofrece Reintentar
    hoja.getRange(fila, columnas_(hoja)[A.estado]).setValue('Error: el sistema estaba ocupado; usa Reintentar en el panel');
    reloj.fin();
    throw err;
  }
  reloj.paso('espera de turno');

  asegurarColumnas_(hoja, [A.folio, A.estado, A.enlace, A.pdf, A.carpeta, A.palabras]);
  const col = columnas_(hoja);
  const celdaEstado = hoja.getRange(fila, col[A.estado]);
  const celdaEnlace = hoja.getRange(fila, col[A.enlace]);

  let entradaCreada = false;
  let archivo = null; // Para enviar la carpeta a la papelera si algo falla después de crearla
  try {
    if (String(celdaEstado.getValue()).indexOf('Borrador creado') === 0 ||
        String(celdaEstado.getValue()).indexOf('Publicado') === 0) return;

    const articulo = leerFila_(hoja, fila);
    let folio = String(articulo[A.folio] || '').trim().toUpperCase();
    const S = CONFIG.COLUMNAS_SOLICITUD;

    // 1. Origen de la sección, el resumen y el título
    let seccion = '', resumen = '', tituloRespaldo = '';
    let solicitud = null;

    // Autor externo sin folio: se busca su solicitud aprobada por su cuenta de Google
    if (!folio && !esCuentaCiad_(articulo[A.cuenta])) {
      const candidatas = solicitudesDisponibles_(hoja).filter(function (s) {
        return correoCoincide_(s.correo, correosDelAutor_(articulo));
      });
      if (candidatas.length !== 1) {
        celdaEstado.setValue('Por vincular · ' + (candidatas.length
          ? candidatas.length + ' solicitudes aprobadas de este autor'
          : 'no hay solicitud aprobada para este correo'));
        return;
      }
      folio = candidatas[0].folio;
      hoja.getRange(fila, col[A.folio]).setValue(folio);
    }

    if (folio) {
      // Debe venir de una solicitud aprobada
      solicitud = buscarSolicitud_(folio);
      if (!solicitud) { celdaEstado.setValue('Rechazado: folio no existe'); return; }
      if (solicitud[S.estado] !== 'Aprobada') { celdaEstado.setValue('Rechazado: folio no aprobado'); return; }
      if (folioYaPublicado_(hoja, folio, fila)) { celdaEstado.setValue('Rechazado: folio duplicado'); return; }

      seccion = solicitud[S.categoria];
      resumen = solicitud[S.resumen];
      tituloRespaldo = solicitud[S.titulo];

    } else if (esCuentaCiad_(articulo[A.cuenta])) {
      // Nota propia del CIAD: la sección se asigna en el Panel
      seccion = '';
      resumen = articulo[A.resumen];

    }

    // 2. Etiquetas: la sección sugerida, si es válida (el Panel la confirma o la cambia al publicar)
    const etiquetas = (etiquetasDe_(seccion) || CONFIG.ETIQUETAS_FIJAS.slice());

    // 3. Archivo del artículo: Word → HTML con imágenes + PDF (ver Documento.gs)
    reloj.paso('lectura y vinculación');
    const idArchivo = idsDeDrive_(articulo[A.documento])[0] || idsDeDrive_(articulo[A.pdfAnterior])[0];
    if (!idArchivo) { celdaEstado.setValue('Error: no hay archivo del artículo'); return; }

    const r = contenidoDeArticulo_(articulo, solicitud, folio, idArchivo, tituloRespaldo, resumen);
    archivo = r.archivo;
    reloj.paso('Word → HTML, imágenes, PDF y galería');
    const titulo = r.titulo;
    if (!titulo) { celdaEstado.setValue('Error: sin título'); return; }
    const contenido = r.contenido;

    const ruta = '/blogs/' + CONFIG.BLOG_ID + '/posts/' + (CONFIG.PUBLICAR_COMO_BORRADOR ? '?isDraft=true' : '');
    const entrada = blogger_('POST', ruta, {
      kind: 'blogger#post',
      title: titulo,
      content: contenido,
      labels: etiquetas
    });
    reloj.paso('crear borrador en Blogger');
    entradaCreada = true; // A partir de aquí la entrada ya usa la carpeta: no se borra aunque algo falle

    hoja.getRange(fila, col[A.pdf]).setValue('https://drive.google.com/file/d/' + archivo.idPdf + '/view');
    hoja.getRange(fila, col[A.carpeta]).setValue(archivo.carpetaUrl);
    if (archivo.palabras) hoja.getRange(fila, col[A.palabras]).setValue(archivo.palabras);
    celdaEstado.setValue((CONFIG.PUBLICAR_COMO_BORRADOR ? 'Borrador creado' : 'Publicado') + ' · ' + fechaHoy_());
    celdaEnlace.setValue('https://www.blogger.com/blog/post/edit/' + CONFIG.BLOG_ID + '/' + entrada.id);

  } catch (err) {
    console.error(err.stack); // Queda en Ejecuciones con archivo y línea
    celdaEstado.setValue('Error: ' + err.message);
    // NOTA: la entrada no se creó; su carpeta (Doc, PDF, imágenes) no sirve y al reintentar se crea otra
    if (archivo && archivo.idCarpeta && !entradaCreada) {
      try { DriveApp.getFolderById(archivo.idCarpeta).setTrashed(true); } catch (e) { console.warn('Carpeta: ' + e.message); }
    }
  } finally {
    bloqueo.releaseLock();
    reloj.fin();
  }
}

/**
 * Vuelve a convertir el Word de un artículo que ya tiene entrada (borrador o publicada) y reemplaza
 * su contenido, para que la nota reciba las mejoras del conversor. Título, etiquetas y enlace no cambian.
 * Lo usa el botón "Rehacer" del panel (volverAConvertirArticulo, en PanelServidor.gs).
 * NOTA: el Word sigue en la papelera de Drive 30 días después de publicar; después de eso ya no se puede.
 */
function reconvertirArticulo_(fila) {
  const A = CONFIG.COLUMNAS_ARTICULO, S = CONFIG.COLUMNAS_SOLICITUD;
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const col = columnas_(hoja);
  const articulo = leerFila_(hoja, fila);
  const folio = String(articulo[A.folio] || '').trim().toUpperCase();
  const postId = (String(articulo[A.enlace] || '').match(/\/(\d+)\s*$/) || [])[1];
  if (!postId) throw new Error('Este artículo todavía no tiene entrada en el blog.');
  const idWord = idsDeDrive_(articulo[A.documento])[0];
  if (!idWord) throw new Error('Este artículo no tiene Word (es un envío viejo en PDF).');
  try { DriveApp.getFileById(idWord).getName(); } catch (err) {
    throw new Error('El Word ya no existe en Drive: la papelera se vacía 30 días después de publicar.');
  }

  const solicitud = folio ? buscarSolicitud_(folio) : null;
  const r = contenidoDeArticulo_(articulo, solicitud, folio, idWord, solicitud ? solicitud[S.titulo] : '', solicitud ? solicitud[S.resumen] : '');
  blogger_('PATCH', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId, { content: r.contenido });
  if (r.archivo.palabras) hoja.getRange(fila, col[A.palabras]).setValue(r.archivo.palabras);

  // La carpeta anterior: sus imágenes del Word ya no se usan. Las de la galería se quedan.
  const nueva = DriveApp.getFolderById(r.archivo.idCarpeta);
  const idVieja = idCarpeta_(articulo[A.carpeta]);
  const publicado = String(articulo[A.estado] || '').indexOf('Publicado') === 0;
  let vieja = null;
  try { vieja = idVieja ? DriveApp.getFolderById(idVieja) : null; if (vieja && vieja.isTrashed()) vieja = null; } catch (err) { vieja = null; }

  if (publicado && vieja) {
    // Publicada: todo queda en su carpeta de "Publicados <año>"; lo nuevo se mueve ahí (mover no cambia los ID)
    const galeria = idsDeDrive_(articulo[A.imagen]).concat(idsDeDrive_(articulo[A.imagenAnterior]));
    const it = vieja.getFoldersByName('Imágenes');
    const destino = it.hasNext() ? it.next() : vieja.createFolder('Imágenes');
    const viejas = destino.getFiles();
    while (viejas.hasNext()) { const f = viejas.next(); if (galeria.indexOf(f.getId()) === -1) f.setTrashed(true); }
    const nuevas = nueva.getFoldersByName('Imágenes');
    if (nuevas.hasNext()) { const fs = nuevas.next().getFiles(); while (fs.hasNext()) fs.next().moveTo(destino); }
    nueva.setTrashed(true); // Google Doc y PDF de respaldo: ya no hacen falta porque está publicada
  } else {
    // Borrador: la carpeta nueva reemplaza a la anterior
    if (vieja) vieja.setTrashed(true);
    hoja.getRange(fila, col[A.carpeta]).setValue(r.archivo.carpetaUrl);
    hoja.getRange(fila, col[A.pdf]).setValue('https://drive.google.com/file/d/' + r.archivo.idPdf + '/view');
  }
  return 'Se volvió a convertir «' + r.titulo + '»' + (r.archivo.palabras ? ' (' + r.archivo.palabras + ' palabras)' : '') + '. Revisa cómo quedó.';
}

/**
 * Word del artículo → { archivo, titulo, contenido } listo para Blogger (ficha, subtítulo, cuerpo y galería).
 * Lo usan publicarFila_ (entrada nueva) y reconvertirArticulo_ (vuelve a convertir una existente).
 */
function contenidoDeArticulo_(articulo, solicitud, folio, idArchivo, tituloRespaldo, resumen) {
  const A = CONFIG.COLUMNAS_ARTICULO, S = CONFIG.COLUMNAS_SOLICITUD;
  const tituloFormulario = String(articulo[A.titulo] || tituloRespaldo || '').trim();
  const archivo = procesarArchivoArticulo_(idArchivo, (folio || 'Nota CIAD') + ' · ' + (tituloFormulario || 'articulo'), tituloFormulario);

  // Prioridad: formulario → Word (lo que el autor llena en el Form tiene prioridad; el Word es respaldo)
  const titulo = String(tituloFormulario || archivo.titulo).trim().slice(0, 150);

  const fichaFormulario = {
    nombre: articulo[A.nombre],
    fecha: fechaCorta_(articulo[A.enviado]),
    correo: correoParaMostrar_(articulo) || (solicitud ? solicitud[S.correo] : ''),
    cargo: articulo[A.cargo],
    // Las notas propias del CIAD no tienen solicitud: su vínculo es el propio CIAD
    vinculo: vinculoDeSolicitud_(solicitud) || (esCuentaCiad_(articulo[A.cuenta]) ? CONFIG.VINCULO_CIAD : '')
  };
  const ficha = combinarFicha_(fichaFormulario, archivo.ficha);
  // La fecha de la ficha es la del artículo (Word); si no tiene, la del envío
  ficha.fecha = normalizarFecha_((archivo.ficha && archivo.ficha.fecha) || fichaFormulario.fecha);

  const idsImagenes = idsDeDrive_(articulo[A.imagen]).concat(idsDeDrive_(articulo[A.imagenAnterior])); // → galería al final
  compartirGaleria_(idsImagenes);

  const contenido = armarContenido_({
    subtitulo: articulo[A.subtitulo] || articulo[A.resumen] || archivo.subtitulo,
    ficha: ficha,
    resumen: archivo.modo === 'pdf' ? resumen : '', // Con Word, el artículo ya trae su texto
    cuerpo: archivo.html,
    palabras: archivo.palabras, // → tiempo de lectura
    idPdf: archivo.idPdf,
    idsImagenes: idsImagenes,
    // La del Form (o la que se puso en el panel); al rehacer desde el Word se conserva con su encuadre
    portada: (function (id) {
      if (!id) return '';
      compartirConEnlace_(id); // La del Form está en la carpeta de subidas, que no es pública
      return portadaHtml_(id, encuadre_(articulo[PANEL.ARTICULO.encuadrePc]), encuadre_(articulo[PANEL.ARTICULO.encuadreCelular]), titulo,
        idsDeDrive_(articulo[PANEL.ARTICULO.tarjeta])[0], encuadre_(articulo[PANEL.ARTICULO.encuadreTarjeta]));
    })(idPortada_(articulo))
  });
  return { archivo: archivo, titulo: titulo, contenido: contenido };
}

function armarContenido_(d) {
  let html = '<div class="articulo-ciad">';
  if (d.portada) html += d.portada; // Imagen principal (se agrega desde el panel)

  // Subtítulo primero: las tarjetas de las secciones muestran el inicio del texto
  if (d.subtitulo) {
    html += '<h2 class="articulo-subtitulo" style="line-height:1.35;margin:0 0 1em;">' +
      escaparHtml_(d.subtitulo) + '</h2>';
  }

  // Ficha del autor: nombre, fecha, correo, cargo y vínculo (lo que haya)
  html += fichaHtml_(d.ficha || {});

  // Tiempo de lectura: palabras del cuerpo (sin referencias) a 200 por minuto
  if (d.palabras) {
    html += '<p class="articulo-lectura">⏱ Lectura de ' + Math.max(1, Math.round(d.palabras / PALABRAS_POR_MINUTO_)) + ' min</p>';
  }

  if (d.resumen) {
    html += '<p class="articulo-resumen">' + escaparHtml_(d.resumen).replace(/\n/g, '<br/>') + '</p>';
  }

  // Cuerpo convertido desde el Word (texto e imágenes en su lugar)
  if (d.cuerpo) {
    html += '<div class="articulo-cuerpo">' + d.cuerpo + '</div>';
  }

  html += '<!--more-->';

  // Botón de descarga: solo en envíos antiguos en PDF (sin texto convertido), para que la entrada no quede vacía
  if (!d.cuerpo && d.idPdf) {
    html += '<p class="articulo-descarga" style="margin-top:1.5em;">' +
      '<a href="https://drive.google.com/uc?export=download&amp;id=' + d.idPdf + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;background:#00723f;color:#fff;padding:.75em 1.5em;border-radius:999px;text-decoration:none;font-weight:700;">' +
      'Descargar el artículo en PDF</a></p>';
  }

  html += galeriaHtml_(d.idsImagenes || []);

  html += '</div>';
  html += estiloArticulo_(); // Al final: las tarjetas de las secciones usan el inicio del texto como resumen
  return html;
}

/**
 * Galería al final del artículo con las imágenes opcionales del formulario; sin imágenes no se genera.
 * Cada miniatura abre la imagen grande (el visor del tema la muestra en la misma página; sin el tema,
 * se abre en otra pestaña).
 */
function galeriaHtml_(ids) {
  if (!ids.length) return '';
  const fotos = ids.map(function (id, i) {
    const n = i + 1;
    return '<a class="articulo-galeria-foto" href="https://drive.google.com/thumbnail?id=' + id + '&amp;sz=w2000" target="_blank" rel="noopener" ' +
      'style="display:block;border-radius:10px;overflow:hidden;background:#eef1f4;">' +
      '<img src="https://drive.google.com/thumbnail?id=' + id + '&amp;sz=w800" alt="Imagen ' + n + ' de ' + ids.length + ' de la galería" loading="lazy" ' +
      'style="display:block;width:100%;aspect-ratio:4/3;object-fit:cover;margin:0;border-radius:0;"/></a>';
  }).join('');
  return '<section class="articulo-galeria" style="margin:2.5em 0 0;padding-top:1.5em;border-top:1px solid #e2e7ed;">' +
    '<h3 class="articulo-galeria-titulo" style="margin:0 0 .8em;">Galería</h3>' +
    '<div class="articulo-galeria-rejilla" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">' +
    fotos + '</div></section>';
}

/**
 * Tipografía y colores institucionales del artículo.
 *   Título:  Bitter, verde Pantone 356 (#00723F)
 *   Resumen: Bitter Italic, azul Pantone Reflex Blue (#20419A)
 *   Texto:   Noto Sans, negro (#000000)
 * NOTA: el título lo pinta el tema; se selecciona con :has() solo en entradas que tienen .articulo-ciad.
 */
const PALABRAS_POR_MINUTO_ = 200; // Ritmo de lectura promedio en español para el "Lectura de N min"

const ESTILO_ARTICULO_ = {
  verde: '#00723F',
  azul: '#20419A',
  negro: '#000000'
};

// El <style> que estiloArticulo_ deja en cada nota (cualquier versión anterior)
const ESTILO_NOTA_ = /<style>@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Bitter[\s\S]*?<\/style>/g;

/** Devuelve la nota con el estilo actual: quita el que tenga y pone el nuevo al final. */
function conEstiloAlDia_(html) {
  return String(html || '').replace(ESTILO_NOTA_, '') + estiloArticulo_();
}

/**
 * Se ejecuta desde el editor después de cambiar estiloArticulo_: actualiza el estilo en todas las notas
 * del Publicador (publicadas, borradores y programadas). Solo cambia el <style>; texto, imagen,
 * etiquetas y fecha quedan igual.
 * Las notas hechas a mano en Blogger no se tocan. Si se corta por tiempo, se ejecuta otra vez
 * (las que ya están actualizadas se saltan).
 */
function actualizarEstiloDeNotas() {
  exigirPermiso_();
  const inicio = Date.now(), estilo = estiloArticulo_();
  let token = '', hechas = 0, alDia = 0, errores = 0;
  do {
    const r = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/posts?status=live&status=draft&status=scheduled&view=ADMIN&fetchBodies=true&maxResults=20' +
      '&fields=nextPageToken,items(id,title,content)' + (token ? '&pageToken=' + token : ''));
    (r.items || []).forEach(function (p) {
      const html = p.content || '';
      if (html.indexOf('<div class="articulo-ciad">') === -1) return;
      if (html.indexOf(estilo) !== -1) { alDia++; return; }
      try { blogger_('PATCH', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + p.id, { content: conEstiloAlDia_(html) }); hechas++; }
      catch (err) { errores++; console.warn('«' + p.title + '»: ' + err.message); }
    });
    token = r.nextPageToken || '';
  } while (token && Date.now() - inicio < MANTENIMIENTO.TIEMPO_MAXIMO_MS);
  const mensaje = hechas + ' nota(s) actualizadas, ' + alDia + ' ya estaban al día' + (errores ? ', ' + errores + ' con error (ver registro)' : '') +
    (token ? '. Se cortó por tiempo: ejecuta otra vez.' : '.');
  Logger.log(mensaje);
  return mensaje;
}

function estiloArticulo_() {
  const c = ESTILO_ARTICULO_;
  return '<style>' +
    "@import url('https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,600;0,700;1,400;1,500&family=Noto+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap');" +
    ".post:has(.articulo-ciad) .post-title,.post:has(.articulo-ciad) .post-title a{font-family:'Bitter',Georgia,serif;color:" + c.verde + ";}" +
    ".articulo-ciad{font-family:'Noto Sans',Arial,sans-serif;color:" + c.negro + ";}" +
    ".articulo-ciad h2,.articulo-ciad h3{font-family:'Bitter',Georgia,serif;font-weight:700;color:" + c.verde + ";}" +
    ".articulo-ciad .articulo-subtitulo,.articulo-ciad .articulo-resumen{font-family:'Bitter',Georgia,serif;font-style:italic;font-weight:400;color:" + c.azul + ";}" +
    ".articulo-ciad p,.articulo-ciad li,.articulo-ciad td,.articulo-ciad th{color:" + c.negro + ";}" +
    ".articulo-ciad .articulo-cuerpo p:not(.articulo-referencia){text-align:justify;}" + // DEF-018
    // Referencias del mismo tamaño que el texto (= 14pt del tema, US7); las notas antiguas traen font-size:.92em en la etiqueta
    ".post-body .articulo-ciad .articulo-cuerpo .articulo-referencia{font-size:14pt!important;}" +

    ".articulo-ciad a{color:" + c.verde + ";}" +
    ".articulo-ciad .articulo-lectura{margin:-.75em 0 1.5em;font-size:.88em;color:#5d6b7c;}" +
    // Citas numeradas [n]: número volado y burbuja al pasar el cursor o enfocarlo (citasNumeradas_, Documento.gs)
    ".articulo-ciad sup.cita{position:relative;line-height:0;}" +
    ".articulo-ciad sup.cita>a{text-decoration:none;font-weight:700;padding:0 1px;}" +
    ".articulo-ciad .cita-burbuja{display:none;position:absolute;left:50%;bottom:100%;transform:translateX(-50%);padding-bottom:8px;z-index:30;}" +
    ".articulo-ciad sup.cita:hover .cita-burbuja,.articulo-ciad sup.cita:focus-within .cita-burbuja{display:block;}" +
    ".articulo-ciad .cita-caja{display:block;width:min(300px,80vw);background:#fff;border:1px solid #dfe5ea;border-radius:10px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.16);padding:.75em .9em;font-size:13px;line-height:1.45;font-weight:400;text-align:left;color:" + c.negro + ";white-space:normal;}" +
    ".articulo-ciad .cita-acciones{display:flex;flex-wrap:wrap;gap:.25em 1em;margin-top:.5em;}" +
    ".articulo-ciad .cita-acciones a{font-weight:600;text-decoration:none;}" +
    ".articulo-ciad .ref-n{font-weight:700;color:" + c.verde + ";}" +
    ".articulo-ciad [id^=\"ref-\"]{scroll-margin-top:80px;}" +
    ".articulo-ciad [id^=\"ref-\"]:target{background:#fdf4dc;}" +
    // Imagen principal. Celular: banner arriba (4:1, como los de las secciones), recortado.
    ".articulo-ciad .articulo-portada{position:relative;margin:0 0 1.25em;overflow:hidden;border-radius:12px;aspect-ratio:" + PORTADA_PROPORCION_.celular + ";}" +
    ".articulo-ciad .articulo-portada .articulo-tarjeta{display:none!important;}" +
    ".articulo-ciad .articulo-portada img{position:absolute!important;inset:0;display:block;width:100%!important;height:100%!important;max-width:none!important;object-fit:cover;object-position:var(--cel,50% 50%);" +
      "transform:scale(var(--celz,1));transform-origin:var(--cel,50% 50%);margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;}" +
    // Computadora: dos columnas de la misma altura. Izquierda: título, subtítulo, ficha y lectura (ellos fijan la altura);
    // derecha: la imagen completa (nunca recortada si no se acerca). NOTA: el título es del tema
    // (está fuera de la entrada); por eso la rejilla va en .post y las cajas intermedias usan display:contents.
    "@media (min-width:701px){" +
      ".post:has(.articulo-portada){display:grid;grid-template-columns:minmax(0,1fr) 40%;column-gap:1.75em;align-items:start;}" +
      ".post:has(.articulo-portada)>*,.post:has(.articulo-portada) .articulo-ciad>*{grid-column:1/-1;}" +
      ".post:has(.articulo-portada) .post-body,.post:has(.articulo-portada) .articulo-ciad{display:contents;}" +
      ".post:has(.articulo-portada) .post-title{grid-column:1;grid-row:1;}" +
      ".post:has(.articulo-portada) .articulo-ciad .articulo-subtitulo{grid-column:1;grid-row:2;}" +
      ".post:has(.articulo-portada) .articulo-ciad .articulo-ficha{grid-column:1;grid-row:3;}" +
      ".post:has(.articulo-portada) .articulo-ciad .articulo-lectura{grid-column:1;grid-row:4;}" +
      ".post:has(.articulo-portada) .articulo-ciad .articulo-portada{grid-column:2;grid-row:1/span 4;align-self:stretch;aspect-ratio:auto;min-height:220px;margin:0 0 1.5em;}" +
      ".post:has(.articulo-portada) .articulo-ciad .articulo-portada img{object-fit:contain;object-position:var(--pc,50% 50%);transform:scale(var(--pcz,1));transform-origin:var(--pc,50% 50%);}" +
    "}" +
    '</style>';
}

/** Banner de celular; igual que PORTADA_VISTAS en Panel.html. En computadora, la altura la define el texto de la izquierda. */
const PORTADA_PROPORCION_ = { celular: '4/1' };

/**
 * pc y cel = { x, y } de 0 a 100: posición de la imagen (0 = izquierda/arriba); z: acercamiento en %
 * (100 = sin acercar). Cada vista tiene su propio encuadre (variables --pc y --cel; el CSS elige según
 * el ancho). Va antes que el subtítulo.
 */
function portadaHtml_(id, pc, cel, titulo, idTarjeta, tar) {
  tar = tar || { x: 50, y: 50, z: 100 };
  return '<figure class="articulo-portada" style="--pc:' + pc.x + '% ' + pc.y + '%;--pcz:' + (pc.z || 100) / 100 +
    ';--cel:' + cel.x + '% ' + cel.y + '%;--celz:' + (cel.z || 100) / 100 + ';">' +
    // Imagen de las tarjetas (Inicio, secciones, buscador…), oculta aquí: las listas toman esta primera imagen.
    // Con recorte del panel se usa ese recorte; si no (un GIF no se recorta), la principal con su encuadre en #ciad=x,y,z,
    // que aplica el script del tema (object-position y acercamiento) sin quitarle la animación.
    '<img class="articulo-tarjeta" src="https://drive.google.com/thumbnail?id=' + (idTarjeta
      ? idTarjeta + '&amp;sz=w1280'
      : id + '&amp;sz=w1280#ciad=' + (tar.x || 0) + ',' + (tar.y || 0) + ',' + (tar.z || 100)) + '" alt="" aria-hidden="true" style="display:none"/>' +
    '<img src="https://drive.google.com/thumbnail?id=' + id + '&amp;sz=w1600" ' +
    'alt="' + escaparHtml_('Imagen principal' + (titulo ? ': ' + titulo : '')) + '"/></figure>';
}

/** "30 70" o "30 70 150" (celda de la hoja) → { x: 30, y: 70, z: 150 }; z = acercamiento en % (100 = sin acercar). Vacío o inválido → centrada. */
function encuadre_(texto) {
  const n = String(texto || '').match(/^\s*(\d{1,3})\s+(\d{1,3})(?:\s+(\d{3}))?\s*$/);
  const z = n && n[3] ? +n[3] : 100;
  return n && +n[1] <= 100 && +n[2] <= 100 && z >= 100 && z <= 300 ? { x: +n[1], y: +n[2], z: z } : { x: 50, y: 50, z: 100 };
}

/** Imagen principal de una fila (leerFila_): la que se puso en el panel o, si no hay, la que subió el autor en el Form. */
function idPortada_(articulo) {
  return idsDeDrive_(articulo[PANEL.ARTICULO.portada])[0] || idsDeDrive_(articulo[CONFIG.COLUMNAS_ARTICULO.portada])[0] || '';
}

/**
 * Pone (o quita, con portada '') la imagen principal en el HTML de una entrada existente sin tocar
 * lo demás (se respetan los cambios hechos a mano en Blogger). También actualiza el <style> del artículo.
 */
function conPortada_(contenido, portada) {
  const inicio = '<div class="articulo-ciad">';
  if (contenido.indexOf(inicio) === -1) throw new Error('Esta entrada no tiene el formato del publicador; usa “Rehacer” primero.');
  const sin = contenido
    .replace(/<figure class="articulo-portada"[\s\S]*?<\/figure>/g, '');
  const i = sin.indexOf(inicio) + inicio.length;
  return conEstiloAlDia_(sin.slice(0, i) + portada + sin.slice(i));
}


// ===== Ficha del autor =====

const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function dosDigitos_(n) { return (n < 10 ? '0' : '') + n; }

/** Fecha del blog: "23/09/2026". */
function fechaCorta_(valor) {
  const d = valor instanceof Date ? valor : (valor ? new Date(valor) : null);
  if (!d || isNaN(d)) return '';
  return dosDigitos_(d.getDate()) + '/' + dosDigitos_(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * Convierte la fecha escrita en el Word a "23/09/2026".
 * Entiende "Septiembre/23/2026", "23 de septiembre de 2026", "septiembre 23, 2026", "23/09/2026"
 * y "09/23/2026". Si es ambigua (por ejemplo "05/06/2026") o no la entiende, la deja igual.
 */
function normalizarFecha_(texto) {
  const original = String(texto || '').trim();
  if (!original) return '';
  const t = normalizar_(original);

  // Con nombre de mes
  const iMes = MESES_.map(function (m) { return normalizar_(m); })
    .concat(['setiembre'])
    .findIndex(function (m) { return t.indexOf(m) !== -1; });
  if (iMes !== -1) {
    const mes = iMes === 12 ? 9 : iMes + 1;
    const anio = (t.match(/\b(\d{4})\b/) || [])[1];
    const dia = (t.replace(/\b\d{4}\b/, '').match(/\b(\d{1,2})\b/) || [])[1];
    if (anio && dia && +dia >= 1 && +dia <= 31) return dosDigitos_(+dia) + '/' + dosDigitos_(mes) + '/' + anio;
    return original;
  }

  // Solo números
  const n = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (n) {
    const a = +n[1], b = +n[2], anio = n[3].length === 2 ? '20' + n[3] : n[3];
    if (a > 12 && b <= 12) return dosDigitos_(a) + '/' + dosDigitos_(b) + '/' + anio;   // día/mes
    if (b > 12 && a <= 12) return dosDigitos_(b) + '/' + dosDigitos_(a) + '/' + anio;   // mes/día (formato Edu bits)
    if (a === b) return dosDigitos_(a) + '/' + dosDigitos_(b) + '/' + anio;
  }
  return original; // Ambigua o desconocida
}

/** Correo del autor: el de contacto si el Form 2 todavía lo pide; si no, el de la cuenta de Google que envió. */
function correoAutor_(datos) {
  const A = CONFIG.COLUMNAS_ARTICULO;
  // IMPORTANTE: la cuenta de Google que envió el Form tiene prioridad (no se puede falsificar). El "correo de contacto"
  // solo se usa en envíos antiguos que no registraron la cuenta.
  return String(datos[A.cuenta] || datos[A.correoAnterior] || '').trim();
}

/** Correo que se muestra en la nota: el de contacto si escribió uno válido; si no, el de su cuenta. */
function correoParaMostrar_(datos) {
  const contacto = String(datos[CONFIG.COLUMNAS_ARTICULO.correo] || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacto) ? contacto : correoAutor_(datos);
}

/** Correos con los que se busca la solicitud del autor: solo su cuenta de Google (o el de contacto en envíos antiguos). */
function correosDelAutor_(datos) {
  return [correoAutor_(datos)].filter(Boolean);
}

function vinculoDeSolicitud_(solicitud) {
  if (!solicitud) return '';
  const S = CONFIG.COLUMNAS_SOLICITUD;
  const vinculo = String(solicitud[S.vinculo] || '').trim();
  if (vinculo === 'UABC') {
    return ['Universidad Autónoma de Baja California', String(solicitud[S.unidad] || '').trim()].filter(Boolean).join(', ');
  }
  if (/otra/i.test(vinculo)) return String(solicitud[S.organizacion] || '').trim() || vinculo;
  return vinculo; // "Independiente" o vacío
}

/** Cada dato se toma del Word si existe; si no, del formulario; si no, queda vacío. */
function combinarFicha_(delWord, delFormulario) {
  const w = delWord || {}, f = delFormulario || {};
  const ficha = {};
  ['nombre', 'fecha', 'correo', 'cargo', 'vinculo'].forEach(function (k) {
    ficha[k] = String(w[k] || f[k] || '').trim();
  });
  ficha.fecha = normalizarFecha_(ficha.fecha);
  return ficha;
}

function fichaHtml_(f) {
  const lineas = [];
  if (f.nombre) lineas.push('<p style="margin:0;font-weight:700;font-size:1.05em;">' + escaparHtml_(f.nombre) + '</p>');
  if (f.fecha) lineas.push('<p style="margin:.15em 0 0;font-size:.92em;">' + escaparHtml_(f.fecha) + '</p>');
  if (f.correo && (typeof DOCUMENTO === 'undefined' || DOCUMENTO.MOSTRAR_CORREO_EN_FIRMA)) {
    lineas.push('<p style="margin:.15em 0 0;"><a href="mailto:' + escaparHtml_(f.correo) + '" style="color:#00723f;">' + escaparHtml_(f.correo) + '</a></p>');
  }
  if (f.cargo) lineas.push('<p style="margin:.15em 0 0;">' + escaparHtml_(f.cargo) + '</p>');
  if (f.vinculo) lineas.push('<p style="margin:.15em 0 0;">' + escaparHtml_(f.vinculo) + '</p>');
  if (!lineas.length) return '';

  return '<div class="articulo-ficha" style="border-left:4px solid #00723f;background:#f6f8fa;border-radius:0 12px 12px 0;padding:1em 1.25em;margin:0 0 1.75em;line-height:1.5;">' +
    lineas.join('') + '</div>';
}


// ===== Blogger API =====

// NOTA: hay un solo cliente de Blogger, blogger_() en PanelServidor.gs (reintentos y mensajes claros).
// Este nombre se conserva para no romper llamadas antiguas o funciones que alguien tenga en el editor.
function llamarBlogger_(metodo, ruta, cuerpo) {
  return blogger_(metodo, ruta, cuerpo);
}


// ===== Funciones auxiliares =====

/** Primera pestaña del archivo (la de respuestas del formulario). */
function hojaDeRespuestas_(idArchivo) {
  return SpreadsheetApp.openById(idArchivo).getSheets()[0];
}

function normalizar_(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); // Los encabezados del Form a veces traen espacios dobles
}

/**
 * OPT: memoria de encabezados por ejecución, para que cada leerFila_ no vuelva a leer la fila 1
 * de la hoja (una llamada a Sheets por fila). asegurarColumnas_ la limpia al crear columnas.
 */
const MEMORIA_COLUMNAS_ = new Map();

function claveHoja_(hoja) {
  return hoja.getParent().getId() + '|' + hoja.getSheetId();
}

/** { 'Encabezado original': númeroDeColumna }, buscado sin acentos ni mayúsculas. */
function columnas_(hoja) {
  const clave = claveHoja_(hoja);
  if (MEMORIA_COLUMNAS_.has(clave)) return MEMORIA_COLUMNAS_.get(clave);
  const resultado = columnasDeEncabezados_(hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]);
  MEMORIA_COLUMNAS_.set(clave, resultado);
  return resultado;
}

/** Igual que columnas_, pero a partir de una fila de encabezados ya leída. */
function columnasDeEncabezados_(encabezados) {
  const porNormal = {};
  encabezados.forEach(function (h, i) {
    const k = normalizar_(h);
    if (k && !(k in porNormal)) porNormal[k] = i + 1; // Si hay encabezados repetidos, gana el primero
  });

  const resultado = {};
  // PANEL.ARTICULO: columnas que agrega el panel (imagen principal y sus encuadres); sin ellas, leerFila_ no las ve
  [CONFIG.COLUMNAS_SOLICITUD, CONFIG.COLUMNAS_ARTICULO, PANEL.ARTICULO].forEach(function (grupo) {
    Object.keys(grupo).forEach(function (k) {
      const n = porNormal[normalizar_(grupo[k])];
      if (n) resultado[grupo[k]] = n;
    });
  });
  return resultado;
}

function asegurarColumnas_(hoja, nombres) {
  const existentes = columnas_(hoja);
  let creo = false;
  nombres.forEach(function (nombre) {
    if (!existentes[nombre]) {
      const nueva = hoja.getLastColumn() + 1;
      hoja.getRange(1, nueva).setValue(nombre).setFontWeight('bold');
      creo = true;
    }
  });
  if (creo) {
    MEMORIA_COLUMNAS_.delete(claveHoja_(hoja));
    if (typeof MEMORIA_ENCABEZADOS_ !== 'undefined') MEMORIA_ENCABEZADOS_.delete(claveHoja_(hoja)); // ver PanelServidor.gs
  }
}

/** Devuelve { 'Encabezado de CONFIG': valor } de una fila. */
function leerFila_(hoja, fila) {
  const col = columnas_(hoja);
  const valores = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0];
  const datos = {};
  Object.keys(col).forEach(function (nombre) { datos[nombre] = valores[col[nombre] - 1]; });
  return datos;
}

function buscarSolicitud_(folio) {
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_SOLICITUDES_ID);
  const col = columnas_(hoja);
  const colFolio = col[CONFIG.COLUMNAS_SOLICITUD.folio];
  if (!colFolio || hoja.getLastRow() < 2) return null;

  const folios = hoja.getRange(2, colFolio, hoja.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < folios.length; i++) {
    if (String(folios[i][0]).trim().toUpperCase() === folio) return leerFila_(hoja, i + 2);
  }
  return null;
}

/**
 * Solicitudes aprobadas que todavía no tienen un artículo creado o publicado.
 * OPT: lee cada hoja una sola vez, en lugar de hacer varias lecturas por solicitud y por artículo.
 */
function solicitudesDisponibles_(hojaArticulos) {
  const S = CONFIG.COLUMNAS_SOLICITUD;
  const ocupados = foliosOcupados_(hojaArticulos, 0);
  const valores = hojaDeRespuestas_(CONFIG.HOJA_SOLICITUDES_ID).getDataRange().getValues();
  if (valores.length < 2) return [];
  const col = columnasDeEncabezados_(valores[0]);
  const v = function (fila, nombre) { return col[nombre] ? fila[col[nombre] - 1] : ''; };

  const disponibles = [];
  for (let i = 1; i < valores.length; i++) {
    const f = valores[i];
    const folio = String(v(f, S.folio) || '').trim().toUpperCase();
    if (!folio || v(f, S.estado) !== 'Aprobada' || ocupados[folio]) continue;
    disponibles.push({ folio: folio, correo: String(v(f, S.correo) || ''), nombre: String(v(f, S.nombre) || ''), titulo: String(v(f, S.titulo) || '') });
  }
  return disponibles;
}

/** { FOLIO: true } de los artículos con borrador creado o publicado (sin contar filaExcluida). */
function foliosOcupados_(hojaArticulos, filaExcluida) {
  const A = CONFIG.COLUMNAS_ARTICULO;
  const col = columnas_(hojaArticulos);
  const ocupados = {};
  const ultima = hojaArticulos.getLastRow();
  if (!col[A.folio] || !col[A.estado] || ultima < 2) return ocupados;
  const folios = hojaArticulos.getRange(2, col[A.folio], ultima - 1, 1).getValues();
  const estados = hojaArticulos.getRange(2, col[A.estado], ultima - 1, 1).getValues();
  for (let i = 0; i < folios.length; i++) {
    if (i + 2 === filaExcluida) continue;
    const estado = String(estados[i][0]);
    if (estado.indexOf('Borrador creado') === 0 || estado.indexOf('Publicado') === 0) {
      const f = String(folios[i][0]).trim().toUpperCase();
      if (f) ocupados[f] = true;
    }
  }
  return ocupados;
}

function correoCoincide_(correo, lista) {
  const c = String(correo || '').trim().toLowerCase();
  return !!c && lista.some(function (x) { return String(x || '').trim().toLowerCase() === c; });
}

function folioYaPublicado_(hoja, folio, filaActual) {
  return !!foliosOcupados_(hoja, filaActual)[folio];
}

/** "Innovación: Casos de éxito" → ['formato-articulo', 'categoria-innovacion', 'Casos de éxito'] */
function etiquetasDe_(opcion) {
  const texto = String(opcion || '');
  for (let i = 0; i < CONFIG.SECCIONES.length; i++) {
    const s = CONFIG.SECCIONES[i];
    const prefijo = s.nombre + ': ';
    if (texto.indexOf(prefijo) === 0) {
      const sub = texto.slice(prefijo.length).trim();
      if (s.subapartados[sub]) return CONFIG.ETIQUETAS_FIJAS.concat([s.etiqueta, s.subapartados[sub]]);
    }
  }
  return null;
}

/** Extrae los IDs de archivos de Drive de la celda que llena Forms. */
function idsDeDrive_(celda) {
  const ids = [];
  String(celda || '').replace(/[?&]id=([\w-]+)/g, function (_, id) { ids.push(id); });
  return ids;
}

/**
 * OPT: las imágenes de la galería están en la carpeta de subidas del Form ("… (File responses)").
 * Esa carpeta se comparte una sola vez y las imágenes heredan el permiso (≈1.2 s menos por imagen).
 * Si no se puede (política del dominio), se comparte imagen por imagen.
 */
function compartirGaleria_(ids) {
  if (!ids.length) return;
  const props = PropertiesService.getScriptProperties();
  let idCarpeta = '';
  try {
    const padres = DriveApp.getFileById(ids[0]).getParents();
    idCarpeta = padres.hasNext() ? padres.next().getId() : '';
  } catch (err) { idCarpeta = ''; }

  if (idCarpeta && props.getProperty('GALERIA_COMPARTIDA') !== idCarpeta) {
    try {
      DriveApp.getFolderById(idCarpeta).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty('GALERIA_COMPARTIDA', idCarpeta);
    } catch (err) {
      console.warn('No se pudo compartir la carpeta de la galería: ' + err.message);
    }
  }
  const compartida = props.getProperty('GALERIA_COMPARTIDA');
  ids.forEach(function (id, i) {
    // Imágenes de otra carpeta (envíos antiguos) o sin carpeta compartida: una por una
    if (i === 0 && idCarpeta && idCarpeta === compartida) return;
    if (i > 0 && idCarpeta && idCarpeta === compartida && mismaCarpeta_(id, idCarpeta)) return;
    compartirConEnlace_(id);
  });
}

function mismaCarpeta_(idArchivo, idCarpeta) {
  try {
    const p = DriveApp.getFileById(idArchivo).getParents();
    return p.hasNext() && p.next().getId() === idCarpeta;
  } catch (err) { return false; }
}

function compartirConEnlace_(idArchivo) {
  try {
    DriveApp.getFileById(idArchivo).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    throw new Error('No se pudo compartir el archivo en Drive: ' + err.message);
  }
}

/**
 * Bloquea las llamadas desde el navegador de cuentas que no son usuarios del panel (Usuarios.gs).
 * En los disparadores automáticos el usuario es la cuenta dueña (o vacío), así que pasan.
 */
function exigirPermiso_() {
  const correo = Session.getActiveUser().getEmail();
  if (correo && !puedeUsarPanel_(correo)) throw new Error('Sin permiso.');
}


/** true si el correo registrado por Google en el Form 2 es una cuenta del CIAD. */
function esCuentaCiad_(correo) {
  const c = String(correo || '').trim().toLowerCase();
  return !!c && CONFIG.CUENTAS_CIAD.some(function (x) { return x.trim().toLowerCase() === c; });
}

function escaparHtml_(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Correos con formato institucional ---

/**
 * d = { titulo, nombre, parrafos: [html…], nota, boton: { texto, url } }
 * Los párrafos ya vienen escapados (pueden traer <strong>).
 */
function plantillaCorreo_(d) {
  const K = CONFIG.CORREO;
  const verde = '#00723f';
  let cuerpo = '';
  if (d.nombre) cuerpo += '<p style="margin:0 0 14px;">Hola ' + escaparHtml_(d.nombre) + ':</p>';
  (d.parrafos || []).forEach(function (p) { cuerpo += '<p style="margin:0 0 14px;">' + p + '</p>'; });
  if (d.nota) {
    cuerpo += '<div style="border-left:3px solid #f2a900;background:#fdf7e6;padding:10px 14px;margin:0 0 16px;border-radius:0 6px 6px 0;">' +
      '<strong>Comentario del equipo editorial:</strong><br>' + escaparHtml_(d.nota).replace(/\n/g, '<br>') + '</div>';
  }
  if (d.boton && d.boton.url) {
    cuerpo += '<p style="margin:22px 0;"><a href="' + escaparHtml_(d.boton.url) + '" style="background:' + verde +
      ';color:#ffffff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">' +
      escaparHtml_(d.boton.texto) + '</a></p>';
  }
  return '<div style="background:#f4f6f8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e7ed;">' +
      '<tr><td style="background:#ffffff;padding:18px 28px;border-bottom:4px solid ' + verde + ';">' +
        '<img src="' + K.logo + '" alt="CIAD" height="40" style="display:block;height:40px;width:auto;border:0;"></td></tr>' +
      '<tr><td style="padding:26px 28px 8px;color:#1d2a3a;font-size:15px;line-height:1.6;">' +
        (d.titulo ? '<h1 style="font-size:20px;color:' + verde + ';margin:0 0 16px;">' + escaparHtml_(d.titulo) + '</h1>' : '') +
        cuerpo +
      '</td></tr>' +
      '<tr><td style="padding:16px 28px 22px;border-top:1px solid #e2e7ed;color:#5d6b7c;font-size:12px;line-height:1.5;">' +
        '<strong style="color:#1d2a3a;">' + escaparHtml_(K.firma) + '</strong><br>' + escaparHtml_(K.institucion) + '<br>' +
        '<a href="mailto:' + K.contacto + '" style="color:' + verde + ';">' + K.contacto + '</a> · ' +
        '<a href="' + K.blog + '" style="color:' + verde + ';">' + K.blog.replace(/^https?:\/\//, '') + '</a>' +
      '</td></tr>' +
    '</table></div>';
}

function enviarCorreo_(para, asunto, d) {
  // IMPORTANTE: todo correo del sistema lleva "Blog del CIAD" en el asunto; los filtros de Gmail de investigacion.ciad lo usan para etiquetarlo
  if (!/blog del ciad/i.test(asunto)) asunto += ' · Blog del CIAD';
  MailApp.sendEmail({
    to: para,
    subject: asunto,
    htmlBody: plantillaCorreo_(d),
    name: CONFIG.NOMBRE_REMITENTE,
    replyTo: CONFIG.CORREO.contacto
  });
}

// --- Historial de notas ---

const COLUMNAS_HISTORIAL_ = ['Fecha', 'Acción', 'Folio', 'Título', 'Autor(es)', 'Correo', 'Sección', 'Etiquetas adicionales', 'Enlace', 'Moderado por', 'Nota'];

function hojaHistorial_() {
  const libro = SpreadsheetApp.openById(CONFIG.HISTORIAL_ID || CONFIG.HOJA_ARTICULOS_ID);
  let hoja = libro.getSheetByName(CONFIG.HISTORIAL_PESTANA);
  if (!hoja) {
    hoja = libro.insertSheet(CONFIG.HISTORIAL_PESTANA, libro.getSheets().length); // Al final: la primera pestaña sigue siendo la de respuestas
    hoja.getRange(1, 1, 1, COLUMNAS_HISTORIAL_.length).setValues([COLUMNAS_HISTORIAL_]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/** Agrega una fila al historial. Si falla, nunca detiene la acción principal. */
function registrarHistorial_(accion, d) {
  try {
    hojaHistorial_().appendRow([new Date(), accion, d.folio || '', d.titulo || '', d.autor || '', d.correo || '',
      d.seccion || '', d.etiquetas || '', d.enlace || '', Session.getActiveUser().getEmail() || '', d.nota || '']);
  } catch (err) {
    console.error('Historial: ' + err.message);
  }
}

// --- Depuración de Drive ---

/** Envía un archivo de Drive a la papelera (recuperable 30 días). Devuelve true si lo logró; nunca lanza error. */
function papelera_(id) {
  if (!id) return false;
  try { DriveApp.getFileById(id).setTrashed(true); return true; } catch (err) { console.warn('Papelera ' + id + ': ' + err.message); return false; }
}

/** ID de una carpeta de Drive a partir de su URL (…/folders/<id>); '' si la celda no tiene una. */
function idCarpeta_(url) {
  const m = String(url || '').match(/folders\/([\w-]+)/);
  return m ? m[1] : '';
}

/**
 * true si otra fila usa la misma carpeta, Word o imagen principal (una copia hecha con «Clonar», o la
 * original de una copia). En ese caso la depuración no toca Drive, para no dejar a la otra nota sin
 * sus archivos.
 */
function usadosPorOtraFila_(datos) {
  const A = CONFIG.COLUMNAS_ARTICULO, X = PANEL.ARTICULO;
  const ids = function (f) {
    return [idCarpeta_(f(A.carpeta))].concat(idsDeDrive_(f(A.documento)), idsDeDrive_(f(A.portada)), idsDeDrive_(f(X.portada))).filter(Boolean);
  };
  const propios = ids(function (h) { return datos[h]; });
  if (!propios.length) return false;
  const hoja = hojaDeRespuestas_(CONFIG.HOJA_ARTICULOS_ID);
  const col = columnas_(hoja), filas = hoja.getDataRange().getValues().slice(1);
  const enlace = String(datos[A.enlace] || '');
  return filas.some(function (fila) {
    const f = function (h) { return col[h] ? fila[col[h] - 1] : ''; };
    if (enlace && String(f(A.enlace)) === enlace) return false; // La misma fila
    return ids(f).some(function (id) { return propios.indexOf(id) !== -1; });
  });
}

/**
 * Al publicar: Word original, su copia en Google Docs y el PDF de respaldo.
 * Se conservan las imágenes (la entrada las muestra desde Drive) y, en envíos antiguos en PDF,
 * el PDF (la entrada lo ofrece para descargar).
 */
function depurarAlPublicar_(datos) {
  if (!CONFIG.DEPURAR_DRIVE) return 0;
  if (usadosPorOtraFila_(datos)) return 0;
  const A = CONFIG.COLUMNAS_ARTICULO;
  const idWord = idsDeDrive_(datos[A.documento])[0];
  if (!idWord) return 0; // Envío antiguo en PDF: no se toca nada
  let n = papelera_(idWord) ? 1 : 0;
  const idPdf = (String(datos[A.pdf] || '').match(/\/d\/([\w-]+)/) || [])[1];
  if (papelera_(idPdf)) n++;
  const carpeta = idCarpeta_(datos[A.carpeta]);
  if (carpeta) {
    try {
      const docs = DriveApp.getFolderById(carpeta).getFilesByType(MimeType.GOOGLE_DOCS);
      while (docs.hasNext()) { docs.next().setTrashed(true); n++; }
    } catch (err) { console.warn('Carpeta ' + carpeta + ': ' + err.message); }
    archivarPublicado_(datos);
  }
  return n;
}

/**
 * Un artículo publicado queda en una sola carpeta con todas sus imágenes (las del Word y las de la
 * galería), dentro de "Publicados <año>", con el nombre "<folio> · <título>":
 *   Publicador CIAD · archivos del blog/
 *     - <carpetas en revisión>
 *     - Publicados 2026/SOL-0006 · hola1/Imágenes/…
 * Mover no cambia los IDs: la entrada del blog sigue mostrando las imágenes.
 * Devuelve true si archivó algo.
 */
function archivarPublicado_(datos) {
  const A = CONFIG.COLUMNAS_ARTICULO;
  const idC = idCarpeta_(datos[A.carpeta]);
  if (!idC) return false;
  let carpeta;
  try { carpeta = DriveApp.getFolderById(idC); if (carpeta.isTrashed()) return false; } catch (err) { return false; }

  // 1. Subcarpeta de imágenes compartida con enlace (la crea Documento.gs; en artículos antiguos puede faltar)
  let imagenes;
  const it = carpeta.getFoldersByName('Imágenes');
  if (it.hasNext()) {
    imagenes = it.next();
  } else {
    imagenes = carpeta.createFolder('Imágenes');
    try { imagenes.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* Más abajo se comparte cada una */ }
  }
  let heredan = false;
  try { heredan = imagenes.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK; } catch (err) { heredan = false; }

  // 2. Galería: de la carpeta de subidas del Form a la carpeta del artículo
  idsDeDrive_(datos[A.imagen]).concat(idsDeDrive_(datos[A.imagenAnterior])).forEach(function (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (f.isTrashed()) return;
      // IMPORTANTE: sin la carpeta compartida, el permiso se pone en el archivo antes de moverlo (si no, la imagen dejaría de verse)
      if (!heredan) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      f.moveTo(imagenes);
    } catch (err) { console.warn('Galería ' + id + ': ' + err.message); }
  });

  // 2b. Imagen principal, recorte de las tarjetas e imágenes agregadas con «Editar nota»: también a la carpeta del artículo
  const X = PANEL.ARTICULO;
  const delPanel = idsDeDrive_(datos[X.portada]).concat(idsDeDrive_(datos[A.portada]), idsDeDrive_(datos[X.tarjeta]));
  const postId = (String(datos[A.enlace] || '').match(/\/(\d+)\s*$/) || [])[1];
  const raiz = postId && carpetaGuardadaCodigo_('CARPETA_ARCHIVOS');
  if (raiz) {
    const sueltas = raiz.getFoldersByName('Imágenes de las notas');
    if (sueltas.hasNext()) { const it = sueltas.next().searchFiles("title contains '" + postId + "' and trashed = false"); while (it.hasNext()) delPanel.push(it.next().getId()); }
  }
  delPanel.forEach(function (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (f.isTrashed()) return;
      if (!heredan) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      f.moveTo(imagenes);
    } catch (err) { console.warn('Imagen del panel ' + id + ': ' + err.message); }
  });

  // 3. Imágenes más grandes de lo que el blog muestra: se reducen a MANTENIMIENTO.IMAGEN_ANCHO (mismo ID)
  const todas = imagenes.getFiles();
  while (todas.hasNext()) { const f = todas.next(); try { reducirImagen_(f); } catch (err) { console.warn('Reducir ' + f.getId() + ': ' + err.message); } }

  // 4. Mover a "Publicados <año>" y quitar la fecha del nombre
  const principal = carpetaGuardadaCodigo_('CARPETA_ARCHIVOS');
  if (principal) {
    const nombreAnio = 'Publicados ' + new Date().getFullYear();
    const anios = principal.getFoldersByName(nombreAnio);
    const destino = anios.hasNext() ? anios.next() : principal.createFolder(nombreAnio);
    const padres = carpeta.getParents();
    if (!padres.hasNext() || padres.next().getId() !== destino.getId()) carpeta.moveTo(destino);
  }
  const folio = String(datos[A.folio] || '').trim() || 'Nota CIAD';
  carpeta.setName(nombreSeguro_(folio + ' · ' + String(datos[A.titulo] || 'articulo')));
  return true;
}

function carpetaGuardadaCodigo_(propiedad) {
  const id = PropertiesService.getScriptProperties().getProperty(propiedad);
  if (!id) return null;
  try { const c = DriveApp.getFolderById(id); return c.isTrashed() ? null : c; } catch (err) { return null; }
}

/** Al rechazar o descartar: todo lo del envío (Word, imágenes del formulario y la carpeta generada). */
function depurarAlRechazar_(datos) {
  if (!CONFIG.DEPURAR_DRIVE) return 0;
  if (usadosPorOtraFila_(datos)) return 0;
  const A = CONFIG.COLUMNAS_ARTICULO;
  let n = 0;
  idsDeDrive_(datos[A.documento]).concat(idsDeDrive_(datos[A.pdfAnterior]), idsDeDrive_(datos[A.imagen]), idsDeDrive_(datos[A.imagenAnterior]), idsDeDrive_(datos[PANEL.ARTICULO.portada]), idsDeDrive_(datos[A.portada]))
    .forEach(function (id) { if (papelera_(id)) n++; });
  const carpeta = idCarpeta_(datos[A.carpeta]);
  if (carpeta) {
    try { DriveApp.getFolderById(carpeta).setTrashed(true); n++; } catch (err) { console.warn('Carpeta ' + carpeta + ': ' + err.message); }
  }
  return n;
}

/**
 * --- Cola de depuración ---
 * OPT: enviar archivos a la papelera son varias llamadas lentas a Drive (≈1 s cada una), así que no
 * se hace dentro del clic de Publicar/Rechazar: se anota en una cola y un disparador la procesa cada
 * 5 minutos. Si la cola falla, se depura en el momento.
 */
const COLA_DRIVE_ = 'COLA_DEPURAR_DRIVE';

/** tipo: 'publicar' | 'rechazar'. Devuelve true si quedó en la cola. */
/** Columnas con archivos de Drive que necesitan la depuración y archivarPublicado_. */
function camposDeArchivo_() {
  const A = CONFIG.COLUMNAS_ARTICULO, X = PANEL.ARTICULO;
  return [A.documento, A.pdfAnterior, A.imagen, A.imagenAnterior, A.pdf, A.carpeta, A.folio, A.titulo, A.enlace, A.portada, X.portada, X.tarjeta];
}

function encolarDepuracion_(tipo, datos) {
  if (!CONFIG.DEPURAR_DRIVE) return false;
  const item = { tipo: tipo, d: {} };
  camposDeArchivo_().forEach(function (k) {
    item.d[k] = String(datos[k] || '');
  });
  try {
    const props = PropertiesService.getScriptProperties();
    const cola = JSON.parse(props.getProperty(COLA_DRIVE_) || '[]');
    cola.push(item);
    props.setProperty(COLA_DRIVE_, JSON.stringify(cola)); // Límite de ~9 KB: si se pasa, cae en el catch
    asegurarDisparadorCola_();
    return true;
  } catch (err) {
    console.warn('Cola de depuración: ' + err.message + '. Se depura en el momento.');
    return false;
  }
}

/** Pone en la cola; si no se puede, depura en el momento. Devuelve el texto para el aviso del panel. */
function depurarDespues_(tipo, datos) {
  if (!CONFIG.DEPURAR_DRIVE) return '';
  if (CONFIG.DEPURAR_EN_SEGUNDO_PLANO && encolarDepuracion_(tipo, datos)) return ' Los archivos de respaldo se mandarán a la papelera de Drive en unos minutos.';
  const n = tipo === 'publicar' ? depurarAlPublicar_(datos) : depurarAlRechazar_(datos);
  return n ? ' Se mandaron ' + n + ' archivo(s) a la papelera de Drive.' : '';
}

const INTERVALO_COLA_MIN_ = 1; // También reparte los avisos por correo, para que lleguen en un minuto

/** Lo ejecuta el disparador cada 5 minutos (también se puede ejecutar a mano). */
function procesarColaDrive() {
  exigirPermiso_();
  asegurarDisparadorCola_(); // Si cambió INTERVALO_COLA_MIN_, el disparador se ajusta solo (lo revisa una vez cada 6 h)
  avisarNovedades_(); // ver Avisos.gs: solicitudes y comentarios nuevos → correo al CIAD y a los administradores
  if (!PropertiesService.getScriptProperties().getProperty(COLA_DRIVE_)) return; // Cola vacía: termina
  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(10000)) return; // Hay una publicación en curso: se intenta en la siguiente vuelta
  let cola = [];
  try {
    const props = PropertiesService.getScriptProperties();
    cola = JSON.parse(props.getProperty(COLA_DRIVE_) || '[]');
    props.deleteProperty(COLA_DRIVE_);
  } finally {
    bloqueo.releaseLock();
  }
  cola.forEach(function (item) {
    try {
      const n = item.tipo === 'publicar' ? depurarAlPublicar_(item.d) : depurarAlRechazar_(item.d);
      console.log('Depuración (' + item.tipo + '): ' + n + ' archivo(s) a la papelera.');
    } catch (err) {
      console.warn('Depuración: ' + err.message);
    }
  });
}

function asegurarDisparadorCola_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('COLA_OK') === String(INTERVALO_COLA_MIN_)) return; // Revisado hace menos de 6 h (ahorra ~1 s al publicar)
  const props = PropertiesService.getScriptProperties();
  const disparadores = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'procesarColaDrive'; });
  if (disparadores.length === 1 && props.getProperty('COLA_INTERVALO') === String(INTERVALO_COLA_MIN_)) {
    cache.put('COLA_OK', String(INTERVALO_COLA_MIN_), 21600);
    return;
  }
  // No existe, está repetido o tiene otro intervalo: se deja uno solo
  disparadores.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('procesarColaDrive').timeBased().everyMinutes(INTERVALO_COLA_MIN_).create();
  props.setProperty('COLA_INTERVALO', String(INTERVALO_COLA_MIN_));
  cache.put('COLA_OK', String(INTERVALO_COLA_MIN_), 21600);
}

/**
 * Medición: deja en Ejecuciones cuánto tardó cada paso, para encontrar lo lento.
 * Ejemplo: "publicarArticulo · total 6200 ms · Blogger 2100 ms · correo 900 ms …"
 */
function cronometro_(nombre) {
  const inicio = Date.now();
  let anterior = inicio;
  const pasos = [];
  return {
    paso: function (etiqueta) { const ahora = Date.now(); pasos.push(etiqueta + ' ' + (ahora - anterior) + ' ms'); anterior = ahora; },
    fin: function () { console.log('⏱ ' + nombre + ' · total ' + (Date.now() - inicio) + ' ms · ' + pasos.join(' · ')); }
  };
}

function fechaHoy_() {
  return Utilities.formatDate(new Date(), 'America/Tijuana', 'dd/MM/yyyy HH:mm');
}
