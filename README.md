# CIAD-IET · Blog del CIAD

Este repositorio tiene el sistema del blog del Centro de Investigación para el Aprendizaje Digital (CIAD) de la UABC:
<https://ciad-innovaedutec.blogspot.com>

Las notas publicadas no se guardan aquí, están en Blogger. Aquí está lo que hace funcionar el blog.

## Cómo funciona

1. El autor llena la página «Solicitud de artículo» del blog. El Receptor (Apps Script) guarda la solicitud en la hoja de solicitudes.
2. El CIAD aprueba la solicitud en el Panel CIAD. El autor recibe un correo con el formulario «Envío de artículo – CIAD» (Google Forms) ya prellenado.
3. El autor envía su Word y la imagen principal. Las respuestas llegan a la hoja de artículos.
4. El Publicador (Apps Script) convierte el Word, lo guarda en Drive y crea el borrador en Blogger.
5. El CIAD revisa la nota, la edita si hace falta (Editar nota o Clonar) y la publica desde el Panel CIAD.
6. Los lectores comentan con su cuenta de Google (Firebase). Los comentarios se moderan en el Panel CIAD.

## Qué hay en cada carpeta

| Carpeta | Qué tiene | Dónde está en producción |
|---|---|---|
| `publicador-ciad/` | El Panel CIAD (web app) y todo el proceso: conversión del Word, borradores, publicación, edición, imágenes, comentarios, páginas, mantenimiento, métricas, usuarios y avisos. También la guía de uso (`Guia.html`). | Apps Script «Publicador CIAD» |
| `receptor/` | Recibe la solicitud de artículo que se llena en el blog, revisa que la persona haya iniciado sesión con Google (Firebase) y la guarda en la hoja con su folio. | Apps Script «Receptor para solicitud de articulo» |
| `blogger-theme/` | El tema de Blogger (`theme.xml`): diseño, menús, inicio de sesión con Google, comentarios (Firebase) y tarjetas de las notas. | Blogger › Tema › Editar HTML |
| `blogger-paginas/` | Copia de las 12 páginas del blog (Inicio, secciones, Lineamientos, Solicitud de artículo, Buscador y otras). | Blogger › Páginas |
| `catalogo-uabc/` | Lista de campus, unidades y programas de la UABC para el formulario de solicitud. `generar.sh` la vuelve a crear con los datos de uabc.mx. | Pegado en la página «Solicitud de artículo» |
| `docs/` | Datos de los servicios de Google que no se pueden guardar como código: Blogger, Forms, Sheets, Drive, Firebase y Google Cloud. | — |

## Cómo hacer y subir cambios (Apps Script con clasp)

> **Datos privados.** Los IDs y enlaces del sistema no se muestran aquí porque el repositorio es público.
> Donde veas `<NOMBRE>`, el valor está en `CREDENCIALES.md` (solo en tu computadora). Si no lo tienes,
> copia `CREDENCIALES.ejemplo.md` como `CREDENCIALES.md` y pide los valores a la cuenta del CIAD.

| Proyecto | Carpeta | ID del proyecto | ID de la implementación (web app) | Acceso |
|---|---|---|---|---|
| Publicador CIAD | `publicador-ciad/` | `<PUBLICADOR_SCRIPT_ID>` | `<PUBLICADOR_ID_IMPLEMENTACION>` | Dominio UABC |
| Receptor | `receptor/` | `<RECEPTOR_SCRIPT_ID>` | `<RECEPTOR_ID_IMPLEMENTACION>` | Cualquier persona |

### Preparar tu computadora (una sola vez)

1. Instala [Node.js](https://nodejs.org) y luego clasp: `npm install -g @google/clasp`
2. Inicia sesión con `<CUENTA_CIAD>`: `clasp login`
   (crea `~/.clasprc.json` con tu sesión; ese archivo **nunca** se comparte ni se sube).
3. Conecta cada carpeta con su proyecto de Apps Script. Esto crea el `.clasp.json` de cada una (no se sube) y no toca el código:

   ```sh
   printf '{"scriptId": "%s"}\n' '<PUBLICADOR_SCRIPT_ID>' > publicador-ciad/.clasp.json
   printf '{"scriptId": "%s"}\n' '<RECEPTOR_SCRIPT_ID>'   > receptor/.clasp.json
   ```

### Subir un cambio sin cambiar el enlace

```sh
node --test pruebas                     # 1. pruebas (no se conecta a Google)
cd publicador-ciad
clasp push                              # 2. sube el código
clasp deploy -i <PUBLICADOR_ID_IMPLEMENTACION> -d "Beta 0.1.X"   # 3. actualiza la web app
```

Para el Receptor es igual, en `receptor/` y con <RECEPTOR_ID_IMPLEMENTACION>. Cambia el Receptor solo cuando haga falta: lo usa la página pública de solicitudes.

- Antes de cada `clasp push`, corre `node --test pruebas`. No se conecta a Google; prueba la conversión del Word, las citas, el filtro de HTML y las etiquetas.
- Antes de desplegar, cambia la versión en `Guia.html` (línea `guia-meta`, «Versión 0.1.X beta»).
- Si cambian los permisos (`oauthScopes` en `appsscript.json`), usa `clasp push --force`. No despliegues hasta que la cuenta del CIAD ejecute una función en el editor y acepte los permisos nuevos.
- Funciones que se ejecutan desde el editor de Apps Script:
  - `actualizarEstiloDeNotas`: úsala después de cambiar `estiloArticulo_`. Aplica el estilo nuevo a todas las notas.
  - `probarUnidadCompartida`: revisa si las imágenes del blog pueden guardarse en la unidad compartida CIAD I&D. No mueve nada.

El tema y las páginas de Blogger se cambian en Blogger. Cuando cambies algo ahí, actualiza también la copia de este repositorio (para el tema: Tema › ⋮ › Crear copia de seguridad, y guárdala en `blogger-theme/theme.xml`). Antes de guardarla, cambia la clave de `firebaseConfig.apiKey` por `<FIREBASE_API_KEY>`; si algún día restauras el tema desde esta copia, vuelve a poner la clave real.

## Ramas

| Rama | Para qué es |
|---|---|
| `main` | Lo que está en producción. |
| `dev` | Desarrollo. Todos los cambios se hacen y se prueban aquí. |

Cuando `dev` está probado, se pasa a `main`:

```sh
git checkout main && git merge --ff-only dev && git push origin main && git checkout dev
```

## Datos personales y credenciales

- Las hojas de cálculo, los archivos de Drive y los comentarios no se guardan en este repositorio. No subas exportaciones de las hojas ni respaldos con datos de autores o lectores.
- `CREDENCIALES.md`, `.clasp.json` y `.clasprc.json` están en `.gitignore`. Si `git status` muestra alguno de ellos para subir, detente y revisa.
- Algunos IDs también están dentro del código (`CONFIG` en `Código.js`, `RECEPTOR` en `Receptor.js`) y en el tema, porque el sistema los necesita para funcionar. No son contraseñas: Google controla quién tiene acceso.

## Seguridad

La clave web de Firebase (`<FIREBASE_API_KEY>`) no está en el repositorio:

- En el **tema de Blogger** sí va, porque el navegador de cada lector la necesita para iniciar sesión con Google. Por eso su protección es la restricción en Google Cloud, no esconderla.
- En el **Receptor** se lee de Configuración del proyecto > Propiedades del script > `FIREBASE_API_KEY`. `probarConfiguracion()` avisa si falta.

Restricción de la clave (Google Cloud > proyecto `ciad-blog-2026` > APIs y servicios > Credenciales > la clave del navegador):

1. **Restricciones de aplicaciones:** Sitios web (referentes HTTP) → `https://ciad-innovaedutec.blogspot.com/*`
2. **Restricciones de API:** Restringir clave → Identity Toolkit API, Token Service API (inicio de sesión), Cloud Firestore API (comentarios), Firebase Installations API y Firebase Management API (Analytics).
3. Guardar, esperar unos minutos y probar: iniciar sesión en el blog, comentar y enviar una solicitud de prueba. Si algo falla, la consola del navegador dice qué API falta; agrégala.

Las reglas de Firestore (consola de Firebase > Firestore > Reglas) son las que deciden quién lee y escribe los comentarios; revísalas si cambia el sistema de comentarios.
