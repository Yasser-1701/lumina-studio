// Motor de IA que se ejecuta 100 % en el navegador (sin servidor).
// Usa servicios GRATUITOS: Hugging Face Spaces (vía @gradio/client) y Pollinations.
import { Client, handle_file } from 'https://cdn.jsdelivr.net/npm/@gradio/client@2.8.0/dist/index.min.js';
import { VIDEO_MODELS, IMAGE_MODELS } from './models.js';

// Spaces gratuitos usados (si alguno deja de funcionar, cámbialo aquí)
export const SPACES = {
  wan22: 'zerogpu-aoti/wan2-2-fp8da-aoti-faster',
  ltx23: 'Lightricks/LTX-2-3',
  ltxfast: 'Lightricks/ltx-video-distilled',
  'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
  'flux-krea': 'black-forest-labs/FLUX.1-Krea-dev',
  kontext: 'black-forest-labs/FLUX.1-Kontext-Dev',
  rmbg: 'not-lain/background-removal',
};

const IMG_SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1024, 1024], '4:3': [1152, 864], '3:4': [864, 1152] };
const LTX_FAST_SIZES = { '16:9': [832, 480], '9:16': [480, 832], '1:1': [640, 640] };
const LTX23_SIZES = { '16:9': [1536, 864], '9:16': [864, 1536], '1:1': [1152, 1152] };
const JOB_TIMEOUT = 12 * 60 * 1000;
const STALL_MS = 3 * 60 * 1000;

// Token opcional de Hugging Face (se guarda solo en este navegador)
export const token = {
  get() { try { return localStorage.getItem('lumina.hfToken') || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem('lumina.hfToken', v) : localStorage.removeItem('lumina.hfToken'); } catch {} },
};
const hfAuth = () => (token.get() ? { Authorization: `Bearer ${token.get()}` } : {});

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function dataUrlToBlob(dataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Imagen no válida');
  const bin = atob(m[2]); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

function findFileUrl(x) {
  if (!x) return null;
  if (typeof x === 'object' && !Array.isArray(x) && typeof x.url === 'string') return x.url;
  if (typeof x === 'object') for (const v of Object.values(x)) { const u = findFileUrl(v); if (u) return u; }
  return null;
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar el resultado (${r.status})`);
  return r.blob();
}

// ---------- Traducción gratuita del prompt ----------
async function toEnglish(text) {
  if (!text || !/[áéíóúñü¿¡]|\b(el|la|los|las|un|una|con|del|que|en|por|para|y)\b/i.test(text)) return text;
  try {
    const q = encodeURIComponent(`Translate the following image/video generation prompt to English. Reply ONLY with the translation, no quotes:\n${text}`);
    const r = await fetch(`https://text.pollinations.ai/${q}`, { signal: AbortSignal.timeout(25000) });
    const t = (await r.text()).trim();
    return r.ok && t && t.length < text.length * 4 ? t : text;
  } catch { return text; }
}

// ---------- Pollinations (imágenes sin clave) ----------
async function pollinationsImage(prompt, ratio, seed, job) {
  const [w, h] = IMG_SIZES[ratio] || IMG_SIZES['1:1'];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&private=true`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) return r.blob();
    if (r.status === 402 || r.status === 429) {
      // Límite gratuito: 1 imagen cada ~45 s por conexión. Esperamos y reintentamos.
      const txt = await r.text().catch(() => '');
      const wait = Math.min(60, Number(txt.match(/after (\d+)s/)?.[1] || r.headers.get('retry-after') || 45)) + 2;
      for (let t = wait; t > 0; t--) {
        if (job?.cancelled) throw new Error('Cancelado');
        if (job) job.detail = `Límite gratuito de Pollinations: esperando ${t} s…`;
        await sleep(1000);
      }
      continue;
    }
    if (r.status === 403 && /^(localhost|127\.)/.test(location.hostname)) throw new Error('Pollinations no acepta peticiones desde localhost. Usa la versión online de la app.');
    throw new Error(`Pollinations respondió ${r.status}`);
  }
  throw new Error('Pollinations está saturado, inténtalo en un minuto.');
}

// ---------- Hugging Face Spaces ----------
const hosts = new Map();
async function spaceHost(space) {
  if (!hosts.has(space)) {
    const r = await fetch(`https://huggingface.co/api/spaces/${space}/host`, { headers: hfAuth() });
    if (!r.ok) throw new Error(`Space no encontrado (${r.status})`);
    hosts.set(space, (await r.json()).host);
  }
  return hosts.get(space);
}

// Los Spaces tienen varias réplicas: fijamos una para que subida, generación
// y descarga ocurran en el mismo servidor (si no, fallan con 404/403).
async function connect(space) {
  const host = await spaceHost(space);
  let base = host;
  try {
    const r = await fetch(`${host}/config`, { headers: hfAuth(), signal: AbortSignal.timeout(20000) });
    const rep = r.headers.get('x-proxied-replica');
    await r.body?.cancel();
    if (rep) base = `${host}/--replicas/${rep.split('-').pop()}`;
  } catch {}
  const t = token.get();
  const client = await Client.connect(base, { events: ['data', 'status'], ...(t ? { token: t, hf_token: t } : {}) });
  const pin = (u) => (u.startsWith(host) && !u.includes('/--replicas/') ? base + u.slice(host.length) : u);
  const origFetch = client.fetch.bind(client);
  client.fetch = (input, init) => origFetch(typeof input === 'string' || input instanceof URL ? pin(String(input)) : input, init);
  client.config.root = base;
  client.pin = pin;
  return client;
}

function friendlyError(msg = '') {
  if (/quota|ZeroGPU|GPU duration/i.test(msg)) {
    return token.get()
      ? 'Se agotó tu cuota gratuita de GPU de hoy en Hugging Face. Se recarga cada día; mientras tanto prueba un vídeo más corto o el modelo «LTX‑Video Distilled».'
      : 'Se agotó la cuota gratuita anónima de GPU de hoy. Pulsa «⚙️ Más cuota» arriba a la derecha para añadir un token gratuito de Hugging Face y tener mucha más.';
  }
  if (/sleeping|paused|building|runtime error/i.test(msg)) return 'El modelo se está iniciando en Hugging Face. Espera un minuto y vuelve a intentarlo.';
  return msg || 'Error desconocido del servicio de IA';
}

async function consume(job, sub) {
  const it = sub[Symbol.asyncIterator]();
  let last;
  for (;;) {
    let stall;
    const next = await Promise.race([
      it.next(),
      new Promise((_, fail) => { stall = setTimeout(() => fail(new Error('connection timed out')), STALL_MS); }),
    ]).finally(() => clearTimeout(stall));
    if (next.done) break;
    const m = next.value;
    if (m.type === 'status') {
      if (m.stage === 'error') throw new Error(friendlyError(m.message));
      if (m.stage === 'complete' && last !== undefined) return last;
      if (m.queue && m.position != null && m.position > 0) {
        job.detail = `En cola: posición ${m.position + 1}${m.eta ? ` · ~${Math.round(m.eta)} s` : ''}`;
      } else if (m.progress_data?.length) {
        const pd = m.progress_data[0];
        if (pd.index != null && pd.length) { const i = Math.min(pd.index + 1, pd.length); job.progress = i / pd.length; job.detail = `Paso ${i} de ${pd.length}`; }
        else if (pd.progress != null) { job.progress = pd.progress; job.detail = pd.desc || ''; }
      } else if (m.stage === 'pending' && !job.detail) {
        job.detail = 'Procesando en GPU…';
      }
    } else if (m.type === 'data') {
      last = m.data; // algunos Spaces envían vistas previas: nos quedamos con la última
    }
  }
  if (last !== undefined) return last;
  throw new Error('El servicio cerró la conexión sin devolver resultado');
}

async function runGradioOnce(job, spaceKey, endpoint, args) {
  let client;
  try { client = await connect(SPACES[spaceKey]); } catch (e) {
    throw new Error(friendlyError(`No se pudo conectar con ${SPACES[spaceKey]}: ${e.message}`));
  }
  if (job.cancelled) throw new Error('Cancelado');
  const sub = client.submit(endpoint, args);
  job.cancel = () => { sub.cancel?.(); client.close?.(); };
  const pinUrls = (x) => (typeof x === 'string' ? client.pin(x) : Array.isArray(x) ? x.map(pinUrls)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, pinUrls(v)])) : x);
  let timer;
  try {
    return await Promise.race([
      consume(job, sub).then(pinUrls),
      new Promise((_, fail) => { timer = setTimeout(() => { job.cancel?.(); fail(new Error('El servicio tardó demasiado. Inténtalo más tarde.')); }, JOB_TIMEOUT); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Reintenta una vez ante errores transitorios. `post` procesa el resultado dentro del reintento.
async function runGradio(job, spaceKey, endpoint, args, post = (d) => d) {
  const attempt = async () => post(await runGradioOnce(job, spaceKey, endpoint, args));
  try { return await attempt(); } catch (e) {
    if (job.cancelled || !/session not found|not found|404|403|connection|closed|timed? ?out|fetch|descargar/i.test(e.message)) throw e;
    job.detail = 'Reconectando con el servicio…';
    return attempt();
  }
}

async function fileFrom(data) {
  const url = findFileUrl(data);
  if (!url) throw new Error(token.get()
    ? 'El modelo no devolvió resultado. Suele pasar cuando se agota la cuota gratuita diaria o el servicio está saturado: prueba con menos duración, otro modelo o más tarde.'
    : 'El modelo no devolvió resultado. Lo más probable es que se haya agotado la cuota anónima de GPU. Pulsa «⚙️ Más cuota» para añadir un token gratuito, o prueba con menos duración u otro modelo.');
  return download(url);
}
const runGradioFile = (job, k, ep, args) => runGradio(job, k, ep, args, fileFrom);

const r32 = (n) => Math.max(256, Math.round(n / 32) * 32);
const fitBox = (w, h, long) => (w >= h ? [r32(long), r32((long * h) / w)] : [r32((long * w) / h), r32(long)]);

// ---------- Tareas ----------
async function generateImageBlob(job, model, prompt, ratio, seed) {
  const [w, h] = IMG_SIZES[ratio] || IMG_SIZES['1:1'];
  if (model === 'pollinations') return pollinationsImage(prompt, ratio, seed, job);
  const args = model === 'flux-krea'
    ? { prompt, seed, randomize_seed: false, width: w, height: h, guidance_scale: 4.5, num_inference_steps: 28 }
    : { prompt, seed, randomize_seed: false, width: w, height: h, num_inference_steps: 4 };
  try {
    return await runGradioFile(job, model, '/infer', args);
  } catch (e) {
    if (job.cancelled) throw e;
    job.detail = 'FLUX no disponible, usando Pollinations…';
    job.note = `Generado con Pollinations porque FLUX falló: ${e.message}`;
    return pollinationsImage(prompt, ratio, seed, job);
  }
}

const getSeed = (s) => (s !== '' && s != null ? Number(s) : randomSeed());

const tasks = {
  async image(job, p) {
    if (!IMAGE_MODELS.some((m) => m.key === p.model)) throw new Error('Modelo no válido');
    job.stage = 'Preparando prompt…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    const n = Math.min(Math.max(Number(p.count) || 1, 1), 4);
    const base = getSeed(p.seed);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      job.stage = n > 1 ? `Generando imagen ${i + 1} de ${n}…` : 'Generando imagen…';
      job.progress = i / n;
      blobs.push(await generateImageBlob(job, p.model, prompt, p.ratio, base + i));
    }
    return { type: 'image', blobs, seed: base };
  },

  async video(job, p) {
    const model = VIDEO_MODELS.find((m) => m.key === p.model);
    if (!model) throw new Error('Modelo no válido');
    const duration = Math.min(Number(p.duration) || Number(model.defaultDuration), Math.max(...model.durations.map(Number)));
    const seed = getSeed(p.seed);
    job.stage = 'Preparando prompt…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    const ratio = model.ratios.includes(p.ratio) ? p.ratio : '16:9';
    const negative = p.negative || 'worst quality, inconsistent motion, blurry, jittery, distorted';
    let image = p.image ? dataUrlToBlob(p.image) : null;
    let keyframe = null;

    if (!image && model.key === 'ltxfast') {
      job.stage = 'Generando vídeo…';
      const [w, h] = LTX_FAST_SIZES[ratio];
      const blob = await runGradioFile(job, 'ltxfast', '/text_to_video', {
        prompt, negative_prompt: negative, height_ui: h, width_ui: w, mode: 'text-to-video',
        duration_ui: duration, seed_ui: seed, randomize_seed: false, improve_texture_flag: true,
      });
      return { type: 'video', blobs: [blob], seed };
    }

    if (!image) {
      job.stage = 'Paso 1/2 · Creando fotograma inicial…';
      image = await generateImageBlob(job, 'flux-schnell', prompt, ratio, seed);
      keyframe = image;
      job.progress = null; job.detail = '';
    }

    job.stage = keyframe ? 'Paso 2/2 · Animando…' : 'Animando imagen…';
    let blob;
    if (model.key === 'wan22') {
      blob = await runGradioFile(job, 'wan22', '/generate_video', {
        input_image: handle_file(image), prompt, steps: 6,
        ...(p.negative ? { negative_prompt: p.negative } : {}), duration_seconds: duration,
        guidance_scale: 1, guidance_scale_2: 1, seed, randomize_seed: false,
      });
    } else if (model.key === 'ltx23') {
      const [w, h] = p.imageW && p.imageH ? fitBox(p.imageW, p.imageH, 1536) : LTX23_SIZES[ratio];
      blob = await runGradioFile(job, 'ltx23', '/generate_video', {
        input_image: handle_file(image), prompt, duration, enhance_prompt: false,
        seed, randomize_seed: false, height: h, width: w,
      });
    } else {
      const [w, h] = p.imageW && p.imageH ? fitBox(p.imageW, p.imageH, 832) : LTX_FAST_SIZES[ratio];
      blob = await runGradioFile(job, 'ltxfast', '/image_to_video', {
        prompt, negative_prompt: negative, input_image_filepath: handle_file(image),
        height_ui: h, width_ui: w, mode: 'image-to-video', duration_ui: duration,
        seed_ui: seed, randomize_seed: false, improve_texture_flag: true,
      });
    }
    return { type: 'video', blobs: [blob], seed, keyframe };
  },

  async edit(job, p) {
    const image = dataUrlToBlob(p.image);
    if (p.tool === 'rmbg') {
      job.stage = 'Quitando fondo…';
      return { type: 'image', blobs: [await runGradioFile(job, 'rmbg', '/png', { f: handle_file(image) })] };
    }
    if (!p.prompt) throw new Error('Escribe qué quieres cambiar');
    job.stage = 'Preparando instrucción…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    job.stage = 'Editando con FLUX Kontext…';
    const blob = await runGradioFile(job, 'kontext', '/infer', {
      input_image: handle_file(image), prompt, seed: randomSeed(), randomize_seed: false, guidance_scale: 2.5, steps: 28,
    });
    return { type: 'image', blobs: [blob] };
  },
};

// Lanza un trabajo. Devuelve un objeto "job" que se va actualizando (stage, detail, progress)
// y cuya propiedad `promise` se resuelve con el resultado.
export function startJob(kind, params) {
  if (!tasks[kind]) throw new Error('Tarea desconocida');
  const job = { kind, stage: 'Iniciando…', detail: '', progress: null, cancelled: false };
  job.abort = () => { job.cancelled = true; job.cancel?.(); };
  job.promise = tasks[kind](job, params).then((result) => {
    if (job.cancelled) throw new Error('Cancelado');
    return { ...result, prompt: job.prompt, note: job.note };
  });
  return job;
}

// ---------- Almacén local (IndexedDB) para la galería ----------
const DB = 'lumina-studio', STORE = 'files';
let dbp;
function db() {
  dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return dbp;
}
const memory = new Map(); // respaldo si IndexedDB no está disponible (modo privado)
export const files = {
  async put(id, blob) {
    memory.set(id, blob);
    try { const d = await db(); await new Promise((ok, fail) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(blob, id); t.oncomplete = ok; t.onerror = () => fail(t.error); }); } catch {}
  },
  async get(id) {
    if (memory.has(id)) return memory.get(id);
    try { const d = await db(); return await new Promise((ok) => { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch { return null; }
  },
  async del(id) {
    memory.delete(id);
    try { const d = await db(); d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); } catch {}
  },
  async clear() {
    memory.clear();
    try { const d = await db(); d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch {}
  },
};
