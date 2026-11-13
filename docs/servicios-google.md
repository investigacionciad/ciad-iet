# Servicios de Google del blog del CIAD

Aquí están los datos de lo que no se puede guardar como código. Todo es de la cuenta `<CUENTA_CIAD>` (ver `CREDENCIALES.md`; unidad compartida *CIAD I&D* y *Mi unidad › Blog CIAD · sistema*). Los identificadores de esta página no son secretos; Google controla quién tiene acceso.

## Blogger

- Blog: <https://ciad-innovaedutec.blogspot.com> · ID `3238130712979741887`
- El Publicador crea y publica las entradas con la **Blogger API v3**, usando el OAuth de la cuenta del CIAD.
- Etiquetas: cada entrada lleva `formato-articulo`, la etiqueta de su sección (`categoria-…`) y la de su tema. Las secciones y los temas están en `CONFIG.SECCIONES` (`publicador-ciad/Código.js`).

| Página | Ruta | ID | Dónde se edita |
|---|---|---|---|
| Inicio | `/p/inicio.html` | 7758592480728629486 | Panel CIAD › Páginas |
| Sobre el blog | `/p/sobre-el-blog.html` | 4862488966902148338 | Panel CIAD › Páginas |
| Tecnología Educativa | `/p/tecnologia-educativa.html` | 2188759747346334628 | Blogger |
| Tecnologías Emergentes | `/p/tecnologias-emergentes.html` | 2861727689010700508 | Blogger |
| Ética y Sociedad Digital | `/p/etica-y-sociedad-digital.html` | 2365380527035718685 | Blogger |
| Innovación | `/p/innovacion.html` | 3858324240136165732 | Blogger |
| Lineamientos editoriales | `/p/lineamientos-editoriales.html` | 1329302080916686513 | Blogger (o funciones del Publicador) |
| Solicitud de artículo | `/p/solicitud-de-articulo.html` | 4116400710515882306 | Blogger |
| Buscador | `/p/buscador.html` | 8628180661819521523 | Blogger |
| Todas las notas | `/p/todas-las-notas.html` | 5986770232715501899 | Tema (la página solo tiene que existir) |
| Multimedia | `/p/multimedia.html` | 2997600203041357991 | Desactivada (no está en el menú) |
| Guías y tutoriales | `/p/guias-y-tutoriales.html` | 7042622331919596750 | Desactivada (no está en el menú) |

## Google Forms

**Envío de artículo – CIAD** (el autor lo usa para mandar su Word cuando se aprueba su propuesta)
- Para editarlo: `https://docs.google.com/forms/d/1N6Y5KlQY5AEMD_G7yyZz0vBpT2WmQyIGaTtKdAfyg-U/edit`
- Enlace para el autor: `https://docs.google.com/forms/d/e/1FAIpQLSeG2WJrlD3a8BLtavq-ZJ50bXdbxMwN69pJlFRGtT1sIiGCrw/viewform`
- Guarda el correo de la cuenta de Google y manda las respuestas a la **hoja de artículos**.
- Preguntas. El texto de cada pregunta es el encabezado de su columna y tiene que ser igual al de `CONFIG.COLUMNAS_ARTICULO`:

| Pregunta | Tipo | Obligatoria |
|---|---|---|
| Nombre completo del autor(es) | Texto (prellenado, `entry.2079811391`) | Sí |
| Correo de contacto (opcional) | Texto. Se muestra en la nota; si está vacío, se usa el de la cuenta | No |
| Cargo (opcional) | Texto | No |
| Título del artículo (máximo 20 palabras) | Texto (prellenado) | Sí |
| Resumen del artículo (máximo 100 palabras) | Párrafo (prellenado) | Sí |
| Adjuntar el artículo en Word (.docx) | Archivo | Sí |
| Imagen principal de la nota | Archivo de imagen, hasta 10 MB (JPG, PNG o GIF) | Sí |
| Adjuntar imágenes para la galería (opcional) | Archivo de imagen | No |
| Palabras clave (opcional) | Texto | No |

La **solicitud de artículo** ya no se hace con Google Forms. Ahora la recibe el Receptor desde la página del blog.

Google creó dos proyectos de Apps Script vacíos (solo tienen `myFunction`) junto con los formularios. No hacen nada y no están en este repositorio:
«Solicitud de publicación de artículo» (`1Zp8bpKXE3mcGXFOH_Ojep_dIjWHgutxTncgIpGjhwWeJKqKoYPmzpq0R`) y
«Envío de artículo Edu bits» (`1wCN7HU4mAaQt6Y99PZ6rTtil4XYS2sRzY4K4DPhPe8pl1MvJ--wBJZJP`).

## Google Sheets

| Hoja | ID | Quién escribe en ella |
|---|---|---|
| Solicitudes | `1uMKjWWnLnP2V5gQZAP7-mpVYggM_SU0lX8UVQd1khq0` | El Receptor (filas nuevas) y el Panel (estado, respuesta) |
| Artículos | `14GyBkPCQgt4iVPrKwBjRUcR37BSsfkVUEdn367IDk-Q` | El formulario de envío y el Publicador (estado, enlaces, imágenes, encuadres…). Tiene una pestaña *Historial* |

Las columnas que agrega el Panel están en `PANEL.ARTICULO` (`publicador-ciad/PanelServidor.js`). Los disparadores del Publicador son `alRecibirSolicitud`, `alEditarSolicitud`, `alRecibirArticulo` y `procesarColaDrive`. Los crea la función `instalar()`.

## Google Drive

En `Mi unidad › Blog CIAD · sistema` están:
- el formulario y los archivos que suben los autores;
- *Publicador CIAD · archivos del blog*, con *Publicados <año>*, *Imágenes principales*, *Imágenes de las tarjetas* e *Imágenes de las notas*;
- *Publicador CIAD · respaldos de páginas*;
- *99 · Archivo (revisar)*;
- *Blogger-IET-Public*: plantilla y nota de ejemplo para autores, en Google Docs.

## Firebase

- Proyecto: **`ciad-blog-2026`**. El `firebaseConfig` está en el tema.
- **Authentication**: inicio de sesión con Google en el blog, para lectores y autores. El Receptor revisa el token con la Identity Toolkit API.
- **Firestore**: colecciones `comentarios` (con estado `pendiente`, `publicado` o `rechazado`), `bloqueados` y `users` (esta la llena el inicio de sesión del tema).
- Las **reglas de Firestore** están en la consola de Firebase (Firestore › Reglas). Cuando cambien, cópialas aquí como `docs/firestore.rules`.
- La clave web (`apiKey`) es pública a propósito. Es buena idea limitarla al sitio `ciad-innovaedutec.blogspot.com` en Google Cloud › Credenciales.

## Google Cloud y permisos

- Publicador (`publicador-ciad/appsscript.json`): usa Blogger, Sheets, Drive (servicio avanzado Drive v3), Docs, Forms, Firestore (`datastore`), correo, llamadas externas y disparadores. La web app se ejecuta como la cuenta que la despliega y solo la puede abrir el **dominio UABC**.
- Receptor (`receptor/appsscript.json`): la web app se ejecuta como la cuenta que la despliega y la puede abrir **cualquier persona**, porque la llama la página del blog.
- Proyecto de Google Cloud de Firebase: `ciad-blog-2026` (Authentication, Firestore, Identity Toolkit API).
