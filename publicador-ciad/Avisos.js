/**
 * @fileoverview Avisos por correo del Panel CIAD.
 * @author APONTE
 * Capa: Servicio. Lo ejecuta procesarColaDrive() cada minuto; no necesita disparador propio.
 *
 * Avisos al CIAD (usuarios del panel con el aviso de esa área activado en la pestaña Usuarios,
 * ver Usuarios.gs). Cada correo trae un botón que abre el panel en la pestaña indicada:
 *   - Solicitud nueva: el Receptor suele avisar al instante; aquí se reintentan las que fallaron.
 *   - Comentario nuevo por moderar.
 *   - Artículo nuevo del Form 2 (lo envía alRecibirArticulo al terminar la conversión).
 *
 * Avisos a otras personas:
 *   - Al colaborador que hizo la solicitud: confirmación con su folio.
 *   - Al autor de una nota, cuando el CIAD aprueba un comentario en ella.
 *
 * NOTA: los correos van siempre a la cuenta de Google con la que se envió el Form 2,
 * nunca al "correo de contacto" (ese solo se muestra en la nota).
 */

const AVISOS = {
  ACTIVOS: true,        // false: no se envía ningún aviso automático
  MAXIMO_EN_CORREO: 10  // Si llegan más a la vez, el correo muestra estas y dice cuántas faltan
};

function avisarNovedades_() {
  if (!AVISOS.ACTIVOS) return;
  const props = PropertiesService.getScriptProperties();
  try { avisarSolicitudesNuevas_(props); } catch (err) { console.warn('Aviso de solicitudes: ' + err.message); }
  try { avisarComentariosNuevos_(props); } catch (err) { console.warn('Aviso de comentarios: ' + err.message); }
  try { compartirDestinatarios_(props); } catch (err) { console.warn('Lista de administradores: ' + err.message); }
}

/**
 * Quién recibe los avisos de solicitudes (se define en la pestaña Usuarios).
 * Se copia a un metadato de la hoja de solicitudes para que el Receptor, que es otro proyecto, lo lea.
 * OPT: solo se escribe cuando cambia; la comparación usa la propiedad y no abre la hoja.
 */
const CLAVE_DESTINATARIOS_ = 'CIAD_DESTINATARIOS';
function compartirDestinatarios_(props) {
  const lista = destinatariosCiad_('solicitudes');
  if (props.getProperty('AVISO_DESTINATARIOS') === lista) return;
  const libro = SpreadsheetApp.openById(CONFIG.HOJA_SOLICITUDES_ID);
  const previos = libro.createDeveloperMetadataFinder().withKey(CLAVE_DESTINATARIOS_).find();
  if (previos.length) previos[0].setValue(lista); else libro.addDeveloperMetadata(CLAVE_DESTINATARIOS_, lista);
  props.setProperty('AVISO_DESTINATARIOS', lista);
}


function urlPanel_(pestana) {
  return CONFIG.PANEL_URL + '?pestana=' + pestana;
}

// ===== Solicitudes =====

function avisarSolicitudesNuevas_(props) {
  const C = CONFIG.COLUMNAS_SOLICITUD;
  // OPT: se ejecuta cada minuto; si la hoja no cambió desde la vuelta anterior, no se abre (≈0.2 s en lugar de ≈2 s)
  const cambio = String(DriveApp.getFileById(CONFIG.HOJA_SOLICITUDES_ID).getLastUpdated().getTime());
  if (props.getProperty('AVISO_SOLICITUD') !== null && props.getProperty('AVISO_SOLICITUD_HOJA') === cambio) return;
  const filas = leerTabla_(CONFIG.HOJA_SOLICITUDES_ID).map(function (f) {
    const m = valor_(f, C.folio).match(/^SOL-(\d+)$/i);
    return { n: m ? Number(m[1]) : 0, f: f };
  });
  const mayor = filas.reduce(function (m, x) { return Math.max(m, x.n); }, 0);
  const ultimo = props.getProperty('AVISO_SOLICITUD');
  // NOTA: la primera vez solo se guarda el punto de partida, para no enviar un correo con solicitudes antiguas
  if (ultimo === null) { props.setProperty('AVISO_SOLICITUD', String(mayor)); return; }

  // NOTA: el Receptor llena "Aviso enviado" cuando avisa al instante; aquí solo se cubren las que fallaron
  const nuevas = filas.filter(function (x) {
    return x.n > Number(ultimo) && valor_(x.f, C.estado) === 'Pendiente' && !valor_(x.f, 'Aviso enviado');
  });
  if (nuevas.length) {
    const primera = nuevas[0].f;
    enviarCorreo_(destinatariosCiad_('solicitudes'),
      nuevas.length === 1 ? 'Nueva solicitud ' + valor_(primera, C.folio) + ': «' + valor_(primera, C.titulo) + '»' : nuevas.length + ' solicitudes nuevas para el blog', {
        titulo: nuevas.length === 1 ? 'Llegó una solicitud nueva' : 'Llegaron ' + nuevas.length + ' solicitudes nuevas',
        parrafos: lista_(nuevas.map(function (x) {
          return '<strong>' + escaparHtml_(valor_(x.f, C.folio)) + ' · «' + escaparHtml_(valor_(x.f, C.titulo)) + '»</strong><br>' +
            escaparHtml_(valor_(x.f, C.nombre)) + ' · ' + escaparHtml_(valor_(x.f, C.correo)) +
            (valor_(x.f, C.categoria) ? ' · ' + escaparHtml_(valor_(x.f, C.categoria)) : '');
        })).concat(['Revísala en el panel para aprobarla o rechazarla; el autor recibe la respuesta por correo.']),
        boton: { texto: 'Atender en el Panel CIAD', url: urlPanel_('solicitudes') }
      });
    // Confirmación para cada colaborador (a la cuenta con la que inició sesión en la página)
    nuevas.forEach(function (x) {
      const correo = valor_(x.f, C.correo);
      if (!correo) return;
      try {
        enviarCorreo_(correo, 'Recibimos tu solicitud ' + valor_(x.f, C.folio) + ' para el blog del CIAD', {
          titulo: 'Recibimos tu solicitud',
          nombre: valor_(x.f, C.nombre),
          parrafos: [
            'Tu propuesta <strong>«' + escaparHtml_(valor_(x.f, C.titulo)) + '»</strong> quedó registrada con el folio <strong>' +
              escaparHtml_(valor_(x.f, C.folio)) + '</strong>.',
            'El equipo editorial la revisará y te responderemos a este correo si se aprueba o no. No necesitas hacer nada más por ahora.'
          ]
        });
      } catch (err) { console.warn('Confirmación a ' + correo + ': ' + err.message); }
    });
  }
  // Se guarda después de enviar: si un correo falla, se reintenta en la siguiente vuelta
  props.setProperty('AVISO_SOLICITUD', String(Math.max(mayor, Number(ultimo) || 0)));
  props.setProperty('AVISO_SOLICITUD_HOJA', cambio);
}

// ===== Artículo nuevo (Form 2) =====

/**
 * Avisa al CIAD qué artículo llegó y cómo quedó. Lo llama alRecibirArticulo después de convertir el Word.
 * IMPORTANTE: nunca lanza error, porque el artículo ya quedó registrado.
 */
function avisarArticuloNuevo_(hoja, fila) {
  try {
    if (!AVISOS.ACTIVOS) return;
    const A = CONFIG.COLUMNAS_ARTICULO;
    const d = leerFila_(hoja, fila);
    const titulo = String(d[A.titulo] || '(sin título)').trim();
    const folio = String(d[A.folio] || '').trim().toUpperCase() || 'Nota del CIAD';
    const estado = String(d[A.estado] || 'Sin procesar').trim();
    const palabras = Number(d[A.palabras]) || 0;
    const fueraDeRango = palabras && (palabras < 1000 || palabras > 2500);

    let siguiente = 'Revísalo en el panel.';
    if (/^(Borrador creado|Publicado)/.test(estado)) siguiente = 'Ya está convertido: revisa cómo quedó y publícalo desde el panel.';
    else if (/^Por vincular/.test(estado)) siguiente = 'No se encontró una solicitud aprobada que coincida: asígnale el folio en el panel.';
    else if (/^(Error|Rechazado)/.test(estado)) siguiente = 'No se pudo convertir. En el panel puedes ver el detalle y usar Reintentar.';

    enviarCorreo_(destinatariosCiad_('articulos'), 'Nuevo artículo ' + folio + ': «' + titulo + '»', {
      titulo: 'Llegó un artículo nuevo',
      parrafos: [
        '<strong>' + escaparHtml_(folio) + ' · «' + escaparHtml_(titulo) + '»</strong><br>' +
          escaparHtml_(String(d[A.nombre] || '')) + ' · ' + escaparHtml_(String(d[A.cuenta] || '')) +
          (palabras ? ' · ' + palabras + ' palabras' + (fueraDeRango ? ' <span style="color:#a12a1f;">(fuera de lo recomendado: 1,000 a 2,500)</span>' : '') : ''),
        'Estado: <strong>' + escaparHtml_(estado) + '</strong>. ' + siguiente
      ],
      boton: { texto: 'Revisar en el Panel CIAD', url: urlPanel_('articulos') }
    });
  } catch (err) {
    console.warn('Aviso de artículo: ' + err.message);
  }
}

// ===== Comentarios por moderar =====

function avisarComentariosNuevos_(props) {
  const ultimo = props.getProperty('AVISO_COMENTARIO');
  const pendientes = consultarPorEstado_('pendiente');
  // NOTA: "creado" es una fecha ISO de Firestore, así que se compara como texto
  const mayor = pendientes.reduce(function (m, c) { return String(c.creado || '') > m ? String(c.creado) : m; }, ultimo || '');
  if (ultimo === null) { props.setProperty('AVISO_COMENTARIO', mayor || new Date().toISOString()); return; }

  const nuevos = pendientes.filter(function (c) { return String(c.creado || '') > ultimo; });
  if (nuevos.length) {
    enviarCorreo_(destinatariosCiad_('comentarios'),
      nuevos.length === 1 ? 'Nuevo comentario por moderar en «' + (nuevos[0].postTitulo || 'una nota') + '»' : nuevos.length + ' comentarios nuevos por moderar', {
        titulo: nuevos.length === 1 ? 'Hay un comentario por moderar' : 'Hay ' + nuevos.length + ' comentarios por moderar',
        parrafos: lista_(nuevos.map(function (c) {
          const spam = evaluarSpam_(c, pendientes);
          return '<strong>' + escaparHtml_(c.nombre || 'Sin nombre') + '</strong> en «' + escaparHtml_(c.postTitulo || 'una nota') + '»' +
            (spam.length ? ' <span style="color:#a12a1f;">(posible spam: ' + escaparHtml_(spam.join(', ')) + ')</span>' : '') +
            '<br><span style="color:#5d6b7c;">' + escaparHtml_(recorte_(c.texto, 200)) + '</span>';
        })).concat(['No se publica hasta que alguien lo apruebe en el panel.']),
        boton: { texto: 'Moderar en el Panel CIAD', url: urlPanel_('comentarios') }
      });
  }
  props.setProperty('AVISO_COMENTARIO', mayor);
}

// ===== Aviso al autor de la nota =====

/**
 * Avisa al autor que su nota recibió un comentario ya aprobado.
 * Devuelve el correo al que avisó, o '' si no avisó a nadie.
 * IMPORTANTE: nunca lanza error; la aprobación ya se hizo y no debe parecer que falló.
 */
function avisarAutorDeComentario_(c) {
  try {
    if (!AVISOS.ACTIVOS || !c) return '';
    const A = CONFIG.COLUMNAS_ARTICULO;
    const ruta = function (url) { return String(url || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, ''); };
    const fila = leerTabla_(CONFIG.HOJA_ARTICULOS_ID).filter(function (f) {
      const id = (valor_(f, A.enlace).match(/\/(\d+)\s*$/) || [])[1];
      return (c.postId && id === String(c.postId)) ||
        (c.postUrl && valor_(f, PANEL.ARTICULO.publicado) && ruta(valor_(f, PANEL.ARTICULO.publicado)) === ruta(c.postUrl));
    }).pop();
    if (!fila) return '';

    const correo = valor_(fila, A.cuenta) || valor_(fila, A.correoAnterior);
    if (!correo || esCuentaCiad_(correo)) return ''; // Si la nota es del CIAD no se avisa: el CIAD ya la ve

    enviarCorreo_(correo, 'Tu nota «' + (valor_(fila, A.titulo) || c.postTitulo || '') + '» recibió un comentario', {
      titulo: 'Tienes un comentario nuevo',
      nombre: valor_(fila, A.nombre),
      parrafos: [
        '<strong>' + escaparHtml_(c.nombre || 'Un lector') + '</strong> comentó en tu nota <strong>«' +
          escaparHtml_(valor_(fila, A.titulo) || c.postTitulo || '') + '»</strong>:',
        '<span style="display:block;border-left:3px solid #00723f;padding:4px 12px;color:#3d4a5a;">' +
          escaparHtml_(recorte_(c.texto, 500)).replace(/\n/g, '<br>') + '</span>',
        'Puedes leerlo y responder en el blog.'
      ],
      boton: c.postUrl ? { texto: 'Ver el comentario', url: c.postUrl } : null
    });
    return correo;
  } catch (err) {
    console.warn('Aviso al autor: ' + err.message);
    return '';
  }
}

// ===== Funciones auxiliares =====

function lista_(elementos) {
  const extra = elementos.length - AVISOS.MAXIMO_EN_CORREO;
  return elementos.slice(0, AVISOS.MAXIMO_EN_CORREO).concat(extra > 0 ? ['…y ' + extra + ' más en el panel.'] : []);
}

function recorte_(texto, max) {
  const t = String(texto || '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
