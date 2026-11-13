/**
 * @fileoverview Conversión del Word del autor en una entrada del blog.
 * @author APONTE
 * Capa: Servicio (lo usa el flujo de Código.gs al recibir un artículo).
 *
 * Convierte el Word (.docx) que sube el autor en:
 *   - HTML para Blogger, con las imágenes en su lugar exacto;
 *   - un PDF de respaldo (solo lo ve el CIAD desde el panel);
 *   - una carpeta en Drive con todo (Word, Google Doc, PDF e imágenes).
 *
 * Requiere el servicio avanzado "Drive" (declarado en appsscript.json).
 * Todas las funciones son privadas (terminan en "_").
 */

const DOCUMENTO = {
  CARPETA_PRINCIPAL: 'Publicador CIAD · archivos del blog',

  // Líneas de encabezado que algunos autores escriben dentro del Word.
  // Se quitan del cuerpo (el título y el subtítulo vienen del formulario) y se usan como respaldo.
  ETIQUETA_TITULO: /^\s*t[íi]tulo\s*:\s*/i,
  ETIQUETA_SUBTITULO: /^\s*(subencabezado|subt[íi]tulo)\s*:\s*/i,

  // Partes de la estructura Edu bits que no se publican como título: la nota se lee de corrido
  // y cada parte se reconoce por su contenido (si el autor deja "Introducción", se quita).
  SECCIONES_SIN_TITULO: ['introduccion', 'desarrollo', 'proyecto o experiencia personal', 'experiencia personal', 'invitacion'],

  // Apartados de la estructura Edu bits que siempre se publican como título de sección (h2).
  SECCIONES_EDUBITS: [
    'introduccion', 'desarrollo', 'proyecto o experiencia personal', 'experiencia personal',
    'implementacion', 'invitacion', 'reflexion', 'sintesis curricular', 'sintesis curricular y referencias',
    'acerca del autor', 'referencias', 'lista de referencias', 'referencias bibliograficas',
    'conclusion', 'conclusiones', 'evidencias', 'resultados'
  ],

  // Ficha del autor (nombre, fecha, correo, cargo, vínculo).
  // true = se publica el correo del autor, como pide el formato Edu bits; false = se oculta.
  MOSTRAR_CORREO_EN_FIRMA: true,

  // Palabras que identifican cada línea del bloque "Por…" del Word
  PALABRAS_VINCULO: ['universidad', 'uabc', 'facultad', 'instituto', 'escuela', 'centro', 'colegio', 'tecnologico',
    'campus', 'unidad academica', 'departamento', 'organizacion', 'empresa', 'independiente', 'secretaria', 'ciad'],
  PALABRAS_CARGO: ['docente', 'profesor', 'profesora', 'maestro', 'maestra', 'investigador', 'investigadora',
    'coordinador', 'coordinadora', 'director', 'directora', 'jefe', 'jefa', 'estudiante', 'alumno', 'alumna',
    'egresado', 'egresada', 'academico', 'academica', 'tecnico', 'tecnica', 'asesor', 'asesora', 'responsable',
    'encargado', 'encargada', 'subdirector', 'subdirectora', 'catedratico', 'catedratica', 'tiempo completo', 'asignatura'],

  // Un párrafo corto sin punto final seguido de un párrafo largo se trata como subtítulo (h3).
  // Por ejemplo: "Evidencias", "Referencias", "Conclusiones".
  DETECTAR_SUBTITULOS: true,
  SUBTITULO_MAX_CARACTERES: 60,
  SUBTITULO_MAX_PALABRAS: 8,

  // OPT: true = las imágenes del Word heredan el permiso de una subcarpeta compartida (más rápido).
  // false = se comparte cada imagen por separado.
  COMPARTIR_IMAGENES_POR_CARPETA: true,

  TIPOS_CONVERTIBLES: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword',                                                      // .doc
    'application/vnd.oasis.opendocument.text',                                 // .odt
    'application/rtf'
  ]
};


// ===== Punto de entrada =====

/**
 * Procesa el archivo del artículo.
 * Devuelve { modo: 'documento' | 'pdf', html, idPdf, carpetaUrl, titulo, subtitulo }
 */
function procesarArchivoArticulo_(idArchivo, nombreCarpeta, tituloArchivo) {
  const archivo = DriveApp.getFileById(idArchivo);
  const tipo = archivo.getMimeType();

  // Envíos antiguos en PDF: solo se muestra un botón de descarga.
  // NOTA: no se crea carpeta para ellos, porque se quedaría vacía.
  if (tipo === MimeType.PDF) {
    compartirConEnlace_(idArchivo);
    return { modo: 'pdf', html: '', idPdf: idArchivo, carpetaUrl: '', titulo: '', subtitulo: '', ficha: {}, palabras: 0 };
  }
  // NOTA: el tipo se revisa antes de crear la carpeta, para no dejar una carpeta vacía por cada error
  if (tipo !== MimeType.GOOGLE_DOCS && DOCUMENTO.TIPOS_CONVERTIBLES.indexOf(tipo) === -1) {
    throw new Error('El archivo debe ser Word (.docx). Se recibió: ' + tipo);
  }

  const carpeta = carpetaDelArticulo_(nombreCarpeta);
  const reloj = cronometro_('  ↳ Word → HTML');
  try {
    // 1. Convertir a Google Docs (si no lo es)
    let idDoc;
    if (tipo === MimeType.GOOGLE_DOCS) {
      idDoc = idArchivo;
    } else {
      const copia = Drive.Files.create({
        name: nombreSeguro_(tituloArchivo || archivo.getName()) + ' (Google Docs)',
        mimeType: MimeType.GOOGLE_DOCS,
        parents: [carpeta.getId()]
      }, archivo.getBlob());
      idDoc = copia.id;
    }
    reloj.paso('convertir a Google Docs');

    // 2. HTML con imágenes
    const resultado = documentoAHtml_(idDoc, carpeta, tituloArchivo);
    reloj.paso('leer texto e imágenes');

    // 3. PDF de respaldo
    const pdf = carpeta.createFile(DriveApp.getFileById(idDoc).getAs(MimeType.PDF)
      .setName(nombreSeguro_(tituloArchivo || resultado.titulo || 'articulo') + '.pdf'));
    // El PDF es solo un respaldo para el CIAD (enlace "Ver PDF" del panel); no se comparte públicamente.
    reloj.paso('PDF de respaldo');
    reloj.fin();

    return {
      modo: 'documento',
      html: resultado.html,
      idPdf: pdf.getId(),
      carpetaUrl: carpeta.getUrl(),
      idCarpeta: carpeta.getId(),
      titulo: resultado.titulo,
      subtitulo: resultado.subtitulo,
      ficha: resultado.ficha,
      palabras: resultado.palabras
    };
  } catch (err) {
    // NOTA: si la conversión falla, la carpeta incompleta (Doc, imágenes) va a la papelera.
    // Al reintentar se crea una nueva, así no se acumulan carpetas huérfanas.
    try { carpeta.setTrashed(true); } catch (e) { console.warn('Carpeta a medias: ' + e.message); }
    throw err;
  }
}


// ===== Recorrido del documento =====

function documentoAHtml_(idDoc, carpeta, tituloFormulario) {
  const cuerpo = DocumentApp.openById(idDoc).getBody();
  const T = DocumentApp.ElementType;
  const H = DocumentApp.ParagraphHeading;

  const ctx = { carpeta: carpeta, imagenes: 0, notas: [], palabras: 0, enReferencias: false };
  const partes = [];
  const lineasFirma = [];
  const etiquetadas = {};    // "Cargo: …", "Correo: …", etc.
  let fechaTexto = '';
  const listas = pilaDeListas_(partes); // Listas anidadas como en el Word (viñeta, número, letra, guion)
  let ultimoP = null, penultimoP = null; // Últimos párrafos normales: pueden ser el título de una figura (APA)
  let titulo = '', subtitulo = '';

  // Zona inicial: todo lo que está antes del primer párrafo largo o del primer apartado.
  // Ahí van el título, la fecha y "Por Nombre (correo)" de la estructura Edu bits.
  let zonaInicial = true;
  let enFirma = false;
  let primerTexto = true;

  const total = cuerpo.getNumChildren();

  for (let i = 0; i < total; i++) {
    const el = cuerpo.getChild(i);
    const tipo = el.getType();

    // Un párrafo vacío entre viñetas no corta la lista; cualquier otra cosa sí
    const marcaManual = tipo === T.PARAGRAPH ? marcaDeLista_(el.asParagraph().getText()) : '';
    if (tipo !== T.LIST_ITEM && !(marcaManual && listas.id() === 'manual') && !(tipo === T.PARAGRAPH && esVacio_(el.asParagraph()))) {
      listas.cerrar();
    }

    if (tipo === T.PARAGRAPH) {
      const p = el.asParagraph();
      const texto = p.getText().trim();
      const encabezado = p.getHeading();
      const seccion = esSeccionEdubits_(texto);
      // "Título:", "Cargo:", "Por:"… o el título repetido son datos de la plantilla, aunque el autor les haya dado estilo de título
      const datoDePlantilla = zonaInicial && (DOCUMENTO.ETIQUETA_TITULO.test(texto) || DOCUMENTO.ETIQUETA_SUBTITULO.test(texto) ||
        !!datoEtiquetado_(texto) || /^por(\s|:)/i.test(texto) || (primerTexto && mismoTexto_(texto, tituloFormulario)));

      if (texto && !datoDePlantilla && (texto.length >= 120 || seccion || (encabezado !== H.NORMAL && encabezado !== H.TITLE && encabezado !== H.SUBTITLE))) {
        zonaInicial = false;
        enFirma = false;
      }

      // Las indicaciones de la plantilla entre corchetes nunca se publican
      if (esIndicacion_(texto)) continue;
      if (DOCUMENTO.SECCIONES_SIN_TITULO.indexOf(seccion) !== -1) continue;

      if (zonaInicial && texto) {
        if (DOCUMENTO.ETIQUETA_TITULO.test(texto)) { titulo = texto.replace(DOCUMENTO.ETIQUETA_TITULO, '').trim(); if (esIndicacion_(titulo)) titulo = ''; primerTexto = false; continue; }
        if (DOCUMENTO.ETIQUETA_SUBTITULO.test(texto)) { subtitulo = texto.replace(DOCUMENTO.ETIQUETA_SUBTITULO, '').trim(); if (esIndicacion_(subtitulo)) subtitulo = ''; primerTexto = false; continue; }
        if (encabezado === H.TITLE || (primerTexto && mismoTexto_(texto, tituloFormulario))) { if (!titulo) titulo = texto; primerTexto = false; continue; }
        if (encabezado === H.SUBTITLE) { if (!subtitulo) subtitulo = texto; continue; }

        // Primera línea = título del artículo (coincide con el del formulario o es corta y sin punto)
        if (primerTexto) {
          primerTexto = false;
          if (mismoTexto_(texto, tituloFormulario) || (texto.length <= 100 && !/[.;:]$/.test(texto))) {
            if (!titulo) titulo = texto;
            continue;
          }
        }
        // Datos con etiqueta: "Cargo: …", "Correo: …", "Vínculo: …", "Fecha: …", "Nombre: …"
        const etiquetado = datoEtiquetado_(texto);
        if (etiquetado) {
          if (etiquetado.campo === 'ignorar') continue;
          if (etiquetado.campo === 'fecha') { if (!fechaTexto) fechaTexto = etiquetado.valor; }
          else if (!etiquetadas[etiquetado.campo]) etiquetadas[etiquetado.campo] = etiquetado.valor;
          continue;
        }

        if (esFecha_(texto)) { if (!fechaTexto) fechaTexto = texto; continue; }

        if (/^por(\s|:|$)/i.test(texto)) {
          enFirma = true;
          const resto = texto.replace(/^por\s*:?\s*/i, '').trim();
          if (resto) lineasFirma.push(resto);
          continue;
        }
        if (enFirma && texto.length <= 120) { lineasFirma.push(texto.replace(/\.$/, '')); continue; }
      }
      if (texto) primerTexto = false;

      if (marcaManual && !ctx.enReferencias) {
        zonaInicial = false;
        ctx.palabras += contarPalabras_(texto) - 1;
        listas.item(0, 'manual', 'ul', estiloDeMarca_(marcaManual),
          contenidoEnLinea_(p, ctx).replace(/^((?:<[^>]+>)*)\s*[-–•▪◦·*]\s+/, '$1'));
        continue;
      }

      // Un video de YouTube solo en su párrafo se convierte en reproductor
      const video = idYoutube_(texto) || idYoutube_(enlaceUnico_(p));
      if (video && (texto === '' || /^\S+$/.test(texto) || enlaceUnico_(p))) {
        partes.push(videoHtml_(video));
        continue;
      }

      ctx.relaciones = [];
      const interior = contenidoEnLinea_(p, ctx);
      const flotantes = imagenesFlotantes_(p, ctx);
      if (!interior.replace(/<br\/>/g, '').trim() && !flotantes) continue;

      if (seccion) {
        ctx.enReferencias = /referencias/.test(seccion);
        partes.push('<h2>' + sinNegritas_(interior).replace(/:\s*$/, '') + '</h2>');
      } else if (encabezado === H.HEADING1 || encabezado === H.HEADING2) {
        ctx.enReferencias = /referencias/i.test(texto);
        partes.push('<h2>' + sinNegritas_(interior) + '</h2>');
      } else if (encabezado === H.HEADING3 || encabezado === H.HEADING4 || encabezado === H.HEADING5 || encabezado === H.HEADING6) {
        partes.push('<h3>' + sinNegritas_(interior) + '</h3>');
      } else if (!ctx.enReferencias && esSubtituloImplicito_(p, texto, cuerpo, i)) {
        partes.push('<h3>' + sinNegritas_(interior) + '</h3>');
      } else if (!texto && interior) {
        // Título APA arriba ("Figura 1" + título), si fueron los últimos párrafos publicados
        let arriba = '';
        if (ultimoP && ultimoP.pos === partes.length - 1) {
          if (ES_ROTULO_FIGURA_.test(ultimoP.texto)) {
            arriba = ultimoP.html; partes.pop(); ctx.palabras -= contarPalabras_(ultimoP.texto);
          } else if (ultimoP.texto.length <= 160 && penultimoP && penultimoP.pos === partes.length - 2 && ES_ROTULO_FIGURA_.test(penultimoP.texto)) {
            arriba = penultimoP.html + '<br/>' + ultimoP.html; partes.splice(-2, 2);
            ctx.palabras -= contarPalabras_(ultimoP.texto) + contarPalabras_(penultimoP.texto);
          }
        }
        ultimoP = penultimoP = null;
        // Pie abajo: el siguiente párrafo con texto, si está centrado o empieza con "Imagen", "Fuente", "Figura"…
        let abajo = '';
        const pie = pieDeImagen_(cuerpo, i);
        if (pie) { abajo = contenidoEnLinea_(pie.parrafo, ctx); i = pie.indice; }
        const imagenes = interior.match(/<img[^>]*\/>/g) || [];
        imagenes.forEach(function (img, k) {
          const ultima = k === imagenes.length - 1;
          partes.push(figuraHtml_(img, ctx.relaciones[k], k === 0 ? arriba : '', ultima ? abajo : ''));
        });
      } else if (ctx.enReferencias) {
        // APA: sangría francesa
        partes.push('<p class="articulo-referencia" style="padding-left:2em;text-indent:-2em;">' + interior + '</p>');
      } else if (interior.trim()) {
        ctx.palabras += contarPalabras_(texto);
        partes.push('<p' + estiloParrafo_(p) + '>' + interior + '</p>');
        penultimoP = ultimoP;
        ultimoP = { pos: partes.length - 1, texto: texto, html: interior };
      }
      if (flotantes) partes.push(flotantes);

    } else if (tipo === T.LIST_ITEM) {
      zonaInicial = false;
      const li = el.asListItem();
      if (esIndicacion_(li.getText().trim())) continue;
      const glifo = li.getGlyphType();
      if (!ctx.enReferencias) ctx.palabras += contarPalabras_(li.getText());
      listas.item(li.getNestingLevel() || 0, li.getListId(), esListaNumerada_(glifo) ? 'ol' : 'ul',
        estiloDeGlifo_(glifo), contenidoEnLinea_(li, ctx));

    } else if (tipo === T.TABLE) {
      zonaInicial = false;
      partes.push(tablaHtml_(el.asTable(), ctx));

    } else if (tipo === T.HORIZONTAL_RULE) {
      partes.push('<hr/>');
    }
  }

  listas.cerrar();
  // Título sin contenido debajo: el autor quitó la parte pero dejó el título
  for (let k = partes.length - 1; k >= 0; k--) {
    const nivel = (partes[k].match(/^<h([23])>/) || [])[1];
    if (!nivel) continue;
    const siguiente = (String(partes[k + 1] || '').match(/^<h([23])>/) || [])[1];
    if (k === partes.length - 1 || (siguiente && siguiente <= nivel)) partes.splice(k, 1); // Un h2 seguido de un h3 sí es válido
  }

  if (ctx.notas.length) {
    partes.push('<div class="articulo-notas" style="margin-top:2em;font-size:.9em;"><h3>Notas</h3><ol>' +
      ctx.notas.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ol></div>');
  }

  const ficha = fichaDelDocumento_(lineasFirma, etiquetadas, fechaTexto);
  return { html: citasNumeradas_(partes.join('\n')), titulo: titulo, subtitulo: subtitulo, ficha: ficha, palabras: ctx.palabras };
}

/** Texto con formato, enlaces, imágenes y notas al pie de un párrafo o elemento de lista. */
function contenidoEnLinea_(contenedor, ctx) {
  const T = DocumentApp.ElementType;
  let html = '';

  for (let i = 0; i < contenedor.getNumChildren(); i++) {
    const hijo = contenedor.getChild(i);
    const tipo = hijo.getType();

    if (tipo === T.TEXT) {
      html += textoConFormato_(hijo.asText());
    } else if (tipo === T.INLINE_IMAGE) {
      const im = hijo.asInlineImage();
      html += imagenHtml_(im.getBlob(), im.getWidth(), im.getHeight(), im.getAltDescription(), ctx);
    } else if (tipo === T.FOOTNOTE) {
      ctx.notas.push(escaparHtml_(hijo.asFootnote().getFootnoteContents().getText().trim()));
      html += '<sup>[' + ctx.notas.length + ']</sup>';
    }
  }
  return html;
}

function textoConFormato_(textoEl) {
  const texto = textoEl.getText();
  if (!texto) return '';

  const cortes = textoEl.getTextAttributeIndices();
  let html = '';

  for (let k = 0; k < cortes.length; k++) {
    const inicio = cortes[k];
    const fin = k + 1 < cortes.length ? cortes[k + 1] : texto.length;
    const trozo = texto.substring(inicio, fin);
    if (!trozo) continue;

    let s = escaparHtml_(trozo).replace(/[\r\n]/g, '<br/>');
    if (!s.replace(/<br\/>/g, '').trim()) { html += s; continue; }

    if (textoEl.isBold(inicio)) s = '<strong>' + s + '</strong>';
    if (textoEl.isItalic(inicio)) s = '<em>' + s + '</em>';

    let enlace = textoEl.getLinkUrl(inicio);
    // NOTA (DEF-002): si el texto visible es un correo, el mailto apunta a ese correo
    // (en plantillas copiadas se cambia el texto, pero el enlace conserva el correo anterior)
    const correoVisible = trozo.match(CORREO_REGEX_);
    if (enlace && /^mailto:/i.test(enlace) && correoVisible) enlace = 'mailto:' + correoVisible[0];
    if (enlace && /^(https?:|mailto:)/i.test(enlace)) {
      s = '<a href="' + escaparHtml_(enlace) + '" target="_blank" rel="noopener">' + s + '</a>';
    } else {
      // Las direcciones escritas como texto (comunes en referencias APA) se convierten en enlace
      s = s.replace(/(https?:\/\/[^\s<]*[^\s<.,;:)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }
    html += s;
  }
  // Une etiquetas partidas: "</strong><strong>"
  return html.replace(/<\/strong><strong>/g, '').replace(/<\/em><em>/g, '');
}

function imagenesFlotantes_(parrafo, ctx) {
  const flotantes = parrafo.getPositionedImages ? parrafo.getPositionedImages() : [];
  return flotantes.map(function (img) {
    ctx.relaciones = [];
    const html = imagenHtml_(img.getBlob(), img.getWidth(), img.getHeight(), '', ctx);
    return figuraHtml_(html, ctx.relaciones[0], '', '');
  }).join('');
}

function imagenHtml_(blob, ancho, alto, alt, ctx) {
  ctx.imagenes++;
  if (ctx.relaciones) ctx.relaciones.push(ancho && alto ? ancho / alto : 0);
  // Las imágenes de un Google Doc no siempre aceptan setName: se copian a un blob nuevo con nombre y tipo.
  const tipo = blob.getContentType() || 'image/png';
  const extension = tipo.split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  const copia = Utilities.newBlob(blob.getBytes(), tipo, 'imagen-' + ctx.imagenes + '.' + extension);
  const destino = carpetaImagenes_(ctx);
  const archivo = destino.createFile(copia);
  if (!ctx.imagenesHeredanPermiso) compartirConEnlace_(archivo.getId());

  const anchoAttr = ancho ? ' width="' + Math.round(ancho) + '"' : '';
  return '<img src="https://drive.google.com/thumbnail?id=' + archivo.getId() + '&amp;sz=w1600"' + anchoAttr +
    ' alt="' + escaparHtml_(alt || ('Imagen ' + ctx.imagenes + ' del artículo')) + '"' + // Accesibilidad: el alt nunca queda vacío
    ' style="display:block;max-width:100%;height:auto;max-height:560px;object-fit:contain;margin:0 auto;border-radius:10px;"/>';
}

/**
 * OPT: las imágenes del Word van a una subcarpeta "Imágenes" que se comparte una sola vez con
 * enlace, y los archivos heredan el permiso (compartir cada imagen tarda ≈1 s por imagen).
 * El Word, el Google Doc y el PDF se quedan en la carpeta del artículo, sin compartir.
 * Si la subcarpeta no se puede compartir (política del dominio), se comparte imagen por imagen.
 */
function carpetaImagenes_(ctx) {
  if (ctx.carpetaImagenes) return ctx.carpetaImagenes;
  if (!DOCUMENTO.COMPARTIR_IMAGENES_POR_CARPETA) {
    ctx.carpetaImagenes = ctx.carpeta;
    ctx.imagenesHeredanPermiso = false;
    return ctx.carpetaImagenes;
  }
  const sub = ctx.carpeta.createFolder('Imágenes');
  try {
    sub.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    ctx.imagenesHeredanPermiso = true;
  } catch (err) {
    console.warn('No se pudo compartir la carpeta de imágenes (' + err.message + '); se comparten una por una.');
    ctx.imagenesHeredanPermiso = false;
  }
  ctx.carpetaImagenes = sub;
  return sub;
}

function tablaHtml_(tabla, ctx) {
  let html = '<div style="overflow-x:auto;margin:1.5em 0;"><table style="border-collapse:collapse;width:100%;">';
  for (let r = 0; r < tabla.getNumRows(); r++) {
    const fila = tabla.getRow(r);
    html += '<tr>';
    for (let c = 0; c < fila.getNumCells(); c++) {
      const celda = fila.getCell(c);
      const etiqueta = r === 0 ? 'th' : 'td';
      let contenido = '';
      for (let k = 0; k < celda.getNumChildren(); k++) {
        const hijo = celda.getChild(k);
        if (hijo.getType() === DocumentApp.ElementType.PARAGRAPH || hijo.getType() === DocumentApp.ElementType.LIST_ITEM) {
          const linea = contenidoEnLinea_(hijo, ctx);
          if (linea) contenido += (contenido ? '<br/>' : '') + linea;
        }
      }
      html += '<' + etiqueta + ' style="border:1px solid #e2e7ed;padding:.5em .75em;text-align:left;vertical-align:top;">' + contenido + '</' + etiqueta + '>';
    }
    html += '</tr>';
  }
  return html + '</table></div>';
}


// ===== Figuras, listas y párrafos (fieles al Word) =====

// "Figura 1", "Imagen 2.", "Gráfica 3:" → rótulo de figura (estilo APA, va arriba de la imagen)
const ES_ROTULO_FIGURA_ = /^(figura|fig\.?|imagen|ilustraci[oó]n|gr[aá]fic[oa]|esquema|diagrama)\s*\d+/i;
// Pie (va abajo de la imagen): de dónde viene o qué muestra
const ES_PIE_IMAGEN_ = /^(figura|fig\.|imagen|ilustraci[oó]n|gr[aá]fic[oa]|fotograf[ií]a|foto|captura|esquema|diagrama|fuente|nota|elaboraci[oó]n|tomad[oa] de|recuperad[oa] de|adaptad[oa] de|cr[eé]dito)/i;

/**
 * Las imágenes horizontales y verticales van a la misma altura (ALTO_FIGURA_); el ancho sale de
 * su proporción y nunca pasa del ancho de la columna.
 * El pie va centrado, en cursiva, más pequeño, junto a la imagen y del mismo ancho.
 */
const ALTO_FIGURA_ = 'min(480px, 70vh)';
function figuraHtml_(img, relacion, arriba, abajo) {
  const ancho = relacion ? 'min(100%, calc(' + ALTO_FIGURA_ + ' * ' + relacion.toFixed(3) + '))' : '100%';
  const imagen = img.replace(/ style="[^"]*"/, ' style="display:block;width:100%;height:auto;border-radius:10px;"');
  const pie = function (html, lado) {
    return '<figcaption class="articulo-pie" style="text-align:center;font-size:.88em;line-height:1.45;color:#5d6b7c;' +
      (lado === 'abajo' ? 'font-style:italic;margin:.5em 0 0;' : 'margin:0 0 .5em;') + '">' + html + '</figcaption>';
  };
  return '<figure class="articulo-figura" style="width:' + ancho + ';max-width:100%;margin:1.75em auto;">' +
    (arriba ? pie(arriba, 'arriba') : '') + imagen + (abajo ? pie(abajo, 'abajo') : '') + '</figure>';
}

/** El párrafo que sigue a una imagen, si es su pie: está centrado en el Word o empieza como pie. */
function pieDeImagen_(cuerpo, indice) {
  for (let j = indice + 1; j < cuerpo.getNumChildren(); j++) {
    const el = cuerpo.getChild(j);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) return null;
    const p = el.asParagraph();
    const texto = p.getText().trim();
    if (!texto) { if (esVacio_(p)) continue; return null; } // Otra imagen: no es pie
    if (texto.length > 400 || esSeccionEdubits_(texto) || p.getHeading() !== DocumentApp.ParagraphHeading.NORMAL) return null;
    const centrado = p.getAlignment() === DocumentApp.HorizontalAlignment.CENTER;
    return (centrado || ES_PIE_IMAGEN_.test(texto)) ? { parrafo: p, indice: j } : null;
  }
  return null;
}

/** Párrafo sin texto ni imágenes (renglón en blanco). */
function esVacio_(p) {
  if (p.getText().trim()) return false;
  for (let k = 0; k < p.getNumChildren(); k++) {
    if (p.getChild(k).getType() === DocumentApp.ElementType.INLINE_IMAGE) return false;
  }
  return !(p.getPositionedImages && p.getPositionedImages().length);
}

/** Viñeta escrita a mano al inicio del párrafo ("- ", "• ", "* "…). */
function marcaDeLista_(texto) {
  const m = String(texto || '').match(/^\s*([-–•▪◦·*])\s+\S/);
  return m ? m[1] : '';
}

function estiloDeMarca_(marca) {
  if (marca === '▪') return 'square';
  if (marca === '◦') return 'circle';
  if (marca === '•' || marca === '·' || marca === '*') return 'disc';
  return "'– '"; // Guion, como en el Word
}

function estiloDeGlifo_(glifo) {
  const G = DocumentApp.GlyphType;
  const tipos = [[G.BULLET, 'disc'], [G.HOLLOW_BULLET, 'circle'], [G.SQUARE_BULLET, 'square'], [G.NUMBER, 'decimal'],
    [G.LATIN_UPPER, 'upper-alpha'], [G.LATIN_LOWER, 'lower-alpha'], [G.ROMAN_UPPER, 'upper-roman'], [G.ROMAN_LOWER, 'lower-roman']];
  for (let k = 0; k < tipos.length; k++) if (tipos[k][0] === glifo) return tipos[k][1];
  return '';
}

/**
 * Listas anidadas: cada nivel del Word es una lista dentro del elemento anterior, así la sangría
 * y la numeración de cada nivel son las del Word (no una sola lista plana).
 */
function pilaDeListas_(partes) {
  const pila = [];   // [{ etiqueta, abierto }]
  let idActual = null;
  function cerrarUna() {
    const t = pila.pop();
    if (t.abierto) partes.push('</li>');
    partes.push('</' + t.etiqueta + '>');
  }
  return {
    id: function () { return pila.length ? idActual : null; },
    cerrar: function () { while (pila.length) cerrarUna(); idActual = null; },
    item: function (nivel, id, etiqueta, estilo, html) {
      if (pila.length && id !== idActual) this.cerrar();
      idActual = id;
      while (pila.length > nivel + 1) cerrarUna();
      if (pila.length === nivel + 1 && pila[nivel].etiqueta !== etiqueta) cerrarUna();
      while (pila.length < nivel + 1) {
        partes.push('<' + etiqueta + (estilo ? ' style="list-style-type:' + estilo + ';"' : '') + '>');
        pila.push({ etiqueta: etiqueta, abierto: false });
      }
      const actual = pila[pila.length - 1];
      if (actual.abierto) partes.push('</li>');
      partes.push('<li>' + html);
      actual.abierto = true;
    }
  };
}

/** Sangrías y alineación del Word. Lo demás se publica justificado (lo aplica el tema del blog). */
function estiloParrafo_(p) {
  const A = DocumentApp.HorizontalAlignment;
  const css = [];
  const alineacion = p.getAlignment();
  if (alineacion === A.CENTER) css.push('text-align:center');
  else if (alineacion === A.RIGHT) css.push('text-align:right');
  const inicio = Math.min(72, Math.max(0, p.getIndentStart() || 0));
  const primera = Math.min(72, Math.max(0, p.getIndentFirstLine() || 0));
  if (inicio >= 2) css.push('margin-left:' + Math.round(inicio) + 'pt');
  if (Math.abs(primera - inicio) >= 2) css.push('text-indent:' + Math.round(primera - inicio) + 'pt'); // Negativo = sangría francesa
  return css.length ? ' style="' + css.join(';') + ';"' : '';
}


// ===== Reglas =====

function esSubtituloImplicito_(parrafo, texto, cuerpo, indice) {
  if (!DOCUMENTO.DETECTAR_SUBTITULOS || !texto) return false;
  if (texto.length > DOCUMENTO.SUBTITULO_MAX_CARACTERES) return false;
  if (texto.split(/\s+/).length > DOCUMENTO.SUBTITULO_MAX_PALABRAS) return false;
  if (/[.,;:!?…)"»]$/.test(texto)) return false;

  // El siguiente párrafo con texto debe ser largo (un párrafo normal)
  for (let j = indice + 1; j < cuerpo.getNumChildren(); j++) {
    const sig = cuerpo.getChild(j);
    if (sig.getType() !== DocumentApp.ElementType.PARAGRAPH) return false;
    const t = sig.asParagraph().getText().trim();
    if (!t && !esVacio_(sig.asParagraph())) return false; // Le sigue una imagen: es título de figura, no subtítulo
    if (t) return t.length > 80;
  }
  return false;
}

// ===== Ficha del autor (del Word) =====

const CORREO_REGEX_ = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

/** "[Escribe aquí…]" que el autor no reemplazó: se ignora. */
/**
 * Citas numeradas (estilo Wikipedia). En el texto, el autor escribe [[1]]; en Referencias, la
 * línea de esa fuente empieza con [[1]]. Se publica un número volado que lleva a la referencia y,
 * al pasar el cursor (o enfocarlo con el teclado), una burbuja con la referencia y el enlace a la
 * fuente si lo tiene.
 * Las otras dos formas de citar (texto con hipervínculo y APA normal) no se tocan y se pueden mezclar.
 */
function citasNumeradas_(html) {
  const MARCA = /\[\[\s*(\d{1,3})\s*\]\]/g;
  if (!MARCA.test(html)) return html;

  // 1. Referencias: el último párrafo o viñeta que empieza con [[n]] (las referencias van al final) recibe id="ref-n"
  //    y muestra [n]. NOTA: no depende del título de la sección, para que funcione con "Bibliografía",
  //    con un Título 3 o con "Referencias" en texto normal.
  const INICIO = /<(p|li)([^>]*)>((?:<[^>]+>)*)\s*\[\[\s*(\d{1,3})\s*\]\]\s*/g;
  const ultimo = {};
  let m0;
  while ((m0 = INICIO.exec(html))) ultimo[m0[4]] = m0.index;
  const fuentes = {};
  let cuerpo = html.replace(INICIO, function (todo, tag, attrs, abre, n, pos) {
    if (ultimo[n] !== pos) return todo; // No es la última: es una cita al inicio de un párrafo
    fuentes[n] = true;
    return '<' + tag + attrs + ' id="ref-' + n + '">' + abre + '<span class="ref-n">[' + n + ']</span> ';
  });
  Object.keys(fuentes).forEach(function (n) {
    const m = new RegExp('<(p|li)[^>]*id="ref-' + n + '"[^>]*>([\\s\\S]*?)</\\1>').exec(cuerpo);
    const interior = m ? m[2].replace(/<span class="ref-n">[^<]*<\/span>\s*/, '') : '';
    const enlace = (interior.match(/href="(https?:[^"]+)"/) || [])[1] || '';
    let texto = interior.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (texto.length > 280) texto = texto.slice(0, 279) + '…';
    fuentes[n] = { texto: texto, enlace: enlace };
  });

  // 2. Texto: cada [[n]] se vuelve un número volado con su burbuja (si no hay referencia con ese número, solo el número)
  cuerpo = cuerpo.replace(MARCA, function (todo, n) {
    const f = fuentes[n];
    if (!f) return '<sup class="cita">[' + n + ']</sup>';
    return '<sup class="cita"><a href="#ref-' + n + '" aria-label="Referencia ' + n + '">[' + n + ']</a>' +
      '<span class="cita-burbuja" role="tooltip"><span class="cita-caja">' + f.texto +
      '<span class="cita-acciones">' +
        (f.enlace ? '<a href="' + f.enlace + '" target="_blank" rel="noopener">Abrir la fuente ↗</a>' : '') +
        '<a href="#ref-' + n + '">Ver en referencias ↓</a>' +
      '</span></span></span></sup>';
  });
  return cuerpo;
}

function esIndicacion_(texto) {
  const t = String(texto || '').trim();
  if (t.length <= 2 || t.charAt(0) !== '[' || t.charAt(1) === '[') return false; // "[[1]] Fuente…" es una referencia, no una indicación
  const sinCitas = t.replace(/\[\[\s*\d{1,3}\s*\]\]/g, ''); // La indicación puede mencionar [[1]] dentro
  return sinCitas.charAt(sinCitas.length - 1) === ']' && sinCitas.indexOf(']') === sinCitas.length - 1;
}

function datoEtiquetado_(texto) {
  const m = String(texto).match(/^\s*(nombre(?: completo)?|autor(?:es|\(es\))?|correo(?: electr[oó]nico)?|e-?mail|cargo|puesto|v[ií]nculo|instituci[oó]n|adscripci[oó]n|dependencia|fecha)\s*:\s*(.+)$/i);
  if (!m) return null;
  const clave = normalizar_(m[1]);
  const valor = m[2].trim().replace(/\.$/, '');
  if (esIndicacion_(valor)) return { campo: 'ignorar', valor: '' };
  let campo = 'nombre';
  if (/^(correo|e-?mail)/.test(clave)) campo = 'correo';
  else if (/^(cargo|puesto)/.test(clave)) campo = 'cargo';
  else if (/^(vinculo|institucion|adscripcion|dependencia)/.test(clave)) campo = 'vinculo';
  else if (/^fecha/.test(clave)) campo = 'fecha';
  if (campo === 'correo') {
    const c = valor.match(CORREO_REGEX_);
    return c ? { campo: campo, valor: c[0] } : null;
  }
  return { campo: campo, valor: valor };
}

/** Reparte las líneas del bloque "Por…" en nombre, correo, cargo y vínculo. */
function fichaDelDocumento_(lineas, etiquetadas, fecha) {
  const ficha = { nombre: '', fecha: fecha || '', correo: '', cargo: '', vinculo: '' };

  lineas.forEach(function (linea) {
    let texto = linea;
    const correo = texto.match(CORREO_REGEX_);
    if (correo) {
      if (!ficha.correo) ficha.correo = correo[0];
      texto = texto.replace(correo[0], '').replace(/[()\[\]<>]/g, '').replace(/^[\s,;·\-]+|[\s,;·\-]+$/g, '');
    }
    if (!texto) return;

    const n = normalizar_(texto);
    const pareceVinculo = DOCUMENTO.PALABRAS_VINCULO.some(function (p) { return n.indexOf(p) !== -1; });
    const pareceCargo = DOCUMENTO.PALABRAS_CARGO.some(function (p) { return n.indexOf(p) !== -1; });

    if (!ficha.nombre && !pareceVinculo && !pareceCargo) ficha.nombre = texto;
    else if (pareceCargo && !ficha.cargo) ficha.cargo = texto;
    else if (pareceVinculo && !ficha.vinculo) ficha.vinculo = texto;
    else if (!ficha.nombre) ficha.nombre = texto;
    else if (!ficha.cargo) ficha.cargo = texto;
    else if (!ficha.vinculo) ficha.vinculo = texto;
  });

  // Lo que viene con etiqueta ("Cargo: …") tiene prioridad
  Object.keys(etiquetadas).forEach(function (k) { ficha[k] = etiquetadas[k]; });
  return ficha;
}

/** En los títulos se quitan las negritas. */
function sinNegritas_(html) {
  return html.replace(/<\/?strong>/g, '');
}

function esSeccionEdubits_(texto) {
  if (!texto || texto.length > 60) return '';
  const limpio = normalizar_(texto).replace(/^(\d+|[ivx]+)[).\-\s]+/, '').replace(/[:.\s]+$/, '');
  return DOCUMENTO.SECCIONES_EDUBITS.indexOf(limpio) !== -1 ? limpio : '';
}

function esFecha_(texto) {
  const t = normalizar_(texto);
  if (t.length > 40) return false;
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t)) return true;
  const meses = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
  return new RegExp('^(\\d{1,2}\\s+de\\s+)?' + meses + '(\\s+\\d{1,2})?(,?\\s+(de\\s+)?\\d{4})$').test(t) ||
         new RegExp('^' + meses + '\\s*\\/\\s*\\d{1,2}\\s*\\/\\s*\\d{4}$').test(t);
}

function mismoTexto_(a, b) {
  const x = normalizar_(a).replace(/[^a-z0-9ñ ]/g, ''), y = normalizar_(b).replace(/[^a-z0-9ñ ]/g, '');
  return !!x && !!y && (x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0);
}

function contarPalabras_(texto) {
  const t = String(texto || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function idYoutube_(texto) {
  const m = String(texto || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : '';
}

/** Si todo el párrafo es un solo enlace, devuelve su URL. */
function enlaceUnico_(parrafo) {
  if (parrafo.getNumChildren() !== 1 || parrafo.getChild(0).getType() !== DocumentApp.ElementType.TEXT) return '';
  const t = parrafo.getChild(0).asText();
  const url = t.getLinkUrl(0);
  return url && t.getLinkUrl(Math.max(0, t.getText().length - 1)) === url ? url : '';
}

function videoHtml_(id) {
  // Misma altura que las imágenes (ALTO_FIGURA_), centrado; en el celular ocupa todo el ancho
  return '<div class="articulo-video" style="position:relative;width:min(100%, calc(' + ALTO_FIGURA_ + ' * 16 / 9));aspect-ratio:16/9;margin:1.75em auto;">' +
    '<iframe src="https://www.youtube.com/embed/' + id + '" title="Video" style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px;" ' +
    'allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen="allowfullscreen"></iframe></div>';
}

function esListaNumerada_(glifo) {
  const G = DocumentApp.GlyphType;
  return [G.NUMBER, G.LATIN_UPPER, G.LATIN_LOWER, G.ROMAN_UPPER, G.ROMAN_LOWER].indexOf(glifo) !== -1;
}


// ===== Carpetas =====

function carpetaDelArticulo_(nombre) {
  const propiedades = PropertiesService.getScriptProperties();
  let principal = null;

  const id = propiedades.getProperty('CARPETA_ARCHIVOS');
  if (id) {
    try { principal = DriveApp.getFolderById(id); } catch (err) { principal = null; }
  }
  if (!principal) {
    principal = DriveApp.createFolder(DOCUMENTO.CARPETA_PRINCIPAL);
    propiedades.setProperty('CARPETA_ARCHIVOS', principal.getId());
  }

  const nombreFinal = nombreSeguro_(nombre) + ' · ' + fechaHoy_().replace(/[\/:]/g, '-');
  return principal.createFolder(nombreFinal);
}

function nombreSeguro_(texto) {
  return String(texto || 'articulo').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'articulo';
}

// ===== Plantilla y ejemplo para los autores =====

// Los enlaces del blog (Lineamientos) y del Form 2 apuntan a estos Google Docs con /export?format=docx:
// al editarlos aquí, cambia automáticamente lo que se descarga.
const PLANTILLA_ID_ = '1-O70q7qsPTd0gak0raVN7zfuvKiTv0-A7V8eR1UaJVw';
const PLANTILLA_DEMO_ID_ = '1hxzC6WYDhcSmFdJIwSuLJqdJtNvo9AoI'; // "Demo Articulo .docx": los nuevos se guardan en la misma carpeta

/**
 * Reescribe la plantilla y la nota de ejemplo (la crea la primera vez) y deja una vista previa
 * del ejemplo como borrador en el blog. Se ejecuta desde el editor.
 */
function actualizarPlantillas() {
  const props = PropertiesService.getScriptProperties();
  let idEjemplo = props.getProperty('EJEMPLO_ARTICULO_ID');
  if (!idEjemplo) {
    idEjemplo = DocumentApp.create('Ejemplo de nota · Blog CIAD').getId();
    const f = DriveApp.getFileById(idEjemplo);
    f.moveTo(DriveApp.getFileById(PLANTILLA_DEMO_ID_).getParents().next());
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty('EJEMPLO_ARTICULO_ID', idEjemplo);
  }
  const urlEjemplo = 'https://docs.google.com/document/d/' + idEjemplo + '/export?format=docx';

  const plantilla = DocumentApp.openById(PLANTILLA_ID_);
  escribirPlantilla_(plantilla.getBody(), urlEjemplo);
  plantilla.saveAndClose();
  const ejemplo = DocumentApp.openById(idEjemplo);
  escribirEjemplo_(ejemplo.getBody());
  ejemplo.saveAndClose();

  console.log('Plantilla: https://docs.google.com/document/d/' + PLANTILLA_ID_ + '/edit');
  console.log('Ejemplo: https://docs.google.com/document/d/' + idEjemplo + '/edit');
  console.log('Descarga del ejemplo: ' + urlEjemplo);
  console.log('Vista previa (borrador): ' + vistaPreviaEjemplo_(idEjemplo));
}

/** Convierte el ejemplo como si fuera un envío y lo deja como borrador (siempre el mismo; la carpeta anterior va a la papelera). */
function vistaPreviaEjemplo_(idDoc) {
  const props = PropertiesService.getScriptProperties();
  const titulo = 'Ejemplo de nota: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt';
  const archivo = procesarArchivoArticulo_(idDoc, 'Vista previa · Ejemplo de nota', titulo);
  const contenido = armarContenido_({
    subtitulo: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aquí va el resumen del formulario (máximo 100 palabras), en azul bajo el título.',
    ficha: { nombre: 'Nombre Apellido Apellido', fecha: fechaCorta_(new Date()), correo: 'nombre.apellido@uabc.edu.mx', cargo: 'Docente de tiempo completo', vinculo: 'Universidad Autónoma de Baja California' },
    resumen: '', cuerpo: archivo.html, palabras: archivo.palabras, idPdf: archivo.idPdf, idsImagenes: []
  });
  const anterior = props.getProperty('EJEMPLO_CARPETA');
  if (anterior) { try { DriveApp.getFolderById(anterior).setTrashed(true); } catch (err) { /* Ya no existe */ } }
  props.setProperty('EJEMPLO_CARPETA', archivo.idCarpeta);

  let postId = props.getProperty('EJEMPLO_POST');
  try {
    if (!postId) throw new Error('nuevo');
    blogger_('PATCH', '/blogs/' + CONFIG.BLOG_ID + '/posts/' + postId, { title: titulo, content: contenido });
  } catch (err) {
    postId = blogger_('POST', '/blogs/' + CONFIG.BLOG_ID + '/posts/?isDraft=true', { kind: 'blogger#post', title: titulo, content: contenido }).id;
    props.setProperty('EJEMPLO_POST', postId);
  }
  return 'https://www.blogger.com/blog/post/edit/' + CONFIG.BLOG_ID + '/' + postId;
}

// --- Funciones auxiliares para escribir los Docs ---

function escritor_(cuerpo) {
  cuerpo.clear();
  const H = DocumentApp.ParagraphHeading;
  const atributo = {}; // Como piden los lineamientos: Arial 12
  atributo[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  atributo[DocumentApp.Attribute.FONT_SIZE] = 12;
  cuerpo.setHeadingAttributes(H.NORMAL, atributo);
  const w = {
    p: function (t, h) {
      const p = cuerpo.appendParagraph(t);
      p.setHeading(h || H.NORMAL);
      if (!h) p.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY).setSpacingAfter(8);
      return p;
    },
    h2: function (t) { return w.p(t, H.HEADING2); },
    h3: function (t) { return w.p(t, H.HEADING3); },
    nota: function (t, h) { return w.gris(w.p(t, h)).setAlignment(DocumentApp.HorizontalAlignment.LEFT).setSpacingAfter(6); },
    // "[ETIQUETA · obligatorio. texto]": la etiqueta va en verde y negritas para ubicar cada parte rápido
    guia: function (etiqueta, texto) {
      const p = w.nota('[' + etiqueta + '. ' + texto + ']').setSpacingBefore(10);
      p.editAsText().setBold(1, etiqueta.length, true).setForegroundColor(1, etiqueta.length, '#00723F');
      return p;
    },
    gris: function (el) { el.editAsText().setForegroundColor('#5d6b7c').setItalic(true); return el; },
    vinieta: function (t, nivel, glifo) {
      const li = cuerpo.appendListItem(t).setNestingLevel(nivel || 0).setGlyphType(glifo || DocumentApp.GlyphType.BULLET);
      return li;
    },
    negritaInicial: function (el, hasta) { el.editAsText().setBold(0, hasta - 1, true); return el; },
    fin: function () {
      // El primer renglón vacío que deja clear()
      if (cuerpo.getNumChildren() > 1 && !cuerpo.getChild(0).asParagraph().getText()) cuerpo.removeChild(cuerpo.getChild(0));
    }
  };
  return w;
}

function imagenDeEjemplo_(ancho, alto, texto) {
  const url = 'https://placehold.co/' + ancho + 'x' + alto + '/00723F/FFFFFF/png?font=roboto&text=' + encodeURIComponent(texto);
  return UrlFetchApp.fetch(url).getBlob().setName(texto + '.png');
}

function escribirPlantilla_(cuerpo, urlEjemplo) {
  const w = escritor_(cuerpo);
  const C = DocumentApp.HorizontalAlignment.CENTER;
  w.guia('CÓMO USAR ESTA PLANTILLA', 'Lo gris entre corchetes es solo una guía: no se publica. Bórralo cuando quieras.');
  w.nota('[Aquí va solo el texto de tu nota. Tu nombre, correo, título y resumen ya vienen escritos en el formulario de envío.]');
  w.nota('[Escribe de corrido, como un artículo de revista. Las partes de abajo son una guía de lo que suele llevar una buena nota: no escribas sus nombres como títulos y acomódalas como mejor fluya tu texto.]');
  w.nota('[Extensión recomendada: 1,000 a 2,500 palabras (no es obligatoria), Arial 12, texto justificado. En el blog tu nota mostrará cuántos minutos toma leerla. Mira una nota terminada en: ' + urlEjemplo + ' ]');

  w.guia('INICIO', 'Cuenta de qué trata tu nota y por qué importa.');
  w.guia('DESARROLLO', 'Explica tus ideas. Si quieres separarlas, ponles un subtítulo propio con el estilo Título 2, por ejemplo «Tutoría personalizada».');
  w.guia('Puedes usar', 'Todo se publica igual que en tu Word:');
  w.nota('[Listas: botones de viñetas o de números de Word; con Tab bajas un nivel.]');
  w.nota('[Imagen: pégala sola en su renglón, con el ajuste “En línea con el texto”. En el blog todas salen centradas y a la misma altura.]');
  w.nota('[Pie de la imagen: el renglón centrado justo debajo. Ejemplo: Imagen 1. Qué muestra. Fuente: autor o sitio (año).]').setAlignment(C);
  w.nota('[Cita textual de 40 palabras o más: en su propio párrafo, sin comillas y con sangría izquierda de 1.27 cm.]');
  w.nota('[Tabla de Word (la primera fila es el encabezado) o un enlace de YouTube solo en su renglón, que se muestra como video.]');
  w.guia('CÓMO CITAR (OPCIONAL)', 'Puedes escribir libremente, sin fuentes. Si citas, usa la forma que prefieras; puedes mezclarlas:');
  w.nota('[1. Con número: escribe [[1]] justo después de la idea y empieza la línea de esa fuente en Referencias con [[1]]. En el blog sale un número pequeño; al pasar el cursor se ve la fuente y se puede abrir.]');
  w.nota('[2. Con enlace: selecciona unas palabras y ponles un hipervínculo (Ctrl + K) a la página de la fuente.]');
  w.nota('[3. Con APA: (Apellido, 2024) o Apellido (2024) en el texto y la fuente completa en Referencias.]');
  w.guia('TU EXPERIENCIA', 'Si lo aplicaste en clase o en un proyecto, cuéntalo: qué hiciste y qué resultó. Si no lo ocupas, no es necesario.');
  w.guia('INVITACIÓN', 'Un cierre que invite a quien lee a probarlo o a escribirte. Si no lo ocupas, no es necesario.');

  w.guia('AL FINAL', 'Solo si las ocupas, con su título tal cual:');
  w.h2('Síntesis curricular');
  w.nota('[Hasta 3 líneas por autor: formación, cargo e institución. Si no la ocupas, borra también el título.]');
  w.h2('Referencias');
  w.nota('[Solo si citaste; si no, borra también el título. Una fuente por párrafo, en APA 7 y de preferencia de 2020 a la fecha. Primero las que usas con número, empezando con [[1]], [[2]]… en ese orden; después las demás, en orden alfabético. Ejemplos: [[1]] UNESCO. (2023). Título de la guía. https://www.unesco.org/es  ·  Apellido, A. (2026). Título de la obra. Editorial.]');
  w.fin();
}

function escribirEjemplo_(cuerpo) {
  const w = escritor_(cuerpo);
  const A = DocumentApp.HorizontalAlignment;
  const parte = function (etiqueta, t) { return w.guia(etiqueta, t); }; // Marca de qué parte es: no se publica
  w.guia('NOTA DE EJEMPLO', 'El texto es de relleno (lorem ipsum): fíjate en la forma. Las marcas grises entre corchetes solo señalan qué parte es cada bloque y no se publican. Observa que la nota no dice «Introducción» ni «Desarrollo»: se lee de corrido. Cita de las tres formas posibles (con número [[1]], con enlace y con APA); tu nota puede usar una, varias o ninguna.');

  parte('INICIO', 'Presenta el tema y por qué importa.');
  const intro = w.p('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Cras mattis consectetur purus sit amet fermentum, como señalan García y López (2024), donec ullamcorper nulla non metus auctor fringilla. Consulta el ');
  intro.appendText('sitio del CIAD').setLinkUrl('https://ciad-innovaedutec.blogspot.com/');
  intro.appendText(' para más recursos.').setLinkUrl(null);
  w.p('Vestibulum id ligula porta felis euismod semper. Maecenas sed diam eget risus varius blandit sit amet non magna (Martínez, 2023). Nullam quis risus eget urna mollis ornare vel eu leo. Aenean lacinia bibendum nulla sed consectetur.');

  parte('DESARROLLO', 'Las ideas, cada una con sus fuentes. Más abajo lleva un subtítulo propio, no «Desarrollo».');
  w.p('Curabitur blandit tempus porttitor. Etiam porta sem malesuada magna mollis euismod [[1]]. Sed posuere consectetur est at lobortis, ya que fusce dapibus tellus ac cursus commodo (Hernández et al., 2025).');
  const conEnlace = w.p('Como muestra el ');
  conEnlace.appendText('portal de educación digital de la UNESCO').setLinkUrl('https://www.unesco.org/es/digital-education');
  conEnlace.appendText(', donec ullamcorper nulla non metus auctor fringilla [[2]]. Las tres ideas clave de la propuesta son:').setLinkUrl(null);
  w.negritaInicial(w.vinieta('Lorem ipsum: dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor (García y López, 2024).'), 12);
  w.negritaInicial(w.vinieta('Dolor sit amet: maecenas faucibus mollis interdum, nullam id dolor id nibh ultricies (Pérez, 2022).'), 14);
  w.negritaInicial(w.vinieta('Consectetur: aenean eu leo quam, pellentesque ornare sem lacinia quam venenatis (Ramírez, 2021).'), 12);

  const im1 = w.p('');
  im1.appendInlineImage(imagenDeEjemplo_(1600, 900, 'Imagen horizontal 16:9')).setWidth(440).setHeight(248);
  im1.setAlignment(A.CENTER);
  w.p('Imagen 1. Lorem ipsum dolor sit amet en una actividad de aula. Fuente: elaboración propia (2026).')
    .setAlignment(A.CENTER).editAsText().setItalic(true).setFontSize(10);

  w.h2('Lorem ipsum en el aula');
  w.p('Donec sed odio dui. Para implementarlo se siguieron estos pasos:');
  w.vinieta('Nulla vitae elit libero, a pharetra augue.', 0, DocumentApp.GlyphType.NUMBER);
  w.vinieta('Integer posuere erat a ante venenatis dapibus.', 1, DocumentApp.GlyphType.LATIN_LOWER);
  w.vinieta('Cras mattis consectetur purus sit amet.', 1, DocumentApp.GlyphType.LATIN_LOWER);
  w.vinieta('Vivamus sagittis lacus vel augue laoreet rutrum.', 0, DocumentApp.GlyphType.NUMBER);
  w.p('Como explica Martínez (2023), la clave está en la práctica constante:');
  w.p('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat, duis aute irure dolor in reprehenderit. (p. 45)')
    .setIndentStart(36).setIndentFirstLine(36);

  w.p('Figura 2').editAsText().setBold(true);
  w.p('Lorem ipsum: modelo de trabajo en tres fases').editAsText().setItalic(true);
  const im2 = w.p('');
  im2.appendInlineImage(imagenDeEjemplo_(900, 1200, 'Imagen vertical 3:4')).setWidth(210).setHeight(280);
  im2.setAlignment(A.CENTER);
  w.p('Nota. Adaptado de Hernández et al. (2025).').editAsText().setFontSize(10);

  parte('TU EXPERIENCIA', 'Cómo lo aplicaste y qué resultó.');
  w.p('En nuestro grupo de lorem ipsum aplicamos la propuesta durante un semestre. Nullam id dolor id nibh ultricies vehicula ut id elit. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. La tabla resume los resultados:');
  const tabla = cuerpo.appendTable([
    ['Fase', 'Lorem ipsum', 'Resultado'],
    ['1. Diagnóstico', 'Dolor sit amet', '80 %'],
    ['2. Aplicación', 'Consectetur adipiscing', '92 %']
  ]);
  tabla.getRow(0).editAsText().setBold(true);
  w.p('Donec id elit non mi porta gravida at eget metus, con resultados similares a los de García y López (2024).');

  parte('INVITACIÓN', 'Cierra invitando a quien lee.');
  w.p('Etiam porta sem malesuada magna mollis euismod. Te invitamos a probar lorem ipsum en tu propia aula y a escribirnos para compartir tu experiencia.');

  w.h2('Síntesis curricular');
  w.p('Nombre Apellido Apellido es maestro en lorem ipsum por la Universidad Autónoma de Baja California y docente de tiempo completo en la Facultad de Dolor Sit Amet.');

  w.h2('Referencias');
  // [referencia, texto en cursiva (APA: nombre de la revista y volumen, o título del libro)]
  [
    // Primero las citas numeradas, en orden; después las de APA normal, en orden alfabético
    ['[[1]] Organización de las Naciones Unidas para la Educación, la Ciencia y la Cultura. (2023). Lorem ipsum: guía para la inteligencia artificial generativa en la educación. UNESCO. https://www.unesco.org/es', 'Lorem ipsum: guía para la inteligencia artificial generativa en la educación'],
    ['[[2]] Ruiz, D. (2024). Dolor sit amet en la práctica docente [Ponencia]. Encuentro Ipsum de Educación, Ensenada, México.', 'Dolor sit amet en la práctica docente'],
    ['García, A., y López, B. (2024). Lorem ipsum dolor sit amet en la educación superior. Revista Consectetur, 12(3), 45–67. https://doi.org/10.0000/rc.2024.003', 'Revista Consectetur, 12'],
    ['Hernández, C., Ruiz, D., y Soto, E. (2025). Adipiscing elit: modelos de enseñanza digital. Editorial Lorem.', 'Adipiscing elit: modelos de enseñanza digital'],
    ['Martínez, F. (2023). Sed do eiusmod tempor: guía práctica para docentes. Ediciones Ipsum.', 'Sed do eiusmod tempor: guía práctica para docentes'],
    ['Pérez, G. (2022). Incididunt ut labore et dolore. Revista de Innovación Educativa, 8(1), 10–25. https://doi.org/10.0000/rie.2022.001', 'Revista de Innovación Educativa, 8'],
    ['Ramírez, H. (2021). Magna aliqua en entornos virtuales. Revista Dolor, 5(2), 33–48.', 'Revista Dolor, 5'],
    ['Torres, I. (2020). Ut enim ad minim veniam [Conferencia]. Congreso Lorem de Educación, Mexicali, México.', 'Ut enim ad minim veniam']
  ].forEach(function (r) {
    const p = w.p(r[0]).setIndentStart(36).setIndentFirstLine(0);
    const i = r[0].indexOf(r[1]);
    p.editAsText().setItalic(i, i + r[1].length - 1, true);
  });
  w.fin();
}
