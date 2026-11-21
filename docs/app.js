import { VIDEO_MODELS, IMAGE_MODELS, RATIOS, AI_EDIT_TOOLS, PROMPT_CHIPS } from './models.js';
import { startJob, token, files } from './engine.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ================= Navegación =================
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'gallery') renderGallery();
  window.scrollTo({ top: 0 });
}
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ================= Estado / ajustes (token opcional) =================
function refreshStatus() {
  const has = Boolean(token.get());
  const s = $('#apiStatus');
  s.textContent = has ? '✓ Cuota ampliada' : '⚙️ Más cuota';
  s.className = 'api-status ' + (has ? 'ok' : 'off');
  $('#setupBanner').classList.toggle('hidden', has || store.get('lumina.bannerClosed', false));
}
refreshStatus();
$('#bannerClose').addEventListener('click', () => { $('#setupBanner').classList.add('hidden'); store.set('lumina.bannerClosed', true); });
const dlg = $('#settings');
const openSettings = () => { $('#hfToken').value = token.get(); dlg.showModal(); };
$('#apiStatus').addEventListener('click', openSettings);
$('#bannerSettings').addEventListener('click', openSettings);
$('#settingsSave').addEventListener('click', (e) => {
  e.preventDefault();
  const v = $('#hfToken').value.trim();
  if (v && !/^hf_[A-Za-z0-9]{20,}$/.test(v)) return toast('El token debe empezar por hf_');
  token.set(v); dlg.close(); refreshStatus(); toast(v ? '¡Token guardado! Ya tienes más cuota' : 'Token eliminado');
});
$('#settingsClose').addEventListener('click', () => dlg.close());

// ================= Utilidades de imagen =================
function loadImage(src) {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('No se pudo cargar la imagen')); i.src = src; });
}
function fileToDataUrl(file) {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
}
async function blobToDataUrl(blob) { return fileToDataUrl(blob); }

// Reduce imágenes grandes para enviarlas rápido (conserva transparencia si es PNG)
async function prepareImage(src, max = 1536) {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const png = /^data:image\/png/.test(src);
  return { dataUrl: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92), w, h };
}
async function urlToDataUrl(url) { return blobToDataUrl(await (await fetch(url)).blob()); }

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const urlNames = new Map(); // blob: URL -> nombre de archivo
function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name || urlNames.get(url) || `lumina-${Date.now()}`; document.body.appendChild(a); a.click(); a.remove();
}
function blobUrl(blob, prefix = 'lumina') {
  const u = URL.createObjectURL(blob);
  urlNames.set(u, `${prefix}-${Date.now()}.${EXT[(blob.type || '').split(';')[0]] || (blob.type.startsWith('video') ? 'mp4' : 'png')}`);
  return u;
}

// ================= Zonas de arrastre =================
const drops = {};
function setupDrop(el, onLoad) {
  const input = $('input', el), preview = $('.drop-preview', el), empty = $('.drop-empty', el), clear = $('.drop-clear', el);
  const api = {
    value: null,
    async set(dataUrl) {
      const prepared = await prepareImage(dataUrl);
      api.value = prepared;
      if (preview) { preview.src = prepared.dataUrl; preview.classList.remove('hidden'); empty.classList.add('hidden'); clear?.classList.remove('hidden'); }
      onLoad?.(prepared, dataUrl);
    },
    clear() {
      api.value = null; input.value = '';
      if (preview) { preview.classList.add('hidden'); preview.removeAttribute('src'); empty.classList.remove('hidden'); clear?.classList.add('hidden'); }
    },
  };
  const handle = async (file) => {
    if (!file || !file.type.startsWith('image/')) return toast('Elige un archivo de imagen');
    try { await api.set(await fileToDataUrl(file)); } catch (e) { toast(e.message); }
  };
  el.addEventListener('click', (e) => { if (e.target !== clear) input.click(); });
  input.addEventListener('change', () => handle(input.files[0]));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  clear?.addEventListener('click', (e) => { e.stopPropagation(); api.clear(); });
  return api;
}

// Pegar imagen con Ctrl+V en la pestaña activa
document.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  const active = $('.panel.active').id.replace('tab-', '');
  const target = { video: 'video', aiedit: 'aiedit', editor: 'editor' }[active];
  if (target) {
    if (target === 'video') setVideoMode('i2v');
    fileToDataUrl(file).then((d) => drops[target].set(d));
  }
});

// ================= Chips de estilo =================
$$('.chips').forEach((box) => {
  const ta = document.getElementById(box.dataset.for);
  PROMPT_CHIPS[box.dataset.set].forEach((label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = '+ ' + label;
    b.onclick = () => { ta.value = ta.value.trim() ? `${ta.value.trim().replace(/[,.]$/, '')}, ${label}` : label; ta.focus(); };
    box.appendChild(b);
  });
});

// ================= Trabajos (cola + progreso) =================
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function runJob(kind, params, stage, button) {
  button.disabled = true;
  const started = Date.now();
  stage.innerHTML = `
    <div class="progress">
      <div class="orb"></div>
      <div class="status">Iniciando…</div>
      <div class="bar"><i></i></div>
      <div class="sub"><span class="detail"></span> · <span class="elapsed">0:00</span></div>
      <p class="hint">Los modelos gratuitos se ejecutan en GPUs compartidas: puede haber cola. No cierres la app mientras se genera.</p>
      <button class="btn cancel" type="button">Cancelar</button>
    </div>`;
  const $status = $('.status', stage), $bar = $('.bar > i', stage), $detail = $('.detail', stage), $el = $('.elapsed', stage);
  let job;
  const tick = setInterval(() => {
    $el.textContent = fmtTime((Date.now() - started) / 1000);
    if (!job) return;
    $status.textContent = job.stage || 'Procesando…';
    $detail.textContent = job.detail || 'Trabajando';
    $bar.style.width = job.progress != null ? `${Math.round(Math.min(1, job.progress) * 100)}%`
      : `${Math.min(92, ((Date.now() - started) / 1000 / 120) * 100)}%`;
  }, 400);
  try {
    job = startJob(kind, params);
    $('.cancel', stage).onclick = () => job.abort();
    const res = await job.promise;
    const ids = [], urls = [];
    for (const b of res.blobs) {
      const id = (crypto.randomUUID?.() || String(Math.random()).slice(2));
      await files.put(id, b); ids.push(id); urls.push(blobUrl(b, `lumina-${res.type === 'video' ? 'video' : 'imagen'}`));
    }
    return { ...res, ids, urls, keyframe: res.keyframe ? blobUrl(res.keyframe, 'lumina-fotograma') : null, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (e) {
    stage.innerHTML = `<div class="error-box"><b>No se pudo completar.</b><br>${esc(e.message)}</div>`;
    return null;
  } finally {
    clearInterval(tick);
    button.disabled = false;
  }
}

// Botones de acción para una imagen resultante
function imageActions(url) {
  const wrap = document.createElement('div'); wrap.className = 'actions';
  const add = (label, fn) => { const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = label; b.onclick = fn; wrap.appendChild(b); };
  add('⬇ Descargar', () => download(url));
  add('🎬 Animar', () => sendTo('video', url));
  add('✨ Editar con IA', () => sendTo('aiedit', url));
  add('🎚️ Retocar', () => sendTo('editor', url));
  return wrap;
}

async function sendTo(target, url) {
  try {
    const dataUrl = url.startsWith('data:') ? url : await urlToDataUrl(url);
    if (target === 'video') setVideoMode('i2v');
    await drops[target].set(dataUrl);
    showTab(target);
    toast(target === 'video' ? 'Imagen lista: describe el movimiento y genera' : 'Imagen cargada');
  } catch (e) { toast(e.message); }
}

// ================= Galería =================
function addToGallery(items) { // items: { type, fileId, prompt, model }
  const g = store.get('lumina.gallery', []);
  g.unshift(...items.map((it) => ({ id: crypto.randomUUID?.() || String(Math.random()), date: Date.now(), ...it })));
  store.set('lumina.gallery', g.slice(0, 300));
  updateGalleryCount();
}
function updateGalleryCount() { $('#galleryCount').textContent = store.get('lumina.gallery', []).length; }
let galleryFilter = 'all';
$$('#galleryFilter button').forEach((b) => b.onclick = () => {
  galleryFilter = b.dataset.f;
  $$('#galleryFilter button').forEach((x) => x.classList.toggle('active', x === b));
  renderGallery();
});
$('#galleryClear').onclick = () => {
  if (!confirm('¿Vaciar la galería? Se borrarán todas tus creaciones de este dispositivo.')) return;
  store.set('lumina.gallery', []); files.clear(); renderGallery(); updateGalleryCount();
};
const galleryUrls = new Map(); // fileId -> blob URL
async function fileUrl(it) {
  if (galleryUrls.has(it.fileId)) return galleryUrls.get(it.fileId);
  const b = await files.get(it.fileId);
  if (!b) return null;
  const u = blobUrl(b, `lumina-${it.type === 'video' ? 'video' : 'imagen'}`);
  galleryUrls.set(it.fileId, u); return u;
}
async function renderGallery() {
  const items = store.get('lumina.gallery', []).filter((i) => galleryFilter === 'all' || i.type === galleryFilter);
  const box = $('#gallery'); box.innerHTML = '';
  $('#galleryEmpty').classList.toggle('hidden', items.length > 0);
  for (const raw of items) {
    const url = await fileUrl(raw);
    if (!url) continue;
    const it = { ...raw, url };
    const el = document.createElement('div'); el.className = 'gitem';
    el.innerHTML = `
      <span class="badge">${it.type === 'video' ? '🎬 Vídeo' : '🖼️ Imagen'}</span>
      ${it.type === 'video'
        ? `<video src="${esc(it.url)}" muted loop playsinline preload="metadata"></video>`
        : `<img src="${esc(it.url)}" loading="lazy" alt="">`}
      <div class="ginfo"><p>${esc(it.prompt || it.label || '')}</p>
        <div>${esc(it.model || '')} · ${new Date(it.date).toLocaleString()}</div>
        <div class="gact"></div></div>`;
    const v = $('video', el);
    if (v) { el.onmouseenter = () => v.play().catch(() => {}); el.onmouseleave = () => v.pause(); v.onclick = () => { v.controls = true; }; }
    const act = $('.gact', el);
    const add = (label, fn) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = label; b.onclick = fn; act.appendChild(b); };
    add('⬇', () => download(it.url));
    if (it.type === 'image') { add('🎬', () => sendTo('video', it.url)); add('✨', () => sendTo('aiedit', it.url)); add('🎚️', () => sendTo('editor', it.url)); }
    if (it.prompt) add('↺ Prompt', () => { const tab = it.type === 'video' ? 'video' : 'image'; $(`#${tab}Prompt`).value = it.prompt; showTab(tab); });
    add('🗑', () => { store.set('lumina.gallery', store.get('lumina.gallery', []).filter((x) => x.id !== it.id)); files.del(it.fileId); renderGallery(); updateGalleryCount(); });
    box.appendChild(el);
  }
}
updateGalleryCount();

// ================= VÍDEO =================
const vModel = $('#videoModel'), vDur = $('#videoDuration'), vRatio = $('#videoRatio');
let videoMode = 't2v';
VIDEO_MODELS.forEach((m) => vModel.add(new Option(m.name, m.key)));
vModel.value = store.get('lumina.videoModel', 'wan22');
function refreshVideoModel() {
  const m = VIDEO_MODELS.find((x) => x.key === vModel.value) || VIDEO_MODELS[0];
  const prevDur = vDur.value, prevRatio = vRatio.value;
  vDur.innerHTML = ''; m.durations.forEach((d) => vDur.add(new Option(`${d} s`, d)));
  vDur.value = m.durations.includes(prevDur) ? prevDur : m.defaultDuration;
  vRatio.innerHTML = ''; m.ratios.forEach((r) => vRatio.add(new Option(r, r)));
  vRatio.value = m.ratios.includes(prevRatio) ? prevRatio : m.ratios[0];
  $('#videoModelTag').textContent = m.tag;
  store.set('lumina.videoModel', m.key);
}
vModel.onchange = refreshVideoModel;
refreshVideoModel();

function setVideoMode(mode) {
  videoMode = mode;
  $$('#videoMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#videoImageWrap').classList.toggle('hidden', mode !== 'i2v');
  $('#videoRatioWrap').classList.toggle('hidden', mode === 'i2v');
  $('#videoPrompt').placeholder = mode === 'i2v'
    ? 'Describe el movimiento: «la mujer sonríe y gira la cabeza, el viento mueve su pelo, cámara se acerca lentamente»'
    : 'Un astronauta camina por un mercado nocturno lleno de neones, reflejos en los charcos, travelling lento…';
}
$$('#videoMode button').forEach((b) => b.onclick = () => setVideoMode(b.dataset.mode));
drops.video = setupDrop($('.drop[data-target="video"]'));

$('#videoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#videoPrompt').value.trim();
  if (!prompt) return toast('Describe tu vídeo');
  const img = videoMode === 'i2v' ? drops.video.value : null;
  if (videoMode === 'i2v' && !img) return toast('Sube una imagen inicial');
  const model = VIDEO_MODELS.find((m) => m.key === vModel.value);
  const params = {
    model: model.key, prompt, duration: vDur.value, ratio: vRatio.value,
    negative: $('#videoNeg').value.trim(), seed: $('#videoSeed').value,
    translate: $('#videoTranslate').checked,
    ...(img ? { image: img.dataUrl, imageW: img.w, imageH: img.h } : {}),
  };
  const stage = $('#videoStage');
  const res = await runJob('video', params, stage, $('#videoBtn'));
  if (!res) return;
  const url = res.urls[0];
  stage.innerHTML = `
    <div class="result">
      <video src="${esc(url)}" controls autoplay loop playsinline></video>
      <div class="meta">${esc(model.name)} · ${params.duration} s · semilla ${res.seed} · ${fmtTime(res.seconds)}
        ${res.prompt && res.prompt !== prompt ? `<br><i>Prompt usado: ${esc(res.prompt)}</i>` : ''}</div>
      <div class="actions">
        <button class="btn primary" data-a="dl">⬇ Descargar MP4</button>
        <button class="btn" data-a="again">↻ Otra versión</button>
        ${res.keyframe ? '<button class="btn" data-a="kf">🖼️ Abrir fotograma inicial</button>' : ''}
      </div>
      ${res.note ? `<p class="hint">${esc(res.note)}</p>` : ''}
    </div>`;
  $('[data-a="dl"]', stage).onclick = () => download(url);
  $('[data-a="again"]', stage).onclick = () => { $('#videoSeed').value = ''; $('#videoForm').requestSubmit(); };
  const kf = $('[data-a="kf"]', stage); if (kf) kf.onclick = () => sendTo('editor', res.keyframe);
  addToGallery([{ type: 'video', fileId: res.ids[0], prompt, model: model.name }]);
  toast('¡Vídeo listo! Guardado en la galería');
});

// ================= IMAGEN =================
const iModel = $('#imageModel'), iSize = $('#imageSize');
IMAGE_MODELS.forEach((m) => iModel.add(new Option(m.name, m.key)));
RATIOS.forEach((r) => iSize.add(new Option(r, r)));
iSize.value = '1:1';
const refreshImageTag = () => { $('#imageModelTag').textContent = IMAGE_MODELS.find((m) => m.key === iModel.value).tag; };
iModel.onchange = refreshImageTag; refreshImageTag();

$('#imageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#imagePrompt').value.trim();
  if (!prompt) return toast('Describe tu imagen');
  const model = IMAGE_MODELS.find((m) => m.key === iModel.value);
  const params = { model: model.key, prompt, ratio: iSize.value, count: $('#imageNum').value, seed: $('#imageSeed').value, translate: $('#imageTranslate').checked };
  const stage = $('#imageStage');
  const res = await runJob('image', params, stage, $('#imageBtn'));
  if (!res) return;
  stage.innerHTML = `<div class="result">
      <div class="result-grid"></div>
      <div class="meta">${esc(model.name)} · semilla ${res.seed} · ${fmtTime(res.seconds)}
        ${res.prompt && res.prompt !== prompt ? `<br><i>Prompt usado: ${esc(res.prompt)}</i>` : ''}</div>
      ${res.note ? `<p class="hint">${esc(res.note)}</p>` : ''}
    </div>`;
  const grid = $('.result-grid', stage);
  if (res.urls.length === 1) grid.style.gridTemplateColumns = 'minmax(0, 720px)', grid.style.justifyContent = 'center';
  res.urls.forEach((u) => {
    const f = document.createElement('figure');
    f.innerHTML = `<img src="${esc(u)}" alt="">`;
    f.appendChild(imageActions(u));
    grid.appendChild(f);
  });
  addToGallery(res.ids.map((id) => ({ type: 'image', fileId: id, prompt, model: res.note ? 'Pollinations' : model.name })));
  toast('¡Imagen lista!');
});

// ================= EDITAR CON IA =================
let aiTool = AI_EDIT_TOOLS[0];
const toolsBox = $('#aiTools');
AI_EDIT_TOOLS.forEach((t) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tool'; b.textContent = t.name;
  b.onclick = () => selectTool(t); t.el = b; toolsBox.appendChild(b);
});
function selectTool(t) {
  aiTool = t;
  AI_EDIT_TOOLS.forEach((x) => x.el.classList.toggle('active', x === t));
  $('#aiPromptWrap').classList.toggle('hidden', !t.needsPrompt);
  $('#aiHint').textContent = t.hint;
  $('#aiPrompt').placeholder = 'Ej.: cambia el fondo por una ciudad de noche con luces de neón';
}
selectTool(aiTool);
drops.aiedit = setupDrop($('.drop[data-target="aiedit"]'));

$('#aiEditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const img = drops.aiedit.value;
  if (!img) return toast('Sube una foto');
  const prompt = $('#aiPrompt').value.trim();
  if (aiTool.needsPrompt && !prompt) return toast('Escribe qué quieres cambiar');
  const stage = $('#aiStage');
  const res = await runJob('edit', { tool: aiTool.key, image: img.dataUrl, prompt }, stage, $('#aiBtn'));
  if (!res) return;
  const out = res.urls[0];
  stage.innerHTML = `<div class="result">
      <div class="compare">
        <figure><img src="${img.dataUrl}" alt=""><figcaption>Antes</figcaption></figure>
        <figure><img src="${esc(out)}" alt=""><figcaption>Después</figcaption></figure>
      </div>
      <div class="meta">${esc(aiTool.name)} · ${fmtTime(res.seconds)}</div>
    </div>`;
  const actions = imageActions(out);
  const again = document.createElement('button'); again.className = 'btn'; again.textContent = '↪ Seguir editando este resultado';
  again.onclick = () => sendTo('aiedit', out);
  actions.prepend(again);
  $('.result', stage).appendChild(actions);
  addToGallery([{ type: 'image', fileId: res.ids[0], prompt: aiTool.needsPrompt ? prompt : aiTool.name.replace(/^\S+\s/, ''), model: aiTool.key === 'rmbg' ? 'Quitar fondo' : 'FLUX Kontext' }]);
  toast('¡Edición lista!');
});

// ================= EDITOR MANUAL (canvas) =================
const canvas = $('#editorCanvas'), ctx = canvas.getContext('2d');
const SLIDERS = [
  ['brightness', 'Brillo', 0, 200, 100, '%'],
  ['contrast', 'Contraste', 0, 200, 100, '%'],
  ['saturate', 'Saturación', 0, 200, 100, '%'],
  ['warmth', 'Temperatura', -100, 100, 0, ''],
  ['hue', 'Tono', -180, 180, 0, '°'],
  ['blur', 'Desenfoque', 0, 20, 0, 'px'],
  ['sepia', 'Sepia', 0, 100, 0, '%'],
  ['grayscale', 'Blanco y negro', 0, 100, 0, '%'],
  ['vignette', 'Viñeta', 0, 100, 0, '%'],
];
const DEFAULTS = Object.fromEntries(SLIDERS.map((s) => [s[0], s[4]]));
const PRESETS = [
  ['Original', {}],
  ['Vívido', { contrast: 115, saturate: 145, brightness: 104 }],
  ['Cine', { contrast: 120, saturate: 80, warmth: -15, vignette: 45, brightness: 95 }],
  ['B/N', { grayscale: 100, contrast: 125 }],
  ['Vintage', { sepia: 45, contrast: 90, saturate: 80, warmth: 25, vignette: 35 }],
  ['Cálido', { warmth: 45, saturate: 115 }],
  ['Frío', { warmth: -45, brightness: 104 }],
  ['Drama', { contrast: 150, saturate: 70, brightness: 92, vignette: 60 }],
];
const ed = { img: null, adj: { ...DEFAULTS }, rot: 0, flipH: false, flipV: false, crop: '', compare: false };

const slidersBox = $('#sliders');
for (const [key, label, min, max, def, unit] of SLIDERS) {
  const row = document.createElement('label'); row.className = 'slider';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" value="${def}" data-k="${key}"><output>${def}${unit}</output>`;
  const input = $('input', row), out = $('output', row);
  input.oninput = () => { ed.adj[key] = Number(input.value); out.textContent = input.value + unit; $$('.preset').forEach((p) => p.classList.remove('active')); scheduleRender(); };
  row.ondblclick = () => { input.value = def; input.oninput(); };
  slidersBox.appendChild(row);
}
function syncSliders() {
  for (const [key, , , , , unit] of SLIDERS) {
    const i = $(`input[data-k="${key}"]`, slidersBox); i.value = ed.adj[key]; i.nextElementSibling.textContent = ed.adj[key] + unit;
  }
}

function filterString(a) {
  return `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) hue-rotate(${a.hue}deg) sepia(${a.sepia}%) grayscale(${a.grayscale}%) blur(${a.blur}px)`;
}

// Dibuja la imagen con todos los ajustes en un canvas de destino
function renderTo(target, img, opts, maxSide = Infinity) {
  const { adj, rot, flipH, flipV, crop } = opts;
  const rotated = rot % 2 === 1;
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  // Recorte centrado según la relación de aspecto (se aplica tras la rotación)
  if (crop) {
    const r = Number(crop);
    const W = rotated ? sh : sw, H = rotated ? sw : sh;
    let cw = W, ch = H;
    if (W / H > r) cw = H * r; else ch = W / r;
    if (rotated) { sx = (sw - ch) / 2; sy = (sh - cw) / 2; sw = ch; sh = cw; }
    else { sx = (sw - cw) / 2; sy = (sh - ch) / 2; sw = cw; sh = ch; }
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  target.width = rotated ? dh : dw; target.height = rotated ? dw : dh;
  const c = target.getContext('2d');
  c.save();
  c.translate(target.width / 2, target.height / 2);
  c.rotate((rot * Math.PI) / 2);
  c.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  c.filter = filterString(adj);
  c.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  c.restore();
  c.filter = 'none';
  const W = target.width, H = target.height;
  if (adj.warmth) {
    c.save(); c.globalCompositeOperation = 'soft-light';
    c.fillStyle = adj.warmth > 0 ? `rgba(255,140,30,${adj.warmth / 160})` : `rgba(40,120,255,${-adj.warmth / 160})`;
    c.fillRect(0, 0, W, H); c.restore();
  }
  if (adj.vignette) {
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${adj.vignette / 100 * 0.85})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  const text = opts.text;
  if (text) {
    const size = Math.round(Math.min(W, H) * (opts.textSize / 100));
    c.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.lineWidth = Math.max(2, size / 9); c.strokeStyle = 'rgba(0,0,0,.65)'; c.fillStyle = opts.textColor;
    c.strokeText(text, W / 2, H - size * 0.6); c.fillText(text, W / 2, H - size * 0.6);
  }
}

const currentOpts = () => ({ ...ed, adj: ed.compare ? DEFAULTS : ed.adj, text: ed.compare ? '' : $('#txtOverlay').value, textSize: Number($('#txtSize').value), textColor: $('#txtColor').value });
let rafId = 0;
function scheduleRender() {
  if (!ed.img) return;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => renderTo(canvas, ed.img, currentOpts(), 2400));
}

const presetBox = $('#presets');
function buildPresets() {
  presetBox.innerHTML = '';
  for (const [name, values] of PRESETS) {
    const b = document.createElement('button'); b.className = 'preset'; b.type = 'button';
    const c = document.createElement('canvas'); b.appendChild(c); b.append(name);
    if (ed.img) renderTo(c, ed.img, { adj: { ...DEFAULTS, ...values }, rot: 0, flipH: false, flipV: false, crop: '1' }, 90);
    b.onclick = () => {
      if (!ed.img) return toast('Abre una foto primero');
      ed.adj = { ...DEFAULTS, ...values }; syncSliders();
      $$('.preset').forEach((p) => p.classList.toggle('active', p === b)); scheduleRender();
    };
    presetBox.appendChild(b);
  }
}
buildPresets();

drops.editor = {
  value: null,
  async set(dataUrl) {
    ed.img = await loadImage(dataUrl);
    Object.assign(ed, { adj: { ...DEFAULTS }, rot: 0, flipH: false, flipV: false, crop: '' });
    $('#cropSel').value = ''; syncSliders();
    canvas.classList.remove('hidden'); $('#editorPh').classList.add('hidden');
    buildPresets(); scheduleRender();
  },
};
const edDrop = $('.drop[data-target="editor"]'), edInput = $('input', edDrop);
edDrop.onclick = () => edInput.click();
edInput.onchange = async () => { const f = edInput.files[0]; if (f) await drops.editor.set(await fileToDataUrl(f)); edInput.value = ''; };
const edStage = $('#editorStage');
edStage.addEventListener('dragover', (e) => e.preventDefault());
edStage.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) await drops.editor.set(await fileToDataUrl(f)); });
edDrop.addEventListener('dragover', (e) => e.preventDefault());
edDrop.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) await drops.editor.set(await fileToDataUrl(f)); });

$('#cropSel').onchange = (e) => { ed.crop = e.target.value; scheduleRender(); };
['#txtOverlay', '#txtSize', '#txtColor'].forEach((s) => $(s).addEventListener('input', scheduleRender));

function exportEdited() {
  const c = document.createElement('canvas');
  renderTo(c, ed.img, { ...currentOpts(), adj: ed.adj, text: $('#txtOverlay').value });
  return c.toDataURL('image/png');
}

$('#editorControls').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (!ed.img) return toast('Abre una foto primero');
  switch (act) {
    case 'rotL': ed.rot = (ed.rot + 3) % 4; break;
    case 'rotR': ed.rot = (ed.rot + 1) % 4; break;
    case 'flipH': ed.flipH = !ed.flipH; break;
    case 'flipV': ed.flipV = !ed.flipV; break;
    case 'reset':
      Object.assign(ed, { adj: { ...DEFAULTS }, rot: 0, flipH: false, flipV: false, crop: '' });
      $('#cropSel').value = ''; $('#txtOverlay').value = ''; syncSliders(); $$('.preset').forEach((p) => p.classList.remove('active'));
      break;
    case 'compare':
      ed.compare = !ed.compare; e.target.classList.toggle('primary', ed.compare);
      e.target.textContent = ed.compare ? 'Viendo original' : 'Antes / después';
      break;
    case 'download': {
      const url = exportEdited();
      download(url, `lumina-foto-${Date.now()}.png`);
      return;
    }
    case 'toAi': return sendTo('aiedit', exportEdited());
    case 'toVideo': return sendTo('video', exportEdited());
  }
  scheduleRender();
});

setVideoMode('t2v');
