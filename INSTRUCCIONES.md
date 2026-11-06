# Poner la plataforma en internet (sin cuentas para tu equipo)

Solo tú haces esto **una vez** (unos 10 minutos). Tu equipo después solo abre un enlace, escribe su nombre y empieza a marcar. Nadie más necesita crear cuentas ni instalar nada.

Todo es gratis:
- **Firebase** (de Google) guarda la lista y la comparte en tiempo real.
- **GitHub Pages** publica la página.

---

## Paso 1. Crear la base de datos en Firebase

1. Entra a <https://console.firebase.google.com> con tu cuenta de Gmail.
2. Toca **Crear un proyecto** (o "Agregar proyecto"). Ponle un nombre, por ejemplo `recepcion-evento`. Puedes desactivar Google Analytics; no hace falta.
3. En el menú de la izquierda entra a **Compilación → Firestore Database** y toca **Crear base de datos**.
   - Ubicación: la que te sugiera (o la más cercana a tu país).
   - Modo: **producción**.
4. Cuando se cree, ve a la pestaña **Reglas**. Borra lo que hay, pega el contenido del archivo [`docs/firestore.rules`](docs/firestore.rules) y toca **Publicar**.

## Paso 2. Copiar la configuración

1. Toca el engranaje ⚙️ (arriba a la izquierda) → **Configuración del proyecto**.
2. Abajo, en "Tus apps", toca el ícono **`</>`** (Web). Ponle un nombre cualquiera y toca **Registrar app**. No marques Firebase Hosting.
3. Te mostrará un bloque así:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "recepcion-evento.firebaseapp.com",
     projectId: "recepcion-evento",
     ...
   };
   ```

4. **Copia ese bloque y pégamelo en el chat**, y yo lo pongo en su lugar.
   Si prefieres hacerlo tú: abre [`docs/config.js`](docs/config.js) en GitHub, toca el lápiz ✏️ y reemplaza `export const firebaseConfig = null;` por `export const firebaseConfig = { ...lo que copiaste... };`. Guarda con **Commit changes**.

Estos datos no son secretos: solo identifican tu proyecto.

## Paso 3. Publicar la página con GitHub Pages

1. En GitHub, abre tu repositorio → **Settings** → **Pages**.
2. En "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **`claude/plataforma-gestion-personas-pqebie`**, carpeta **`/docs`** → **Save**.
3. Espera 1 o 2 minutos. Tu página quedará en:
   **<https://glorianagodinez1-prog.github.io/Plataforma-b-squeda-/>**

> En la cuenta gratuita de GitHub, Pages solo funciona si el repositorio es **público**. Eso solo deja ver el código de la página. La lista de personas **no** queda pública: vive en Firebase y solo se abre con el enlace secreto del evento.

## Paso 4. Usarla el día del evento

1. Abre la página y toca **Crear evento nuevo**. Se crea un enlace único (termina en `#` y unas letras).
2. Ve a **Datos** y sube tu Excel.
3. Toca **Compartir enlace** y envíalo por WhatsApp o correo a tu equipo.
4. Cada persona abre el enlace, escribe su nombre una vez y ya puede buscar y marcar llegadas. Todos ven los cambios al instante.

---

### Bueno saber

- **Quien tenga el enlace puede ver y editar la lista.** Compártelo solo con tu equipo. Si se filtra, crea un evento nuevo y vuelve a subir el Excel.
- El plan gratis de Firebase alcanza de sobra para un evento normal (miles de personas y decenas de recepcionistas).
- Después del evento, en **Datos → Descargar Excel** bajas la lista con la hora de llegada y quién marcó a cada persona.
