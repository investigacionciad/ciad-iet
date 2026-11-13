# Credenciales del sistema · Blog del CIAD (plantilla)

Esta plantilla sí está en el repositorio, pero sin valores. Para usarla:

1. Cópiala: `cp CREDENCIALES.ejemplo.md CREDENCIALES.md`
2. Pide los valores a la cuenta del CIAD y llénalos en `CREDENCIALES.md`.
3. `CREDENCIALES.md` está en `.gitignore` y no se sube. No guardes contraseñas en él.

En el README, cada dato aparece como `<NOMBRE>`.

## Cuenta principal

| Clave | Valor | Para qué |
|---|---|---|
| `CUENTA_CIAD` | | Dueña de todo. Se usa en `clasp login`. |

## Apps Script (clasp)

| Clave | Valor | Para qué |
|---|---|---|
| `PUBLICADOR_SCRIPT_ID` | | Conectar `publicador-ciad/` con su proyecto (`.clasp.json`). |
| `PUBLICADOR_ID_IMPLEMENTACION` | | `clasp deploy -i` del Panel CIAD. |
| `RECEPTOR_SCRIPT_ID` | | Conectar `receptor/` con su proyecto (`.clasp.json`). |
| `RECEPTOR_ID_IMPLEMENTACION` | | `clasp deploy -i` del Receptor. |

## Firebase

| Clave | Valor | Para qué |
|---|---|---|
| `FIREBASE_API_KEY` |  | Clave web. Va en el tema de Blogger (`firebaseConfig.apiKey`) y en las Propiedades del script del Receptor. Está restringida al blog en Google Cloud. |

## Miembros del Panel CIAD

La lista que manda es la de Panel CIAD > Usuarios; esta es solo una copia.

| Nombre | Correo | Administrador | Avisos |
|---|---|---|---|
| | | | |
