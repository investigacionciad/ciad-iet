/**
 * @fileoverview Páginas de Blogger que se editan desde el Panel CIAD.
 * @author APONTE
 * Capa: Servicio (lee, valida y publica las páginas con la Blogger API).
 *
 * Dos modos:
 *   - Bloque JSON entre marcas: Multimedia y Guías y tutoriales.
 *   - "textos": el resto de las páginas; solo se editan los elementos con
 *     data-editable="Nombre visible en el panel".
 *
 * Los datos de cada página están en un bloque JSON oculto entre <!-- PANEL:INICIO --> y
 * <!-- PANEL:FIN -->. El panel lee ese bloque, lo edita y vuelve a generar solo esa parte;
 * el CSS y los scripts de la página no se tocan. Después publica con la Blogger API.
 */

const PAGINAS_PANEL = {
  // ruta: final de la URL de la página en Blogger (si no coincide, se busca por título)
  multimedia: { nombre: 'Multimedia', ruta: '/p/multimedia.html' },
  guias: { nombre: 'Guías y tutoriales', ruta: '/p/guias-y-tutoriales.html' },

  // Páginas de solo textos (data-editable)
  inicio: { nombre: 'Inicio', ruta: '/p/inicio.html', modo: 'textos' },
  // NOTA: las 4 páginas de sección (Tecnología Educativa, Emergentes, Innovación, Ética) ya no se editan aquí.
  // Solo tienen banner, subtítulos y sus notas; las notas por fila y por tema son fijas en la página.
  // lista: además de los textos, la lista del equipo va en un bloque JSON entre marcas
  sobre: { nombre: 'Sobre el blog', ruta: '/p/sobre-el-blog.html', modo: 'textos', lista: 'equipo' }
};

const MARCA_INICIO_ = '<!-- PANEL:INICIO -->';
const MARCA_FIN_ = '<!-- PANEL:FIN -->';


// ===== Funciones del panel =====

function obtenerPaginaPanel(tipo) {
  exigirAcceso_();
  const conf = configPagina_(tipo);
  const pagina = paginaBlogger_(tipo, true);

  if (conf.modo === 'textos') {
    const textos = extraerTextos_(pagina.content || '');
    if (!textos.length) {
      throw new Error('La página "' + conf.nombre + '" no tiene textos marcados con data-editable. Pega primero la versión nueva de la página en Blogger.');
    }
    const datosTextos = { textos: textos };
    if (conf.lista) {
      const bloque = extraerDatos_(pagina.content || '');
      if (!bloque) throw new Error('La página "' + conf.nombre + '" todavía no tiene la lista del equipo en el formato del panel.');
      datosTextos.equipo = bloque.equipo || [];
    }
    return { datos: datosTextos, url: pagina.url, version: pagina.updated };
  }

  const datos = extraerDatos_(pagina.content || '');
  if (!datos) {
    throw new Error('La página "' + conf.nombre + '" todavía no tiene el formato del panel. Pega primero la versión nueva de la página en Blogger (ver GUIA-paginas).');
  }
  return { datos: datos, url: pagina.url, version: pagina.updated };
}

function publicarPaginaPanel(tipo, datos, version) {
  exigirAcceso_();
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(30000);
  try {
    const conf = configPagina_(tipo);
    const pagina = paginaBlogger_(tipo, true);

    if (version && pagina.updated !== version) {
      throw new Error('Alguien modificó la página mientras la editabas. Recarga el panel para ver la versión actual (tus cambios no se publicaron).');
    }

    const contenido = pagina.content || '';
    let nuevo;

    if (conf.modo === 'textos') {
      nuevo = reemplazarTextos_(contenido, (datos && datos.textos) || []);
      if (conf.lista) nuevo = reemplazarBloque_(nuevo, tipo, datos, conf);
    } else {
      nuevo = reemplazarBloque_(contenido, tipo, datos, conf);
    }

    // IMPORTANTE: Blogger no guarda versiones de las páginas, así que antes de publicar se respalda el HTML actual.
    // Si el respaldo falla, no se publica.
    let respaldo;
    try {
      respaldo = respaldarPagina_(conf, contenido);
    } catch (err) {
      throw new Error('No se pudo guardar el respaldo de la página en Drive (' + err.message + '). No se publicó nada.');
    }

    const actualizada = blogger_('PATCH', '/blogs/' + CONFIG.BLOG_ID + '/pages/' + pagina.id + '?publish=true', { content: nuevo });
    return {
      mensaje: 'Página "' + conf.nombre + '" publicada. La versión anterior quedó respaldada en Drive.',
      url: actualizada.url || pagina.url,
      version: actualizada.updated,
      respaldo: respaldo
    };
  } finally {
    bloqueo.releaseLock();
  }
}

/** Multimedia y Guías: vuelve a generar solo lo que está entre las marcas del panel. */
function reemplazarBloque_(contenido, tipo, datos, conf) {
  const i = contenido.indexOf(MARCA_INICIO_);
  const j = contenido.indexOf(MARCA_FIN_);
  if (i === -1 || j === -1 || j < i) throw new Error('No se encontraron las marcas del panel en la página "' + conf.nombre + '".');

  const limpiar = { multimedia: limpiarMultimedia_, guias: limpiarGuias_, sobre: limpiarEquipo_ }[tipo];
  const generar = { multimedia: generarMultimedia_, guias: generarGuias_, sobre: generarEquipo_ }[tipo];
  const limpios = limpiar(datos || {});
  const html = generar(limpios);
  const bloque = MARCA_INICIO_ + '\n' + html + '\n' + jsonDatos_(limpios) + '\n' + MARCA_FIN_;
  return contenido.slice(0, i) + bloque + contenido.slice(j + MARCA_FIN_.length);
}

/**
 * Revisa qué páginas tienen el formato del panel, para marcarlas en el selector.
 * Devuelve { tipo: { habilitada: true|false, motivo: '' } }
 */
function obtenerEstadoPaginas() {
  exigirAcceso_();
  const estado = {};
  const tipos = Object.keys(PAGINAS_PANEL);

  // OPT: las 8 páginas se piden a Blogger en paralelo (fetchAll), no una por una.
  const ids = {};
  tipos.forEach(function (tipo) {
    try { ids[tipo] = idPagina_(tipo); } catch (err) { estado[tipo] = { habilitada: false, motivo: err.message }; }
  });
  const conId = tipos.filter(function (t) { return ids[t]; });
  const token = ScriptApp.getOAuthToken();
  const respuestas = UrlFetchApp.fetchAll(conId.map(function (tipo) {
    return {
      url: 'https://www.googleapis.com/blogger/v3/blogs/' + CONFIG.BLOG_ID + '/pages/' + ids[tipo],
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  }));

  respuestas.forEach(function (r, i) {
    const tipo = conId[i];
    const conf = PAGINAS_PANEL[tipo];
    try {
      const codigo = r.getResponseCode();
      if (codigo >= 300) throw new Error(mensajeBlogger_(codigo, r.getContentText())); // ver PanelServidor.gs
      const contenido = JSON.parse(r.getContentText()).content || '';
      const habilitada = conf.modo === 'textos'
        ? extraerTextos_(contenido).length > 0 && (!conf.lista || !!extraerDatos_(contenido))
        : !!extraerDatos_(contenido);
      estado[tipo] = { habilitada: habilitada, motivo: habilitada ? '' : (conf.modo === 'textos' ? 'No tiene textos marcados como editables.' : 'No tiene el formato del panel.') };
    } catch (err) {
      estado[tipo] = { habilitada: false, motivo: err.message };
    }
  });
  return estado;
}

/** Datos de un video de YouTube a partir de cualquier enlace o ID. */
function infoVideoYoutube(texto) {
  exigirAcceso_();
  const id = idVideo_(texto);
  if (!id) throw new Error('No es un enlace de YouTube válido.');

  const r = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    throw new Error('El video no existe, es privado o no permite insertarse en otras páginas.');
  }
  const info = JSON.parse(r.getContentText());
  return { id: id, titulo: info.title || '', canal: info.author_name || '' };
}


// ===== Blogger =====

// --- Respaldos ---

const RESPALDOS_ = {
  CARPETA: 'Publicador CIAD · respaldos de páginas',
  POR_PAGINA: 15   // Se guardan los últimos 15 respaldos de cada página
};

/** Guarda el HTML actual de la página como archivo .html en Drive y devuelve su URL. */
function respaldarPagina_(conf, contenido) {
  const props = PropertiesService.getScriptProperties();
  let carpeta = null;
  const id = props.getProperty('CARPETA_RESPALDOS');
  if (id) { try { carpeta = DriveApp.getFolderById(id); } catch (err) { carpeta = null; } }
  if (!carpeta) {
    carpeta = DriveApp.createFolder(RESPALDOS_.CARPETA);
    props.setProperty('CARPETA_RESPALDOS', carpeta.getId());
  }

  const prefijo = nombreSeguro_(conf.nombre) + ' · ';
  // Con segundos, para que dos publicaciones en el mismo minuto no tengan el mismo nombre
  const fecha = Utilities.formatDate(new Date(), 'America/Tijuana', 'dd-MM-yyyy HH-mm-ss');
  const archivo = carpeta.createFile(prefijo + fecha + '.html', contenido, MimeType.HTML);

  // Limpieza: se conservan solo los más recientes de esta página.
  // OPT: solo se buscan los respaldos de esta página y se ignoran los de la papelera.
  const anteriores = [];
  const nombreBuscado = nombreSeguro_(conf.nombre).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const it = carpeta.searchFiles("title contains '" + nombreBuscado + "' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(prefijo) === 0) anteriores.push(f);
  }
  anteriores.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  anteriores.slice(RESPALDOS_.POR_PAGINA).forEach(function (f) { f.setTrashed(true); });

  return archivo.getUrl();
}

function configPagina_(tipo) {
  const conf = PAGINAS_PANEL[tipo];
  if (!conf) throw new Error('Página desconocida: ' + tipo);
  return conf;
}

/** Busca la página por su ruta (o por título) y guarda su ID para las siguientes veces. */
function paginaBlogger_(tipo, conContenido) {
  const id = idPagina_(tipo);
  return blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/pages/' + id + (conContenido ? '' : '?fetchBody=false'));
}

/** ID de la página en Blogger (se guarda en las propiedades del script la primera vez que se busca). */
function idPagina_(tipo) {
  const conf = configPagina_(tipo);
  const props = PropertiesService.getScriptProperties();
  const clave = 'PAGINA_' + tipo.toUpperCase() + '_' + CONFIG.BLOG_ID;
  let id = props.getProperty(clave);

  if (!id) {
    const lista = blogger_('GET', '/blogs/' + CONFIG.BLOG_ID + '/pages?fetchBodies=false&status=live').items || [];
    const encontrada = lista.filter(function (p) {
      return String(p.url || '').indexOf(conf.ruta) !== -1;
    })[0] || lista.filter(function (p) {
      return normalizar_(p.title) === normalizar_(conf.nombre);
    })[0];
    if (!encontrada) {
      throw new Error('No encontré la página "' + conf.nombre + '" (' + conf.ruta + '). Páginas del blog: ' +
        lista.map(function (p) { return p.url; }).join(', '));
    }
    id = encontrada.id;
    props.setProperty(clave, id);
  }
  return id;
}

function extraerDatos_(contenido) {
  const m = String(contenido).match(/<script[^>]*id=["']datos-panel["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (err) { return null; }
}

// --- Páginas de solo textos (data-editable) ---

/** Encuentra <h1|h2|h3|p ... data-editable="Nombre">texto</...>. NOTA: se crea una nueva en cada uso porque es global (/g). */
function regexEditable_() {
  return /<(h1|h2|h3|p)(\s[^>]*?\bdata-editable="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
}

function extraerTextos_(contenido) {
  const textos = [];
  const vistos = {};
  String(contenido).replace(regexEditable_(), function (todo, etiqueta, atributos, clave, interior) {
    if (vistos[clave]) throw new Error('El texto "' + clave + '" está repetido en la página. Cada data-editable debe tener un nombre distinto.');
    vistos[clave] = true;
    textos.push({ clave: clave, texto: htmlATexto_(interior), largo: etiqueta.toLowerCase() === 'p' });
    return todo;
  });
  return textos;
}

function reemplazarTextos_(contenido, textos) {
  const nuevos = Object.create(null);
  textos.forEach(function (t) {
    const texto = String(t.texto == null ? '' : t.texto).replace(/\r/g, '').trim().slice(0, 2000);
    // Un título o párrafo vacío deja un hueco en la página: no se publica
    if (!texto) throw new Error('El campo "' + t.clave + '" está vacío. Escribe un texto antes de publicar (no se publicó nada).');
    nuevos[String(t.clave)] = texto;
  });
  return String(contenido).replace(regexEditable_(), function (todo, etiqueta, atributos, clave) {
    if (!(clave in nuevos)) return todo;
    return '<' + etiqueta + atributos + '>' + escaparHtml_(nuevos[clave]).replace(/\n/g, '<br>') + '</' + etiqueta + '>';
  });
}

/** HTML de un párrafo a texto plano (los <br> se vuelven saltos de línea). */
function htmlATexto_(html) {
  return String(html)
    .replace(/\s+/g, ' ') // Los saltos de línea del HTML no cuentan; solo los <br>
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); })
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).join('\n')
    .trim();
}

function jsonDatos_(datos) {
  // IMPORTANTE: "<" va escapado para que el JSON nunca pueda cerrar la etiqueta <script>
  return '<script type="application/json" id="datos-panel">' + JSON.stringify(datos).replace(/</g, '\\u003c') + '</script>';
}


// ===== Validación de datos (todo lo que llega del navegador se revisa) =====

function texto_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 500); }

function urlSegura_(v) {
  const u = String(v || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u.slice(0, 1000) : '';
}

function idVideo_(v) {
  const t = String(v || '').trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : '';
}

function ancla_(v, usadas) {
  let base = normalizar_(v).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guia';
  let a = base, n = 2;
  while (usadas[a]) a = base + '-' + (n++);
  usadas[a] = true;
  return a;
}

function limpiarMultimedia_(d) {
  const videos = (d.videos || []).slice(0, 100).map(function (v) {
    return { id: idVideo_(v.id), titulo: texto_(v.titulo, 150), descripcion: texto_(v.descripcion, 400), etiqueta: texto_(v.etiqueta, 30) || 'Video' };
  }).filter(function (v) { return v.id; });
  return { titulo: texto_(d.titulo, 120) || 'Multimedia', descripcion: texto_(d.descripcion, 400), videos: videos };
}

function limpiarGuias_(d) {
  const usadas = {};
  const guias = (d.guias || []).slice(0, 40).map(function (g) {
    const menu = texto_(g.menu, 40) || texto_(g.titulo, 40);
    return {
      ancla: ancla_(g.ancla || menu, usadas),
      menu: menu,
      etiqueta: texto_(g.etiqueta, 60),
      titulo: texto_(g.titulo, 120),
      subtitulo: texto_(g.subtitulo, 120),
      descripcion: texto_(g.descripcion, 800),
      video: idVideo_(g.video),
      imagen: urlSegura_(g.imagen),
      imagenAlt: texto_(g.imagenAlt, 150),
      recursos: (g.recursos || []).slice(0, 10).map(function (r) {
        return {
          titulo: texto_(r.titulo, 60),
          descripcion: texto_(r.descripcion, 400),
          enlaces: (r.enlaces || []).slice(0, 50).map(function (e) {
            return { texto: texto_(e.texto, 150), url: urlSegura_(e.url) };
          }).filter(function (e) { return e.texto; })
        };
      }).filter(function (r) { return r.titulo; })
    };
  }).filter(function (g) { return g.titulo; });

  const a = d.ayuda || {};
  return {
    titulo: texto_(d.titulo, 120) || 'Guías y tutoriales',
    descripcion: texto_(d.descripcion, 400),
    guias: guias,
    ayuda: { titulo: texto_(a.titulo, 120), texto: texto_(a.texto, 400), boton: texto_(a.boton, 60), url: urlSegura_(a.url) }
  };
}


// ===== Generadores de HTML (mismo marcado que las páginas originales) =====

function generarMultimedia_(d) {
  const e = escaparHtml_;
  let h = '';
  h += '  <header class="encabezado-multimedia">\n';
  h += '    <h1>' + e(d.titulo) + '</h1>\n';
  h += '    <p>\n      ' + e(d.descripcion) + '\n    </p>\n';
  h += '  </header>\n\n';
  h += '  <section class="bloque-multimedia">\n';
  h += '    <div class="lista-multimedia">\n';
  d.videos.forEach(function (v) {
    h += '\n      <article class="tarjeta-multimedia" data-video-id="' + e(v.id) + '">\n';
    h += '        <a href="https://www.youtube.com/watch?v=' + e(v.id) + '" class="abrir-video" aria-label="Ver video: ' + e(v.titulo) + '">\n';
    h += '          <div class="miniatura-multimedia">\n';
    h += '            <img src="https://img.youtube.com/vi/' + e(v.id) + '/hqdefault.jpg" alt="' + e(v.titulo) + '" loading="lazy">\n';
    h += '            <span class="boton-play">▶</span>\n';
    h += '          </div>\n';
    h += '        </a>\n';
    h += '        <div class="contenido-multimedia">\n';
    h += '          <p class="etiqueta-multimedia">' + e(v.etiqueta) + '</p>\n';
    h += '          <h3 class="titulo-multimedia">' + e(v.titulo) + '</h3>\n';
    if (v.descripcion) h += '          <p class="descripcion-multimedia">\n            ' + e(v.descripcion) + '\n          </p>\n';
    h += '        </div>\n';
    h += '      </article>\n';
  });
  h += '\n    </div>\n';
  h += '  </section>';
  return h;
}

function generarGuias_(d) {
  const e = escaparHtml_;
  const T = '\t\t';
  let h = '';

  h += T + '<header class="et-encabezado">\n';
  h += T + '\t<h1>' + e(d.titulo) + '</h1>\n';
  h += T + '\t<p>\n' + T + '\t\t' + e(d.descripcion) + '\n' + T + '\t</p>\n';
  h += T + '</header>\n\n';

  h += T + '<nav class="et-navegacion">\n';
  d.guias.forEach(function (g) { h += T + '\t<a href="#' + e(g.ancla) + '">' + e(g.menu) + '</a>\n'; });
  h += T + '</nav>\n';

  d.guias.forEach(function (g) {
    const imagen = g.imagen || (g.video ? 'https://img.youtube.com/vi/' + g.video + '/hqdefault.jpg' : '');
    const alt = g.imagenAlt || g.titulo;
    h += '\n' + T + '<section class="et-guia" id="' + e(g.ancla) + '">\n\n';
    if (g.etiqueta) h += T + '\t<span class="et-guia-etiqueta">' + e(g.etiqueta) + '</span>\n\n';
    h += T + '\t<h2 class="et-guia-titulo">' + e(g.titulo) + '</h2>\n\n';
    h += T + '\t<div class="et-presentacion">\n\n';
    h += T + '\t\t<div class="et-descripcion">\n';
    if (g.subtitulo) h += T + '\t\t\t<h3>' + e(g.subtitulo) + '</h3>\n';
    h += T + '\t\t\t<p>\n' + T + '\t\t\t\t' + e(g.descripcion) + '\n' + T + '\t\t\t</p>\n';
    h += T + '\t\t</div>\n\n';
    if (imagen) {
      h += T + '\t\t<div class="et-imagen et-video">\n';
      h += T + '\t\t\t<img src="' + e(imagen) + '" alt="' + e(alt) + '">\n';
      h += T + '\t\t\t<a class="et-video-enlace" href="' + (g.video ? 'https://www.youtube.com/watch?v=' + e(g.video) : '#') + '" target="_blank"' +
        (g.video ? ' data-video-id="' + e(g.video) + '"' : '') + ' aria-label="Ver video: ' + e(g.titulo) + '">\n';
      h += T + '\t\t\t\t<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>\n';
      h += T + '\t\t\t</a>\n';
      h += T + '\t\t</div>\n';
    }
    h += '\n' + T + '\t</div>\n\n';

    if (g.recursos.length) {
      h += T + '\t<div class="et-recursos">\n';
      g.recursos.forEach(function (r) {
        h += '\n' + T + '\t\t<details class="et-recurso">\n';
        h += T + '\t\t\t<summary>\n' + T + '\t\t\t\t' + e(r.titulo) + '\n' + T + '\t\t\t\t<span class="et-flecha">›</span>\n' + T + '\t\t\t</summary>\n\n';
        h += T + '\t\t\t<div class="et-recurso-contenido">\n';
        if (r.descripcion) h += T + '\t\t\t\t<p>\n' + T + '\t\t\t\t\t' + e(r.descripcion) + '\n' + T + '\t\t\t\t</p>\n\n';
        h += T + '\t\t\t\t<div class="et-lista-enlaces">\n';
        r.enlaces.forEach(function (l) {
          h += T + '\t\t\t\t\t<a href="' + (l.url ? e(l.url) : '#') + '" target="_blank"' + (l.url ? ' rel="noopener"' : '') + '>' + e(l.texto) + '</a>\n';
        });
        h += T + '\t\t\t\t</div>\n';
        h += T + '\t\t\t</div>\n';
        h += T + '\t\t</details>\n';
      });
      h += '\n' + T + '\t</div>\n';
    }
    h += '\n' + T + '</section>\n';
  });

  const a = d.ayuda;
  if (a && (a.titulo || a.texto || a.boton)) {
    h += '\n' + T + '<div class="et-ayuda-final">\n';
    if (a.titulo) h += T + '\t<h2>' + e(a.titulo) + '</h2>\n';
    if (a.texto) h += T + '\t<p>\n' + T + '\t\t' + e(a.texto) + '\n' + T + '\t</p>\n';
    if (a.boton) h += T + '\t<a class="et-boton-ayuda" href="' + (a.url ? e(a.url) : '#') + '"' + (a.url ? ' target="_blank" rel="noopener"' : '') + '>' + e(a.boton) + '</a>\n';
    h += T + '</div>';
  }
  return h;
}

// --- Equipo (Sobre el blog) ---

function limpiarEquipo_(d) {
  const equipo = (d.equipo || []).slice(0, 40).map(function (m) {
    return { nombre: texto_(m.nombre, 120), cargo: texto_(m.cargo, 120), foto: urlSegura_(m.foto) };
  }).filter(function (m) { return m.nombre; });
  return { equipo: equipo };
}

/** Genera el mismo HTML que tenía la página hecha a mano (tarjeta-integrante), para que su CSS siga funcionando. */
function generarEquipo_(d) {
  return d.equipo.map(function (m) {
    const nombre = escaparHtml_(m.nombre);
    const foto = m.foto ? '<img alt="' + nombre + '" loading="lazy" onerror="this.style.display=\'none\'" src="' + escaparHtml_(m.foto) + '">' : '';
    return '<article class="tarjeta-integrante">\n' +
      '  <div class="foto-integrante">' + foto + '</div>\n' +
      '  <h3 class="nombre-integrante">' + nombre + '</h3>\n' +
      '  <p class="cargo-integrante">' + escaparHtml_(m.cargo) + '</p>\n' +
      '</article>';
  }).join('\n');
}
