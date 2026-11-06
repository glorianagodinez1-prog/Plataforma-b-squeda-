/* Recepción en vivo — lógica del navegador */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Normaliza para buscar sin importar mayúsculas ni tildes
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const time = (ts) => (ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '');
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  // ---------- Estado ----------
  let S = { columns: [], nameColumns: [], people: [], tables: [] };
  const byId = new Map();       // id -> persona
  const tableById = new Map();  // id -> mesa
  let filter = 'all';
  let selIndex = 0;
  let lastResults = [];
  const MAX_RESULTS = 150;

  const personName = (p) => {
    const n = S.nameColumns.map((c) => p.data[c]).filter(Boolean).join(' ');
    return n || Object.values(p.data).find(Boolean) || '(sin nombre)';
  };

  function indexPerson(p) {
    p._name = personName(p);
    p._search = norm(p._name + ' ' + Object.values(p.data).join(' '));
    byId.set(p.id, p);
  }

  function setState(st) {
    S = st;
    byId.clear();
    tableById.clear();
    S.people.forEach(indexPerson);
    S.tables.forEach((t) => tableById.set(t.id, t));
    renderAll();
  }

  // ---------- Usuario y conexión ----------
  let user = store.get('rv_user') || '';
  let clave = store.get('rv_clave') || '';

  function askUser() {
    const n = prompt('¿Cuál es tu nombre? (se mostrará quién marcó cada llegada)', user);
    if (n !== null && n.trim()) {
      user = n.trim().slice(0, 60);
      store.set('rv_user', user);
      if (socket) socket.emit('user', user);
    }
    $('#userBtn').textContent = user || 'Anónimo';
  }

  let socket;
  async function start() {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
    if (cfg.requiereClave && !clave) {
      clave = prompt('Clave de acceso:') || '';
      store.set('rv_clave', clave);
    }
    if (!user) askUser();
    $('#userBtn').textContent = user || 'Anónimo';

    socket = io({ auth: { user, clave } });
    socket.on('connect', () => $('#conn').classList.remove('off'));
    socket.on('disconnect', () => $('#conn').classList.add('off'));
    socket.on('connect_error', (err) => {
      $('#conn').classList.add('off');
      if (/clave/i.test(err.message)) {
        clave = prompt('Clave incorrecta. Escribe la clave de acceso:') || '';
        store.set('rv_clave', clave);
        socket.auth.clave = clave;
        socket.connect();
      }
    });
    socket.on('state', setState);
    socket.on('person', (p) => {
      const old = byId.get(p.id);
      if (old) {
        const i = S.people.indexOf(old);
        S.people[i] = p;
      } else {
        S.people.push(p);
      }
      indexPerson(p);
      renderAll(true);
    });
    socket.on('table', (t) => {
      const old = tableById.get(t.id);
      if (old) Object.assign(old, t);
      else { S.tables.push(t); tableById.set(t.id, t); }
      renderStats();
      renderPlano();
    });
    socket.on('online', (users) => {
      $('#onlineBtn').textContent = `${users.length} conectado${users.length === 1 ? '' : 's'}`;
      $('#onlineBtn').title = users.join(', ');
    });
  }

  const api = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-clave': clave },
      body: JSON.stringify(body || {}),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error');
      return j;
    });

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2500);
  }

  // ---------- Acciones ----------
  function toggleArrived(p) {
    const arrived = !p.arrived;
    socket.emit('checkin', { id: p.id, arrived });
    toast(arrived ? `✓ ${p._name} marcado como llegado` : `${p._name} desmarcado`);
  }
  const assign = (personId, tableId) => socket.emit('assign', { personId, tableId: tableId || null });

  // ---------- Render general ----------
  function renderAll(keepSel) {
    renderStats();
    renderResults(keepSel);
    renderPlano();
    renderAddForm();
  }

  function renderStats() {
    const total = S.people.length;
    const arrived = S.people.filter((p) => p.arrived).length;
    $('#stTotal').textContent = total;
    $('#stArrived').textContent = arrived;
    $('#stPending').textContent = total - arrived;
    $('#stBar').style.width = total ? (arrived / total) * 100 + '%' : 0;
  }

  // ---------- Recepción (búsqueda) ----------
  function highlight(text, terms) {
    let out = esc(text);
    if (!terms.length) return out;
    // resalta coincidencias respetando tildes del texto original
    const n = norm(text);
    const marks = new Array(text.length).fill(false);
    for (const t of terms) {
      let i = n.indexOf(t);
      while (t && i !== -1) {
        for (let k = i; k < i + t.length; k++) marks[k] = true;
        i = n.indexOf(t, i + t.length);
      }
    }
    if (n.length !== text.length) return out; // caso raro: no resaltar
    out = '';
    let open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !open) { out += '<mark>'; open = true; }
      if (!marks[i] && open) { out += '</mark>'; open = false; }
      out += esc(text[i]);
    }
    if (open) out += '</mark>';
    return out;
  }

  function search() {
    const q = norm($('#search').value.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    let list = S.people;
    if (filter === 'pending') list = list.filter((p) => !p.arrived);
    else if (filter === 'arrived') list = list.filter((p) => p.arrived);
    if (terms.length) {
      list = list.filter((p) => terms.every((t) => p._search.includes(t)));
      // primero los que empiezan con el término en el nombre
      const first = terms[0];
      list = list
        .map((p) => {
          const nn = norm(p._name);
          const score = nn.startsWith(first) ? 0 : nn.split(/\s+/).some((w) => w.startsWith(first)) ? 1 : nn.includes(first) ? 2 : 3;
          return [score, p];
        })
        .sort((a, b) => a[0] - b[0] || a[1]._name.localeCompare(b[1]._name, 'es'))
        .map((x) => x[1]);
    } else if (filter === 'arrived') {
      list = [...list].sort((a, b) => (b.arrivedAt || 0) - (a.arrivedAt || 0));
    } else {
      list = [...list].sort((a, b) => a._name.localeCompare(b._name, 'es'));
    }
    return { list, terms };
  }

  function renderResults(keepSel) {
    const { list, terms } = search();
    const prevId = lastResults[selIndex]?.id;
    lastResults = list.slice(0, MAX_RESULTS);
    if (keepSel && prevId) {
      const i = lastResults.findIndex((p) => p.id === prevId);
      selIndex = i >= 0 ? i : Math.min(selIndex, Math.max(0, lastResults.length - 1));
    } else if (!keepSel) {
      selIndex = 0;
    }

    const metaCols = S.columns.filter((c) => !S.nameColumns.includes(c)).slice(0, 4);
    $('#results').innerHTML = lastResults
      .map((p, i) => {
        const t = p.tableId && tableById.get(p.tableId);
        const meta = metaCols.map((c) => p.data[c]).filter(Boolean).join(' · ');
        return `<div class="person ${p.arrived ? 'arrived' : ''} ${i === selIndex ? 'sel' : ''}" data-id="${p.id}" data-i="${i}">
          <div class="info">
            <div class="name">${highlight(p._name, terms)}</div>
            <div class="meta">${highlight(meta, terms)}</div>
          </div>
          <span class="loc ${t ? '' : 'none'}" data-act="loc" title="Ver en el plano">${t ? '📍 ' + esc(t.name) : 'Sin ubicación'}</span>
          <button class="checkbtn ${p.arrived ? 'on' : ''}" data-act="check">
            ${p.arrived ? `✓ Llegó ${time(p.arrivedAt)}<small>por ${esc(p.arrivedBy || '')}</small>` : 'Marcar llegada'}
          </button>
        </div>`;
      })
      .join('') + (list.length > MAX_RESULTS ? `<div class="more">Mostrando ${MAX_RESULTS} de ${list.length}. Escribe más para afinar la búsqueda.</div>` : '');

    const empty = $('#emptyMsg');
    if (!S.people.length) {
      empty.innerHTML = 'Aún no hay personas. Ve a la pestaña <b>Datos</b> para importar tu Excel.';
      empty.classList.remove('hidden');
    } else if (!list.length) {
      empty.textContent = 'No se encontró a nadie con esa búsqueda.';
      empty.classList.remove('hidden');
    } else empty.classList.add('hidden');
  }

  function moveSel(d) {
    if (!lastResults.length) return;
    selIndex = Math.max(0, Math.min(lastResults.length - 1, selIndex + d));
    $$('#results .person').forEach((el) => el.classList.toggle('sel', +el.dataset.i === selIndex));
    $(`#results .person[data-i="${selIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  $('#search').addEventListener('input', () => renderResults(false));
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const p = lastResults[selIndex];
      if (p) {
        toggleArrived(p);
        e.target.select();
      }
    } else if (e.key === 'Escape') { e.target.value = ''; renderResults(false); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#modal').open) {
      e.preventDefault();
      showTab('recepcion');
      $('#search').focus();
    }
  });
  $$('.filters .chip').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      $$('.filters .chip').forEach((x) => x.classList.toggle('active', x === b));
      renderResults(false);
    })
  );
  $('#results').addEventListener('click', (e) => {
    const row = e.target.closest('.person');
    if (!row) return;
    const p = byId.get(row.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'check') toggleArrived(p);
    else if (act === 'loc' && p.tableId) { showTab('plano'); flashTable(p.tableId); }
    else openPerson(p);
  });

  // ---------- Detalle de persona ----------
  function openPerson(p) {
    const opts = ['<option value="">— Sin ubicación —</option>']
      .concat([...S.tables].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })).map((t) => {
        const n = S.people.filter((x) => x.tableId === t.id).length;
        return `<option value="${t.id}" ${t.id === p.tableId ? 'selected' : ''}>${esc(t.name)} (${n}/${t.capacity})</option>`;
      }))
      .join('');
    $('#modalBody').innerHTML = `
      <h2>${esc(p._name)}</h2>
      <dl>${S.columns.map((c) => `<dt>${esc(c)}</dt><dd>${esc(p.data[c] || '—')}</dd>`).join('')}</dl>
      <p>${p.arrived ? `✓ Llegó a las <b>${time(p.arrivedAt)}</b> — marcado por <b>${esc(p.arrivedBy || '')}</b>` : 'Aún no ha llegado.'}</p>
      <label>Ubicación<select id="mLoc">${opts}</select></label>
      <div class="modal-actions">
        <button class="btn" value="close">Cerrar</button>
        <button class="btn primary" id="mCheck" value="close">${p.arrived ? 'Desmarcar llegada' : 'Marcar llegada'}</button>
      </div>`;
    $('#mLoc').addEventListener('change', (e) => { assign(p.id, e.target.value); toast('Ubicación actualizada'); });
    $('#mCheck').addEventListener('click', () => toggleArrived(byId.get(p.id)));
    $('#modal').showModal();
  }

  // ---------- Plano de ubicaciones ----------
  const chip = (p) => `<div class="pchip ${p.arrived ? 'arrived' : ''}" draggable="true" data-id="${p.id}" title="${esc(p._name)}"><span>${esc(p._name)}</span></div>`;

  function renderPlano() {
    if (dragTable) return; // no redibujar mientras se arrastra una mesa
    const groups = new Map(S.tables.map((t) => [t.id, []]));
    const unassigned = [];
    for (const p of S.people) {
      if (p.tableId && groups.has(p.tableId)) groups.get(p.tableId).push(p);
      else unassigned.push(p);
    }
    const byName = (a, b) => a._name.localeCompare(b._name, 'es');

    // Sin ubicación
    const q = norm($('#sideSearch').value.trim());
    const side = unassigned.filter((p) => !q || p._search.includes(q)).sort(byName);
    $('#unassignedCount').textContent = unassigned.length;
    $('#unassigned').innerHTML = side.slice(0, 300).map(chip).join('') ||
      `<div class="hint small">${unassigned.length ? 'Sin coincidencias' : 'Todas las personas tienen ubicación 🎉'}</div>`;

    // Mesas
    let maxX = 0, maxY = 0;
    $('#canvas').innerHTML = S.tables
      .map((t) => {
        const ps = groups.get(t.id).sort(byName);
        const arr = ps.filter((p) => p.arrived).length;
        maxX = Math.max(maxX, t.x + 200);
        maxY = Math.max(maxY, t.y + 280);
        const cls = ps.length > t.capacity ? 'over' : ps.length && arr === ps.length ? 'full' : '';
        return `<div class="table droptarget ${cls}" data-table="${t.id}" style="left:${t.x}px;top:${t.y}px">
          <div class="thead" title="Doble clic para editar">
            <span class="tname">${esc(t.name)}</span>
            <span class="tcount" title="Llegaron / asignados / capacidad">${arr}/${ps.length}/${t.capacity}</span>
          </div>
          <div class="tbar"><div style="width:${ps.length ? (arr / ps.length) * 100 : 0}%"></div></div>
          <div class="tbody">${ps.map(chip).join('') || '<div class="emptyt">Vacía</div>'}</div>
        </div>`;
      })
      .join('') || '<div class="empty">No hay ubicaciones. Crea una con “+ Nueva ubicación” o importa un Excel con una columna de mesa/zona.</div>';
    $('#canvas').style.width = maxX + 'px';
    $('#canvas').style.height = maxY + 'px';
  }

  function flashTable(id) {
    renderPlano();
    const el = $(`.table[data-table="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 3300);
  }

  $('#sideSearch').addEventListener('input', renderPlano);

  // Arrastrar personas (HTML5 drag & drop)
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.pchip');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', (e) => {
    const t = e.target.closest?.('.droptarget');
    if (!t) return;
    e.preventDefault();
    $$('.dragover').forEach((x) => x !== t && x.classList.remove('dragover'));
    t.classList.add('dragover');
  });
  document.addEventListener('dragleave', (e) => {
    const t = e.target.closest?.('.droptarget');
    if (t && !t.contains(e.relatedTarget)) t.classList.remove('dragover');
  });
  document.addEventListener('drop', (e) => {
    const t = e.target.closest?.('.droptarget');
    $$('.dragover').forEach((x) => x.classList.remove('dragover'));
    if (!t) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const p = byId.get(id);
    if (!p) return;
    const tableId = t.dataset.table || null;
    if ((p.tableId || null) === tableId) return;
    const table = tableId && tableById.get(tableId);
    if (table) {
      const n = S.people.filter((x) => x.tableId === tableId).length;
      if (n >= table.capacity && !confirm(`"${table.name}" ya está llena (${n}/${table.capacity}). ¿Agregar de todos modos?`)) return;
    }
    assign(id, tableId);
  });

  // Clic en una persona del plano abre su detalle
  $('#tab-plano').addEventListener('click', (e) => {
    const c = e.target.closest('.pchip');
    if (c) openPerson(byId.get(c.dataset.id));
  });

  // Mover mesas arrastrando el título (funciona con mouse y táctil)
  let dragTable = null;
  $('#canvas').addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.thead');
    if (!head) return;
    const el = head.parentElement;
    const t = tableById.get(el.dataset.table);
    dragTable = { el, t, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
    head.setPointerCapture(e.pointerId);
  });
  $('#canvas').addEventListener('pointermove', (e) => {
    if (!dragTable) return;
    const d = dragTable;
    const nx = Math.max(0, Math.round((d.ox + e.clientX - d.sx) / 10) * 10);
    const ny = Math.max(0, Math.round((d.oy + e.clientY - d.sy) / 10) * 10);
    if (nx !== d.t.x || ny !== d.t.y) {
      d.moved = true;
      d.t.x = nx; d.t.y = ny;
      d.el.style.left = nx + 'px';
      d.el.style.top = ny + 'px';
    }
  });
  const endDrag = () => {
    if (!dragTable) return;
    const { t, moved } = dragTable;
    dragTable = null;
    if (moved) socket.emit('table:update', { id: t.id, x: t.x, y: t.y });
    renderPlano();
  };
  $('#canvas').addEventListener('pointerup', endDrag);
  $('#canvas').addEventListener('pointercancel', endDrag);
  $('#canvas').addEventListener('dblclick', (e) => {
    const head = e.target.closest('.thead');
    if (head) editTable(tableById.get(head.parentElement.dataset.table));
  });

  function editTable(t) {
    const isNew = !t;
    $('#modalBody').innerHTML = `
      <h2>${isNew ? 'Nueva ubicación' : 'Editar ubicación'}</h2>
      <label>Nombre (mesa, zona, sección…)<input id="tName" value="${esc(t?.name || `Mesa ${S.tables.length + 1}`)}" maxlength="60" /></label>
      <label>Capacidad<input id="tCap" type="number" min="1" max="500" value="${t?.capacity || 10}" /></label>
      <div class="modal-actions">
        ${isNew ? '' : '<button class="btn dangerbtn" id="tDel" value="close">Eliminar</button>'}
        <button class="btn" value="close">Cancelar</button>
        <button class="btn primary" id="tSave" value="close">Guardar</button>
      </div>`;
    $('#tSave').addEventListener('click', () => {
      const name = $('#tName').value, capacity = $('#tCap').value;
      if (isNew) {
        const wrap = $('#canvasWrap');
        socket.emit('table:create', { name, capacity, x: Math.round((wrap.scrollLeft + 40) / 10) * 10, y: Math.round((wrap.scrollTop + 40) / 10) * 10 });
      } else socket.emit('table:update', { id: t.id, name, capacity });
    });
    $('#tDel')?.addEventListener('click', (e) => {
      if (!confirm(`¿Eliminar "${t.name}"? Las personas quedarán sin ubicación.`)) e.preventDefault();
      else socket.emit('table:delete', { id: t.id });
    });
    $('#modal').showModal();
    $('#tName').select();
  }

  $('#addTable').addEventListener('click', () => editTable(null));
  $('#autoLayout').addEventListener('click', () => {
    if (!confirm('¿Ordenar todas las ubicaciones en cuadrícula?')) return;
    const cols = Math.max(1, Math.floor(($('#canvasWrap').clientWidth - 40) / 190));
    [...S.tables]
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
      .forEach((t, i) => {
        t.x = 20 + (i % cols) * 190;
        t.y = 20 + Math.floor(i / cols) * 290;
        socket.emit('table:update', { id: t.id, x: t.x, y: t.y });
      });
    renderPlano();
  });

  // ---------- Pestañas ----------
  function showTab(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    store.set('rv_tab', name);
    if (name === 'recepcion') $('#search').focus();
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#userBtn').addEventListener('click', askUser);
  $('#onlineBtn').addEventListener('click', () => toast('Conectados: ' + ($('#onlineBtn').title || '—')));

  // ---------- Importar Excel ----------
  let wb = null, impCols = [], impRows = [];

  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      $('#impSheet').innerHTML = wb.SheetNames.map((n) => `<option>${esc(n)}</option>`).join('');
      loadSheet();
      $('#importCfg').classList.remove('hidden');
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  });
  $('#impSheet').addEventListener('change', loadSheet);

  function loadSheet() {
    const ws = wb.Sheets[$('#impSheet').value];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const header = (rows[0] || []).map((h, i) => String(h).trim() || `Columna ${i + 1}`);
    // evitar títulos repetidos
    const seen = {};
    impCols = header.map((h) => (seen[h] = (seen[h] || 0) + 1) > 1 ? `${h} (${seen[h]})` : h);
    impRows = rows.slice(1).map((r) => Object.fromEntries(impCols.map((c, i) => [c, r[i] ?? ''])))
      .filter((r) => Object.values(r).some((v) => String(v).trim()));
    $('#impRows').textContent = impRows.length;

    const nameGuess = impCols.filter((c) => /nombre|name|apellido|invitad|participante/i.test(c));
    const locGuess = impCols.find((c) => /mesa|table|ubicaci|zona|secci|asiento|lugar|sala|grupo/i.test(c)) || '';
    $('#impName').innerHTML = impCols.map((c, i) =>
      `<option value="${esc(c)}" ${(nameGuess.length ? nameGuess.includes(c) : i === 0) ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#impLoc').innerHTML = '<option value="">— Ninguna —</option>' + impCols.map((c) =>
      `<option value="${esc(c)}" ${c === locGuess ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#impPreview').innerHTML = `<table><tr>${impCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${impRows.slice(0, 5)
      .map((r) => `<tr>${impCols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  $('#impGo').addEventListener('click', async () => {
    const mode = $('input[name=impMode]:checked').value;
    if (mode === 'replace' && S.people.length &&
      !confirm(`Esto reemplazará las ${S.people.length} personas actuales (y sus marcas) para todos. ¿Continuar?`)) return;
    try {
      const r = await api('/api/import', {
        columns: impCols,
        rows: impRows,
        nameColumns: $$('#impName option:checked').map((o) => o.value),
        locationColumn: $('#impLoc').value,
        mode,
      });
      toast(`Importadas ${r.added} personas`);
      $('#file').value = '';
      $('#importCfg').classList.add('hidden');
      showTab('recepcion');
    } catch (err) {
      alert('Error al importar: ' + err.message);
    }
  });

  // ---------- Exportar ----------
  $('#exportBtn').addEventListener('click', () => {
    const rows = S.people.map((p) => ({
      ...p.data,
      'Llegó': p.arrived ? 'Sí' : 'No',
      'Hora de llegada': p.arrivedAt ? new Date(p.arrivedAt).toLocaleString('es') : '',
      'Marcado por': p.arrivedBy || '',
      'Ubicación asignada': tableById.get(p.tableId)?.name || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Recepción');
    XLSX.writeFile(book, `recepcion_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  // ---------- Agregar persona manual ----------
  let addFormCols = '';
  function renderAddForm() {
    const cols = S.columns.length ? S.columns : ['Nombre'];
    const key = cols.join('|');
    if (key === addFormCols) return;
    addFormCols = key;
    $('#addForm').innerHTML = cols.slice(0, 12).map((c) =>
      `<label>${esc(c)}<input type="text" name="${esc(c)}" /></label>`).join('') +
      '<button class="btn primary">Agregar</button>';
  }
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!Object.values(data).some((v) => v.trim())) return;
    socket.emit('person:add', { data });
    e.target.reset();
    toast('Persona agregada');
  });

  // ---------- Borrar todo ----------
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('¿Seguro? Se borrarán TODAS las personas y ubicaciones para todos los usuarios.')) return;
    if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
    try { await api('/api/reset'); toast('Datos borrados'); } catch (err) { alert(err.message); }
  });

  // ---------- Inicio ----------
  showTab(store.get('rv_tab') || 'recepcion');
  start();
})();
