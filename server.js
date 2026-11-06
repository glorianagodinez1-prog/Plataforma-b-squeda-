// Plataforma de recepción de personas en tiempo real
// Servidor: Express (archivos y API) + Socket.IO (sincronización en vivo)

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const CLAVE = process.env.CLAVE_ACCESO || ''; // opcional: si se define, se pide para entrar
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- Persistencia (archivo JSON) ----------

function emptyState() {
  return { columns: [], nameColumns: [], people: [], tables: [], updatedAt: Date.now() };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

let state = loadState();
let saveTimer = null;

function scheduleSave() {
  state.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE); // escritura atómica
}

const newId = () => crypto.randomUUID();
const findPerson = (id) => state.people.find((p) => p.id === id);
const findTable = (id) => state.tables.find((t) => t.id === id);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- Servidor HTTP ----------

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/xlsx/dist')));

function checkClave(req, res, next) {
  if (!CLAVE || req.get('x-clave') === CLAVE) return next();
  res.status(401).json({ error: 'Clave incorrecta' });
}

app.get('/api/config', (req, res) => res.json({ requiereClave: Boolean(CLAVE) }));

app.get('/api/state', checkClave, (req, res) => res.json(state));

// Importar personas desde Excel (el navegador lee el archivo y envía las filas)
app.post('/api/import', checkClave, (req, res) => {
  const { columns, rows, nameColumns, locationColumn, mode } = req.body || {};
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  if (mode !== 'add') {
    state = emptyState();
  }

  const cols = columns.map((c) => str(c, 100)).filter(Boolean);
  state.columns = Array.from(new Set([...state.columns, ...cols]));
  state.nameColumns = (Array.isArray(nameColumns) ? nameColumns : []).filter((c) => cols.includes(c));
  if (!state.nameColumns.length && cols.length) state.nameColumns = [cols[0]];

  // Crear ubicaciones (mesas/zonas) automáticamente desde la columna elegida
  const tableByName = new Map(state.tables.map((t) => [t.name.toLowerCase(), t]));
  const getTable = (name) => {
    const key = name.toLowerCase();
    if (!tableByName.has(key)) {
      const i = state.tables.length;
      const t = { id: newId(), name, capacity: 10, x: 40 + (i % 6) * 190, y: 40 + Math.floor(i / 6) * 290 };
      state.tables.push(t);
      tableByName.set(key, t);
    }
    return tableByName.get(key);
  };

  let added = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const data = {};
    for (const c of cols) data[c] = str(row[c], 500);
    if (!Object.values(data).some(Boolean)) continue; // fila vacía
    let tableId = null;
    if (locationColumn && data[locationColumn]) tableId = getTable(data[locationColumn]).id;
    state.people.push({ id: newId(), data, arrived: false, arrivedAt: null, arrivedBy: null, tableId });
    added++;
  }

  // Ajustar capacidad para que quepan todos los asignados
  for (const t of state.tables) {
    const n = state.people.filter((p) => p.tableId === t.id).length;
    if (n > t.capacity) t.capacity = n;
  }

  saveNow();
  io.emit('state', state);
  res.json({ ok: true, added, total: state.people.length });
});

app.post('/api/reset', checkClave, (req, res) => {
  state = emptyState();
  saveNow();
  io.emit('state', state);
  res.json({ ok: true });
});

// ---------- Tiempo real ----------

const server = http.createServer(app);
const io = new Server(server);

io.use((socket, next) => {
  if (!CLAVE || socket.handshake.auth?.clave === CLAVE) return next();
  next(new Error('Clave incorrecta'));
});

function broadcastOnline() {
  const users = [];
  for (const s of io.sockets.sockets.values()) users.push(s.data.user || 'Anónimo');
  io.emit('online', users);
}

io.on('connection', (socket) => {
  socket.data.user = str(socket.handshake.auth?.user, 60) || 'Anónimo';
  socket.emit('state', state);
  broadcastOnline();

  socket.on('user', (name) => {
    socket.data.user = str(name, 60) || 'Anónimo';
    broadcastOnline();
  });

  // Marcar / desmarcar llegada
  socket.on('checkin', ({ id, arrived } = {}) => {
    const p = findPerson(id);
    if (!p) return;
    p.arrived = Boolean(arrived);
    p.arrivedAt = p.arrived ? Date.now() : null;
    p.arrivedBy = p.arrived ? socket.data.user : null;
    scheduleSave();
    io.emit('person', p);
  });

  // Asignar persona a una ubicación (o null para quitarla)
  socket.on('assign', ({ personId, tableId } = {}) => {
    const p = findPerson(personId);
    if (!p) return;
    p.tableId = tableId && findTable(tableId) ? tableId : null;
    scheduleSave();
    io.emit('person', p);
  });

  // Agregar persona manualmente
  socket.on('person:add', ({ data } = {}) => {
    if (!data || typeof data !== 'object') return;
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      const key = str(k, 100);
      if (!key) continue;
      clean[key] = str(v, 500);
      if (!state.columns.includes(key)) state.columns.push(key);
    }
    if (!state.nameColumns.length) state.nameColumns = [Object.keys(clean)[0]].filter(Boolean);
    const p = { id: newId(), data: clean, arrived: false, arrivedAt: null, arrivedBy: null, tableId: null };
    state.people.push(p);
    scheduleSave();
    io.emit('state', state);
  });

  socket.on('table:create', ({ name, capacity, x, y } = {}) => {
    const t = {
      id: newId(),
      name: str(name, 60) || `Mesa ${state.tables.length + 1}`,
      capacity: Math.max(1, Math.min(500, parseInt(capacity, 10) || 10)),
      x: Number(x) || 40,
      y: Number(y) || 40,
    };
    state.tables.push(t);
    scheduleSave();
    io.emit('table', t);
  });

  socket.on('table:update', ({ id, name, capacity, x, y } = {}) => {
    const t = findTable(id);
    if (!t) return;
    if (name !== undefined) t.name = str(name, 60) || t.name;
    if (capacity !== undefined) t.capacity = Math.max(1, Math.min(500, parseInt(capacity, 10) || t.capacity));
    if (x !== undefined) t.x = Math.max(0, Number(x) || 0);
    if (y !== undefined) t.y = Math.max(0, Number(y) || 0);
    scheduleSave();
    socket.broadcast.emit('table', t);
    if (name !== undefined || capacity !== undefined) socket.emit('table', t);
  });

  socket.on('table:delete', ({ id } = {}) => {
    if (!findTable(id)) return;
    state.tables = state.tables.filter((t) => t.id !== id);
    for (const p of state.people) if (p.tableId === id) p.tableId = null;
    scheduleSave();
    io.emit('state', state);
  });

  socket.on('disconnect', broadcastOnline);
});

function shutdown() {
  try { saveNow(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Plataforma lista en http://localhost:${PORT}`);
  if (CLAVE) console.log('Acceso protegido con CLAVE_ACCESO');
});
