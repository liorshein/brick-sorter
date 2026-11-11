'use strict';
/* Brick Sorter: photo -> find pieces (brickscope detection, MIT) -> Brickognize -> review -> Rebrickable lists. */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- settings ---------- */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('bs:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bs:' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
let cfg = store.get('cfg', { key: '', token: '' });

/* scan history (IndexedDB, on this phone only) */
const idb = (() => {
  let dbp = null;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('brick-sorter', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('scans', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('scans', mode); const req = fn(t.objectStore('scans'));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return { put: v => tx('readwrite', st => st.put(v)), get: id => tx('readonly', st => st.get(id)),
    all: () => tx('readonly', st => st.getAll()), del: id => tx('readwrite', st => st.delete(id)) };
})();
const KEEP_SCANS = 40;
const saveCfg = () => store.set('cfg', cfg);

/* ---------- storage rules (same as the sorting map) ---------- */
const SPOTS = {
  bricks: 'Bricks (drawer)', plates: 'Plates (drawer)', tiles: 'Tiles (drawer)',
  slopes: 'Slopes / Wedges (drawer)', technic: 'Technic & Misc (drawer)', round: 'Round & SNOT (drawer)',
  trans: 'Transparent (box)', minifigs: 'Minifigs (box)', acc: 'Minifig accessories (box)',
  identify: 'To identify (box)', plants: 'Plants & animals (box)', wheels: 'Wheels & tires (box)',
  doors: 'Doors, windows & fences (box)', bars: 'Bars, handles & ladders (box)', arches: 'Arches & curves (box)',
  modplates: 'Modified plates (box)', modbricks: 'Modified bricks (box)', overflow: 'Overflow & large (bin)',
};
const ORDER = Object.keys(SPOTS);
const M = ['technic', 'Misc'], TP = ['technic', 'Pins, axles & beams'];
const CAT = {1:['overflow'],3:['slopes','Slopes'],4:['overflow'],5:'bs',6:['slopes','Slopes'],7:M,8:TP,9:'ps',11:'b',12:TP,13:['minifigs'],14:'p',15:'t',16:['doors'],17:M,18:['round','Brackets, clips & hinges'],19:['tiles','Square & rectangle'],20:['round','Round, cones & dishes'],21:['round','Round, cones & dishes'],22:M,23:M,24:M,25:M,26:M,27:['acc'],28:['plants'],29:['wheels'],30:M,31:M,32:'bar',33:M,34:M,35:['overflow'],36:['overflow'],37:'cv',38:M,39:M,40:M,41:['overflow'],42:M,43:M,44:M,45:['overflow'],46:TP,47:['doors'],48:M,49:['slopes','Wedge plates'],50:M,51:TP,52:M,53:TP,54:TP,55:TP,56:M,57:['overflow'],58:M,67:['tiles','Round & curved'],68:['acc'],69:['acc'],73:['acc'],74:['plants'],75:['plants'],76:['plants'],77:M,78:M};
const MINI = new Set([13,59,60,61,62,63,64,65,70,71,72]);
const size = n => { const m = n.match(/(\d+) x (\d+)/); if (!m) return null; const a = Math.min(+m[1], +m[2]); return a === 1 ? '1×N' : a === 2 ? '2×N' : 'Large'; };
function spotFor(num, name, cat) {
  const n = name.toLowerCase();
  if (MINI.has(cat)) return ['minifigs'];
  if ((/ print\b|pattern/.test(n) || /(pr|pat)\d/.test(num)) && cat !== 58) return ['identify'];
  if (/^bracket/.test(n)) return ['round', 'Brackets, clips & hinges'];
  const r = CAT[cat]; if (!r) return M;
  if (r === 'b') return ['bricks', size(name)];
  if (r === 'p') return ['plates', size(name)];
  if (r === 't') return ['tiles', /round|curved|quarter|macaroni/.test(n) ? 'Round & curved' : 'Square & rectangle'];
  if (r === 'bs') return /studs? on|headlight|side/.test(n) ? ['round', 'Brackets, clips & hinges'] : ['modbricks'];
  if (r === 'ps') return ['modplates'];
  if (r === 'cv') return /^slope/.test(n) ? ['slopes', 'Curved'] : ['arches'];
  if (r === 'bar') return /fence|railing/.test(n) ? ['doors'] : ['bars'];
  return r;
}
const spotOf = (p, c) => c?.is_trans ? ['trans', null] : spotFor(p.part_num, p.name, p.part_cat_id);
// Physical places (Rebrickable list names above stay as they are).
const TOWER = ['bricks', 'plates', 'tiles', 'slopes', 'technic', 'round'];
const SHORT = { bricks: 'Bricks', plates: 'Plates', tiles: 'Tiles', slopes: 'Slopes / Wedges', technic: 'Technic & Misc', round: 'Round & SNOT',
  trans: 'Transparent', minifigs: 'Minifigs', acc: 'Minifig accessories', identify: 'To identify', plants: 'Plants & animals', wheels: 'Wheels & tires',
  doors: 'Doors, windows & fences', bars: 'Bars, handles & ladders', arches: 'Arches & curves', modplates: 'Modified plates', modbricks: 'Modified bricks', overflow: 'Large parts' };
function placeOf(k) {
  const i = TOWER.indexOf(k);
  if (i >= 0) return `Drawer ${i + 1} · ${SHORT[k]}`;
  if (k === 'overflow') return 'Classic 10695 box · Large parts';
  return `12-slot box · ${SHORT[k]}`;
}
const spotText = s => placeOf(s[0]) + (s[1] ? ' › ' + s[1] : '');

/* ---------- Rebrickable (rate limited to ~1 call/s) ---------- */
const RB = 'https://rebrickable.com/api/v3';
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
let rbChain = Promise.resolve(), rbLast = 0;
function rb(path, { method = 'GET', form, key = cfg.key } = {}) {
  const run = async () => {
    const wait = rbLast + 1100 - Date.now(); if (wait > 0) await sleep(wait);
    rbLast = Date.now();
    const res = await fetch(path.startsWith('http') ? path : RB + path, {
      method, headers: { Authorization: 'key ' + key, Accept: 'application/json' },
      body: form ? new URLSearchParams(form) : undefined,
    });
    if (res.status === 429) { rbLast = Date.now() + 4000; throw new HttpError(429, 'Rebrickable is busy, try again in a moment'); }
    if (!res.ok) throw new HttpError(res.status, `Rebrickable ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.status === 204 ? null : res.json();
  };
  const p = rbChain.then(run, run);
  rbChain = p.catch(() => {});
  return p;
}
const partCache = store.get('parts', {});
const savePartCache = () => store.set('parts', partCache);
async function getPart(num) {
  const k = String(num).trim().toLowerCase();
  if (k in partCache) return partCache[k];
  let p = null;
  try { const d = await rb(`/lego/parts/${encodeURIComponent(num)}/`); p = { part_num: d.part_num, name: d.name, part_cat_id: d.part_cat_id, img: d.part_img_url }; }
  catch (e) { if (e.status !== 404) throw e; }
  partCache[k] = p; savePartCache(); return p;
}
async function partFromBL(bl) {
  const k = 'bl:' + bl;
  if (k in partCache) return partCache[k];
  const d = await rb(`/lego/parts/?bricklink_id=${encodeURIComponent(bl)}&page_size=10`);
  let x = d.results.find(r => r.part_num === bl) || d.results[0];
  let p = x ? { part_num: x.part_num, name: x.name, part_cat_id: x.part_cat_id, img: x.part_img_url } : await getPart(bl);
  partCache[k] = p; savePartCache(); return p;
}
let COL = null;
async function colors() {
  if (COL) return COL;
  let list = store.get('colors');
  const age = store.get('colorsAt', 0);
  if (!list || Date.now() - age > 30 * 864e5) {
    const d = await rb('/lego/colors/?page_size=1000');
    list = d.results.map(c => ({ id: c.id, name: c.name, rgb: c.rgb, is_trans: c.is_trans, bl: c.external_ids?.BrickLink?.ext_ids ?? [] }));
    store.set('colors', list); store.set('colorsAt', Date.now());
  }
  list = list.filter(c => c.id >= 0 && c.id !== 9999 && !/^Modulex/.test(c.name));
  COL = { list: [...list].sort((a, b) => a.name.localeCompare(b.name)), byId: new Map(), byBL: new Map(), byName: new Map() };
  for (const c of list) { COL.byId.set(c.id, c); COL.byName.set(c.name.toLowerCase(), c); for (const b of c.bl) COL.byBL.set(String(b), c); }
  return COL;
}
async function myLists() {
  const out = []; let url = `/users/${cfg.token}/partlists/?page_size=1000`;
  while (url) { const d = await rb(url); out.push(...d.results); url = d.next; }
  return out;
}
async function addToList(list, part, color, qty) {
  const base = `/users/${cfg.token}/partlists/${list.id}/parts/`;
  try { await rb(base, { method: 'POST', form: { part_num: part, color_id: color, quantity: qty } }); return qty; }
  catch (e) {
    if (e.status !== 400) throw e;
    const item = `${base}${encodeURIComponent(part)}/${color}/`;
    const cur = await rb(item); const total = Number(cur.quantity) + Number(qty);
    await rb(item, { method: 'PUT', form: { quantity: total } }); return total;
  }
}

/* ---------- Brickognize ---------- */
async function brickognize(blob, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const form = new FormData(); form.append('query_image', blob, 'crop.jpg');
    const res = await fetch('https://api.brickognize.com/predict/parts/?predict_color=true', { method: 'POST', body: form });
    if (res.status === 429 || res.status >= 500) { await sleep((Number(res.headers.get('retry-after')) || 3 + i * 3) * 1000); continue; }
    if (!res.ok) throw new Error('Brickognize ' + res.status);
    return res.json();
  }
  throw new Error('Brickognize is busy; try again in a minute');
}

/* ---------- views ---------- */
const views = ['vSettings', 'vScan', 'vReview', 'vSummary', 'vHistory'];
function show(v) { views.forEach(x => $(x).hidden = x !== v); window.scrollTo(0, 0); if (v === 'vScan') checkResume(); }
const accepted = sc => sc.pieces.filter(p => p.state === 'ok').reduce((n, p) => n + p.qty, 0);
async function checkResume() {
  const box = $('resume'); box.hidden = true;
  const all = (await idb.all().catch(() => [])).filter(sc => !sc.added && sc.pieces?.length).sort((a, b) => b.at - a.at);
  if (!all.length) return;
  const sc = all[0];
  $('resumeText').textContent = `${all.length === 1 ? 'A scan' : all.length + ' scans'} not added to Rebrickable yet. Latest: ${new Date(sc.at).toLocaleString()}, ${sc.pieces.length} pieces, ${accepted(sc)} accepted.`;
  $('resumeOpen').onclick = () => openScan(sc.id);
  box.hidden = false;
}
async function openScan(id) {
  const sc = await idb.get(id); if (!sc) return;
  await colors().catch(() => {});
  const img = new Image(); img.src = sc.photo; await img.decode().catch(() => {});
  pieces = sc.pieces; nextId = sc.nextId || pieces.length + 1;
  const { pieces: _p, nextId: _n, ...meta } = sc; scanMeta = meta;
  lastScan = { src: img, rects: sc.rects, tips: sc.tips };
  renderReview(); show('vReview');
}
async function showHistory() {
  saveScan(true);
  const all = (await idb.all().catch(() => [])).sort((a, b) => b.at - a.at);
  $('histList').innerHTML = all.length ? all.map(sc => `<div class="hist" data-id="${esc(sc.id)}">
      <img src="${sc.photo}" alt="">
      <div><b>${esc(new Date(sc.at).toLocaleString())}</b>
        <div class="muted">${sc.pieces.length} pieces · ${accepted(sc)} accepted</div>
        <span class="pill ${sc.added ? 'good' : ''}">${sc.added ? 'Added to Rebrickable' : 'Not added yet'}</span>
        <div class="acts"><button type="button" data-a="open">Open</button><button type="button" data-a="del">Delete</button></div></div></div>`).join('')
    : '<p class="muted">No scans yet. Every scan is saved here automatically.</p>';
  show('vHistory');
}
$('navHistory').onclick = showHistory;
$('histList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  if (b.dataset.a === 'open') return openScan(id);
  if (b.dataset.a === 'del' && confirm('Delete this scan from history? Anything already added stays in Rebrickable.')) {
    await idb.del(id).catch(() => {}); if (scanMeta?.id === id) resetScan(); showHistory();
  }
});
$('histBack').onclick = () => show(pieces.length ? 'vReview' : 'vScan');
$('navSettings').onclick = () => { fillSettings(); show('vSettings'); };
$('sDone').onclick = () => show(cfg.key && cfg.token ? (pieces.length ? 'vReview' : 'vScan') : 'vSettings');

function fillSettings() {
  $('sKey').value = cfg.key || '';
  $('sKeyMsg').textContent = cfg.key ? 'Key saved.' : '';
  $('sLoginMsg').textContent = cfg.token ? 'Signed in.' : '';
}
$('sKeySave').onclick = async () => {
  const k = $('sKey').value.trim(); const m = $('sKeyMsg');
  if (!k) { m.textContent = 'Paste your key first.'; return; }
  m.innerHTML = '<span class="spin"></span>Testing…';
  try { await rb('/lego/parts/3023/', { key: k }); cfg.key = k; saveCfg(); m.innerHTML = '<span class="ok-t">Key works.</span>'; }
  catch (e) { m.innerHTML = `<span class="bad-t">${esc(e.status === 401 ? 'Rebrickable rejected that key.' : e.message)}</span>`; }
};
$('sLogin').onclick = async () => {
  const m = $('sLoginMsg');
  if (!cfg.key) { m.textContent = 'Save your API key first.'; return; }
  const username = $('sUser').value.trim(), password = $('sPass').value;
  if (!username || !password) { m.textContent = 'Enter both.'; return; }
  m.innerHTML = '<span class="spin"></span>Signing in…';
  try {
    const d = await rb('/users/_token/', { method: 'POST', form: { username, password } });
    cfg.token = d.user_token; saveCfg(); $('sPass').value = '';
    m.innerHTML = '<span class="ok-t">Signed in.</span>';
  } catch (e) { m.innerHTML = `<span class="bad-t">${esc(e.status === 401 || e.status === 400 ? 'Wrong username or password.' : e.message)}</span>`; }
};
$('sLists').onclick = async () => {
  const m = $('sListsMsg');
  if (!cfg.key || !cfg.token) { m.textContent = 'Do steps 1 and 2 first.'; return; }
  m.innerHTML = '<span class="spin"></span>Checking…';
  try {
    const have = new Set((await myLists()).map(l => l.name)); let made = 0;
    for (const name of Object.values(SPOTS)) {
      if (have.has(name)) continue;
      m.innerHTML = `<span class="spin"></span>Creating ${esc(name)}…`;
      await rb(`/users/${cfg.token}/partlists/`, { method: 'POST', form: { name, is_buildable: 'true' } }); made++;
    }
    m.innerHTML = `<span class="ok-t">All ${Object.keys(SPOTS).length} lists ready${made ? ` (${made} created)` : ''}.</span>`;
  } catch (e) { m.innerHTML = `<span class="bad-t">${esc(e.message)}</span>`; }
};

/* ---------- scan ---------- */
let pieces = [], nextId = 1, lastScan = null, scanMeta = null, saveT = null;
function saveScan(now) {
  if (!scanMeta) return;
  const write = () => idb.put({ ...scanMeta, pieces, nextId }).catch(e => console.warn('save failed', e));
  clearTimeout(saveT);
  if (now) return write();
  saveT = setTimeout(write, 300);
}
async function pruneScans() {
  const all = (await idb.all().catch(() => [])).sort((a, b) => b.at - a.at);
  for (const old of all.slice(KEEP_SCANS)) if (old.added) await idb.del(old.id).catch(() => {});
}
function resetScan() { pieces = []; lastScan = null; scanMeta = null; }
const WORK_MAX = 2400, DET_MAX = 1024, CROP_MAX = 800, MIN_CROP = 24, PAD = 0.08, MAX_REGIONS = 30;

function drawTo(bitmap, max) {
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * s)); c.height = Math.max(1, Math.round(bitmap.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}
function toRgb(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
  return { data: out, width: canvas.width, height: canvas.height };
}
function cropBlob(work, rect, isolation) {
  const data = new Uint8Array(rect.width * rect.height * 3);
  for (let y = 0; y < rect.height; y++) {
    const src = ((rect.top + y) * work.width + rect.left) * 3;
    data.set(work.data.subarray(src, src + rect.width * 3), y * rect.width * 3);
  }
  if (isolation && isolation.erase.size) Scan.paintOut(data, rect, work.width, work.height, isolation);
  const c = document.createElement('canvas'); c.width = rect.width; c.height = rect.height;
  const g = c.getContext('2d'); const img = g.createImageData(rect.width, rect.height);
  for (let i = 0, j = 0; j < data.length; i += 4, j += 3) { img.data[i] = data[j]; img.data[i + 1] = data[j + 1]; img.data[i + 2] = data[j + 2]; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const out = drawTo(c, CROP_MAX), thumb = drawTo(c, 168);
  return new Promise(r => out.toBlob(b => r({ blob: b, thumb: thumb.toDataURL('image/jpeg', .8) }), 'image/jpeg', .9));
}
function setMsg(html, frac) {
  $('scanMsg').innerHTML = html;
  $('scanBar').hidden = frac == null; if (frac != null) $('scanBar').firstElementChild.style.width = Math.round(frac * 100) + '%';
}

async function scanFile(file) {
  if (!file) return;
  if (!cfg.key || !cfg.token) { fillSettings(); show('vSettings'); return; }
  show('vScan');
  try {
    setMsg('<span class="spin"></span>Reading photo…', 0.02);
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const workC = drawTo(bmp, WORK_MAX), work = toRgb(workC);
    const det = toRgb(drawTo(bmp, DET_MAX));
    const W = { width: work.width, height: work.height };
    setMsg('<span class="spin"></span>Finding pieces…', 0.06); await sleep(30);
    const seg = Scan.segmentParts(det, Scan.DETECTION_DEFAULTS);
    let rects = seg.rects;
    if (rects.length > MAX_REGIONS) rects = Scan.readingOrder([...rects].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, MAX_REGIONS));
    if (!rects.length) { setMsg('<span class="bad-t">No pieces found. Reshoot on plain paper that contrasts with the parts.</span>'); return; }
    const boxes = rects.map(r => Scan.pixelsToPercent(r, { width: det.width, height: det.height }));
    const cropRects = boxes.map(b => Scan.expandRect(Scan.percentToPixels(b, W), PAD, W));
    const plan = boxes.length > 1 ? Scan.planIsolation(seg, boxes, cropRects.map(r => Scan.pixelsToPercent(r, W)), Scan.findDuplicateBoxes(boxes)) : null;
    const tips = Scan.photoTips(seg);
    lastScan = { src: workC, rects: cropRects, tips };
    const photoC = drawTo(workC, 1200), k = photoC.width / workC.width;
    scanMeta = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(),
      photo: photoC.toDataURL('image/jpeg', 0.75), rects: cropRects.map(r => ({ left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k })),
      tips, added: false, addedKeys: [] };
    pieces = []; nextId = 1;

    const C = await colors();
    const found = []; let done = 0;
    const todo = cropRects.map((rect, i) => ({ rect, i }));
    setMsg(`<span class="spin"></span>Identifying ${todo.length} pieces…`, 0.1);
    const worker = async () => {
      for (;;) {
        const t = todo.shift(); if (!t) return;
        const id = t.i + 1;
        if (Math.max(t.rect.width, t.rect.height) < MIN_CROP) { done++; continue; }
        const { blob, thumb } = await cropBlob(work, t.rect, plan ? { labels: plan.labels, width: seg.width, height: seg.height, erase: plan.erase[t.i] } : null);
        let raw = null, err = null;
        try { raw = await brickognize(blob); } catch (e) { err = e.message; }
        found.push({ id, thumb, raw, err });
        done++; setMsg(`<span class="spin"></span>Identifying pieces… ${done}/${cropRects.length}`, 0.1 + 0.6 * done / cropRects.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    found.sort((a, b) => a.id - b.id);

    let n = 0;
    for (const f of found) {
      n++; setMsg(`<span class="spin"></span>Matching Rebrickable numbers… ${n}/${found.length}`, 0.7 + 0.3 * n / found.length);
      const items = f.raw?.items ?? [];
      const p = items[0] ? await partFromBL(items[0].id).catch(() => null) : null;
      const cols = (f.raw?.colors ?? []).map(c => C.byBL.get(String(c.id)) ?? C.byName.get(String(c.name).toLowerCase())).filter(Boolean);
      pieces.push({
        key: nextId++, id: f.id, thumb: f.thumb, part: p, score: items[0]?.score ?? 0, blName: items[0]?.name,
        img: items[0]?.img_url || p?.img || null,
        alts: items.slice(1, 3).map(x => ({ id: x.id, name: x.name, score: x.score, img: x.img_url })),
        color: cols[0] ?? null, colorScore: f.raw?.colors?.[0]?.score ?? 0, suggested: cols.slice(0, 3),
        qty: 1, state: p && cols[0] ? 'todo' : 'skip', err: f.err || (!items.length ? 'No match' : !p ? 'Not on Rebrickable' : null),
      });
    }
    setMsg('');
    renderReview(); saveScan(true); pruneScans(); show('vReview');
  } catch (e) {
    console.error(e); setMsg(`<span class="bad-t">${esc(e.message || 'Something went wrong')}</span>`);
  } finally { $('cam').value = ''; $('gal').value = ''; }
}
$('cam').onchange = () => scanFile($('cam').files[0]);
$('gal').onchange = () => scanFile($('gal').files[0]);

/* ---------- review ---------- */
function drawAnnotated() {
  const cv = $('annot'); if (!lastScan) { cv.hidden = true; return; }
  cv.hidden = false;
  const src = lastScan.src, SW = src.naturalWidth || src.width, SH = src.naturalHeight || src.height, s = Math.min(1, 1200 / Math.max(SW, SH));
  cv.width = Math.round(SW * s); cv.height = Math.round(SH * s);
  const g = cv.getContext('2d'); g.drawImage(src, 0, 0, cv.width, cv.height);
  const fs = Math.max(16, Math.round(cv.width / 32));
  g.font = `700 ${fs}px system-ui, sans-serif`; g.lineWidth = Math.max(2, fs / 7);
  lastScan.rects.forEach((r, i) => {
    const pc = pieces.find(p => p.id === i + 1);
    const col = !pc || pc.state === 'skip' ? '#9AA3B2' : pc.state === 'ok' ? '#3E8E1C' : '#F6C531';
    g.strokeStyle = col; g.strokeRect(r.left * s, r.top * s, r.width * s, r.height * s);
    const t = String(i + 1), w = g.measureText(t).width + 10;
    g.fillStyle = col; g.fillRect(r.left * s, r.top * s - fs - 4 < 0 ? r.top * s : r.top * s - fs - 4, w, fs + 4);
    g.fillStyle = '#10131A'; g.fillText(t, r.left * s + 5, (r.top * s - fs - 4 < 0 ? r.top * s : r.top * s - fs - 4) + fs - 1);
  });
  $('tips').innerHTML = (lastScan.tips || []).map(t => `<li>${esc(t.message)}</li>`).join('');
}
function colorOptions(sel, suggested = []) {
  const C = COL; if (!C) return '';
  const sug = suggested.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
  const opt = c => `<option value="${c.id}"${sel && c.id === sel.id ? ' selected' : ''}>${esc(c.name)}</option>`;
  return (sel ? '' : '<option value="">Pick a colour…</option>') +
    (sug.length ? `<optgroup label="Suggested">${sug.map(opt).join('')}</optgroup><optgroup label="All colours">` : '') +
    C.list.filter(c => !sug.some(x => x.id === c.id)).map(opt).join('') + (sug.length ? '</optgroup>' : '');
}
function pieceHtml(p) {
  const unsure = p.part && (p.score < 0.75 || p.colorScore < 0.7);
  const cls = 'piece ' + (p.state === 'ok' ? 'ok' : p.state === 'skip' ? 'skip' : unsure ? 'unsure' : '');
  const ref = p.img || p.part?.img;
  const img = `<div class="pics"><figure>${p.thumb ? `<img src="${p.thumb}" alt="Your piece ${p.id}">` : '<div class="noimg">–</div>'}<figcaption>Yours</figcaption></figure>`
    + `<figure>${ref ? `<img class="ref" src="${esc(ref)}" alt="Reference picture" loading="lazy" referrerpolicy="no-referrer">` : '<div class="noimg">No picture</div>'}<figcaption>Match</figcaption></figure></div>`;
  if (!p.part) return `<div class="${cls}" data-k="${p.key}">${img}<div>
      <div><span class="num">#${p.id}</span> <span class="meta">${esc(p.err || 'Not identified')}${p.blName ? ' · ' + esc(p.blName) : ''}</span></div>
      <div class="acts"><button type="button" data-a="part">Enter part number</button></div></div></div>`;
  const s = p.color ? spotOf(p.part, p.color) : spotOf(p.part, null);
  return `<div class="${cls}" data-k="${p.key}">${img}<div>
    <div><span class="num">#${p.id}</span> <span class="pill ${p.score >= .75 ? 'good' : ''}">${Math.round(p.score * 100)}%</span>
      <span class="meta">${esc(p.part.part_num)}</span></div>
    <div class="name">${esc(p.part.name)}</div>
    <div class="colrow"><span class="sw" style="background:#${p.color ? esc(p.color.rgb) : 'ccc'}" aria-hidden="true"></span><select data-a="color" aria-label="Colour">${colorOptions(p.color, p.suggested)}</select></div>
    <div class="spot">${esc(p.color ? spotText(s) : 'Pick a colour')}</div>
    <div class="acts">
      <button type="button" data-a="ok" class="${p.state === 'ok' ? 'on' : ''}" ${p.color ? '' : 'disabled'}>${p.state === 'ok' ? '✓ Accepted' : 'Accept'}</button>
      <span class="qty"><button type="button" data-a="minus" aria-label="Fewer">−</button><span>${p.qty}</span><button type="button" data-a="plus" aria-label="More">+</button></span>
      ${p.alts.map((a, i) => `<button type="button" class="alt" data-a="alt" data-i="${i}">${a.img ? `<img src="${esc(a.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(a.id)} ${Math.round(a.score * 100)}%</button>`).join('')}
      <button type="button" data-a="part">Change part</button>
      <button type="button" data-a="skip">${p.state === 'skip' ? 'Skipped' : 'Skip'}</button>
    </div></div></div>`;
}
function renderReview() {
  drawAnnotated();
  $('pieces').innerHTML = pieces.map(pieceHtml).join('');
  updateCount(); saveScan();
  $('addedNote').hidden = !scanMeta?.added;
  if (scanMeta?.added) $('addedNote').textContent = `Added to Rebrickable on ${new Date(scanMeta.addedAt).toLocaleString()}.`;
}
function rerender(p) {
  const el = $('pieces').querySelector(`[data-k="${p.key}"]`);
  if (el) el.outerHTML = pieceHtml(p);
  drawAnnotated(); updateCount(); saveScan();
}
function updateCount() {
  const n = pieces.filter(p => p.state === 'ok').reduce((s, p) => s + p.qty, 0);
  $('toSummary').textContent = `Review ${n} →`; $('toSummary').disabled = !n;
}
$('pieces').addEventListener('change', e => {
  const el = e.target.closest('[data-k]'); if (!el || e.target.dataset.a !== 'color') return;
  const p = pieces.find(x => x.key == el.dataset.k);
  p.color = COL.byId.get(Number(e.target.value)) ?? null; p.colorScore = 1; rerender(p);
});
$('pieces').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const p = pieces.find(x => x.key == b.closest('[data-k]').dataset.k);
  const a = b.dataset.a;
  if (a === 'ok') p.state = p.state === 'ok' ? 'todo' : 'ok';
  if (a === 'skip') p.state = p.state === 'skip' ? 'todo' : 'skip';
  if (a === 'plus') p.qty++;
  if (a === 'minus') p.qty = Math.max(1, p.qty - 1);
  if (a === 'alt') {
    const alt = p.alts[+b.dataset.i]; b.disabled = true; b.textContent = '…';
    const np = await partFromBL(alt.id).catch(() => null);
    if (np) { p.alts[+b.dataset.i] = { id: p.part.part_num, name: p.part.name, score: p.score, img: p.img }; p.part = np; p.img = alt.img || np.img || null; p.score = alt.score; p.state = 'todo'; }
    else alert(`${alt.id} isn’t on Rebrickable.`);
  }
  if (a === 'part') {
    const num = prompt('Part number (Rebrickable or BrickLink):', p.part?.part_num ?? ''); if (!num) return;
    b.disabled = true; b.textContent = '…';
    const np = (await getPart(num.trim()).catch(() => null)) ?? (await partFromBL(num.trim()).catch(() => null));
    if (np) { p.part = np; p.img = np.img || null; p.score = 1; p.alts = []; p.err = null; p.state = 'todo'; }
    else { alert(`${num} not found on Rebrickable.`); }
  }
  rerender(p);
});
$('acceptSure').onclick = () => {
  pieces.forEach(p => { if (p.state === 'todo' && p.part && p.color && p.score >= 0.75 && p.colorScore >= 0.7) p.state = 'ok'; });
  renderReview();
};
$('addMissed').onclick = () => { $('missedForm').hidden = false; $('mColor').innerHTML = colorOptions(null); $('mPart').value = ''; $('mMsg').textContent = ''; $('mPart').focus(); };
$('mCancel').onclick = () => { $('missedForm').hidden = true; };
$('mAdd').onclick = async () => {
  const num = $('mPart').value.trim(), c = COL.byId.get(Number($('mColor').value));
  if (!num || !c) { $('mMsg').textContent = 'Enter a part number and pick a colour.'; return; }
  $('mMsg').innerHTML = '<span class="spin"></span>Looking up…';
  const p = (await getPart(num).catch(() => null)) ?? (await partFromBL(num).catch(() => null));
  if (!p) { $('mMsg').textContent = `${num} not found on Rebrickable.`; return; }
  pieces.push({ key: nextId++, id: '+', thumb: null, img: p.img || null, part: p, score: 1, alts: [], color: c, colorScore: 1, suggested: [], qty: 1, state: 'ok' });
  $('missedForm').hidden = true; renderReview();
};
$('newScan').onclick = () => { saveScan(true); resetScan(); show('vScan'); };

/* ---------- summary & add ---------- */
function merged() {
  const m = new Map();
  for (const p of pieces) {
    if (p.state !== 'ok' || !p.part || !p.color) continue;
    const k = p.part.part_num + '|' + p.color.id;
    const x = m.get(k) ?? { part: p.part, color: p.color, qty: 0, spot: spotOf(p.part, p.color) };
    x.qty += p.qty; m.set(k, x);
  }
  return [...m.values()];
}
$('toSummary').onclick = () => {
  const items = merged(), by = new Map();
  for (const x of items) { if (!by.has(x.spot[0])) by.set(x.spot[0], []); by.get(x.spot[0]).push(x); }
  $('groups').innerHTML = [...by.keys()].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map(k =>
    `<div class="group"><b>${esc(placeOf(k))}</b>${by.get(k).map(x => `<div>${x.qty}× ${esc(x.part.name)} · ${esc(x.color.name)}${x.spot[1] ? ` · ${esc(x.spot[1])}` : ''}</div>`).join('')}</div>`).join('');
  const total = items.reduce((s, x) => s + x.qty, 0);
  $('addAll').textContent = `Add ${total} pieces to Rebrickable`; $('addAll').disabled = false;
  $('addLog').hidden = true; $('addBar').hidden = true;
  show('vSummary');
};
$('backReview').onclick = () => show('vReview');
$('doneScan').onclick = () => { saveScan(true); resetScan(); show('vScan'); };
$('addAll').onclick = async () => {
  let items = merged(); if (!items.length) return;
  const keyOf = x => `${x.part.part_num}|${x.color.id}`;
  const done = new Set(scanMeta?.addedKeys || []);
  if (items.every(x => done.has(keyOf(x)))) {
    if (!confirm('Everything here was already added to Rebrickable. Add it all again?')) return;
    done.clear(); if (scanMeta) scanMeta.addedKeys = [];
  }
  items = items.filter(x => !done.has(keyOf(x)));
  $('addAll').disabled = true; const log = $('addLog'); log.hidden = false; log.innerHTML = '';
  const bar = $('addBar'); bar.hidden = false;
  const line = (cls, t) => { log.innerHTML += `<div class="${cls}">${esc(t)}</div>`; log.scrollTop = log.scrollHeight; };
  try {
    const lists = await myLists(); let i = 0, ok = 0;
    for (const x of items) {
      const list = lists.find(l => l.name === SPOTS[x.spot[0]]);
      try {
        if (!list) throw new Error(`list "${SPOTS[x.spot[0]]}" missing; run Settings → lists`);
        const now = await addToList(list, x.part.part_num, x.color.id, x.qty);
        ok++; if (scanMeta) { scanMeta.addedKeys.push(keyOf(x)); saveScan(true); } line('ok-t', `✓ ${x.qty}× ${x.part.part_num} ${x.color.name} → ${placeOf(x.spot[0])}${now != x.qty ? ` (now ${now})` : ''}`);
      } catch (e) { line('bad-t', `✗ ${x.part.part_num} ${x.color.name}: ${e.message}`); }
      bar.firstElementChild.style.width = Math.round(++i / items.length * 100) + '%';
    }
    line('', ok === items.length ? 'All added.' : `${ok} of ${items.length} added.`);
    if (ok === items.length && scanMeta) { scanMeta.added = true; scanMeta.addedAt = Date.now(); saveScan(true); }
  } catch (e) { line('bad-t', e.message); $('addAll').disabled = false; }
};

/* ---------- start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (cfg.key && cfg.token) { show('vScan'); colors().catch(() => {}); } else { fillSettings(); show('vSettings'); }
