# Recepción en vivo

Plataforma web para recibir personas a partir de tu base de datos en Excel.

- **Importar Excel** (`.xlsx`, `.xls`, `.csv`, `.ods`): eliges qué columna(s) son el nombre y, si quieres, cuál es la ubicación (mesa, zona, sección…).
- **Búsqueda instantánea** por cualquier dato (nombre, documento, teléfono…), sin importar mayúsculas ni tildes.
- **Marcar llegada en tiempo real**: cuando alguien marca a una persona, todos los que tienen la página abierta lo ven al instante, con la hora y quién la marcó.
- **Pestaña Ubicaciones**: plano con mesas/zonas que puedes mover, y arrastrar personas de una a otra. Cada mesa muestra *llegaron / asignados / capacidad*.
- **Exportar** a Excel con el estado de llegada y la ubicación asignada.

## Cómo usarla

Necesitas [Node.js](https://nodejs.org) 18 o más reciente.

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Las otras personas de la misma red abren `http://IP-DE-TU-COMPUTADORA:3000`.

1. Ve a **Datos** → sube tu Excel (la primera fila deben ser los títulos). Hay un archivo de prueba en `ejemplo/invitados_ejemplo.xlsx`.
2. En **Recepción** escribe un nombre y presiona **Enter** para marcar la llegada de la persona resaltada (↑/↓ para moverte, `/` para volver al buscador, `Esc` para limpiar).
3. En **Ubicaciones** acomoda las mesas arrastrando su título; doble clic en el título para renombrar, cambiar capacidad o eliminar. Arrastra personas entre mesas. En celular, toca a la persona y elige su ubicación en la lista.

## Configuración opcional

| Variable        | Uso                                                               |
|-----------------|-------------------------------------------------------------------|
| `PORT`          | Puerto (por defecto `3000`).                                      |
| `CLAVE_ACCESO`  | Si se define, se pide esta clave para entrar. Recomendado si se publica en internet, porque la lista tiene datos personales. |
| `DATA_DIR`      | Carpeta donde se guardan los datos (por defecto `./data`).        |

Ejemplo: `CLAVE_ACCESO=evento2026 npm start`

Los datos se guardan en `data/db.json`, así que no se pierden si se reinicia el servidor.

## Publicarla en internet

Funciona en cualquier servicio que ejecute Node.js con WebSockets (Render, Railway, Fly.io, un VPS…). Usa `npm start` como comando y define `CLAVE_ACCESO`. Si el servicio borra el disco al reiniciar, configura un disco persistente y apunta `DATA_DIR` a él.
