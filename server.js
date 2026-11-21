// Lumina Studio — servidor (Node 18+)
// Sirve la interfaz y ejecuta los trabajos de IA con servicios GRATUITOS:
//  · Hugging Face Spaces (Wan 2.2, LTX, FLUX, Kontext, quitar fondo) vía @gradio/client
//  · Pollinations (imágenes y traducción de prompts, sin clave)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client, handle_file } from '@gradio/client';
import { VIDEO_MODELS, IMAGE_MODELS } from './public/models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Configuración (.env opcional) ----------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const PORT = Number(process.env.PORT) || 3000;
const HF_TOKEN = process.env.HF_TOKEN || '';
const PUBLIC = path.join(__dirname, 'public');
const OUTPUTS = path.join(__dirname, 'outputs');
const MAX_BODY = 25 * 1024 * 1024;
fs.mkdirSync(OUTPUTS, { recursive: true });

// Spaces gratuitos usados (puedes cambiarlos si alguno deja de funcionar)
const SPACES = {
  wan22: 'zerogpu-aoti/wan2-2-fp8da-aoti-faster',
  ltx23: 'Lightricks/LTX-2-3',
  ltxfast: 'Lightricks/ltx-video-distilled',
  'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
  'flux-krea': 'black-forest-labs/FLUX.1-Krea-dev',
  kontext: 'black-forest-labs/FLUX.1-Kontext-Dev',
  rmbg: 'not-lain/background-removal',
};

// Tamaños por formato
const IMG_SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1024, 1024], '4:3': [1152, 864], '3:4': [864, 1152] };
const LTX_FAST_SIZES = { '16:9': [832, 480], '9:16': [480, 832], '1:1': [640, 640] };
const LTX23_SIZES = { '16:9': [1536, 864], '9:16': [864, 1536], '1:1': [1152, 1152] };

// ---------- Utilidades ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json',
};
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('La imagen es demasiado grande (máx. 25 MB).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Imagen no válida');
  return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] });
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

async function saveBuffer(buf, contentType, hintUrl = '') {
  let ext = EXT[(contentType || '').split(';')[0]] || (hintUrl.match(/\.(mp4|webm|png|jpe?g|webp)(?:$|\?)/i)?.[1] ?? 'bin');
  if (ext === 'jpeg') ext = 'jpg';
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(OUTPUTS, name), buf);
  return `/outputs/${name}`;
}

async function download(url) {
  const headers = HF_TOKEN && /hf\.space|huggingface\.co/.test(url) ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`No se pudo descargar el resultado (${r.status})`);
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
}

// Busca la primera URL de archivo dentro de la respuesta de Gradio
function findFileUrl(x) {
  if (!x) return null;
  if (typeof x === 'object' && !Array.isArray(x) && typeof x.url === 'string') return x.url;
  if (typeof x === 'object') for (const v of Object.values(x)) { const u = findFileUrl(v); if (u) return u; }
  return null;
}

// ---------- Traducción gratuita del prompt (Pollinations) ----------
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
async function pollinationsImage(prompt, ratio, seed) {
  const [w, h] = IMG_SIZES[ratio] || IMG_SIZES['1:1'];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&private=true`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) {
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
    }
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 8000)); continue; }
    throw new Error(`Pollinations respondió ${r.status}`);
  }
  throw new Error('Pollinations está saturado, inténtalo en unos segundos.');
}

// ---------- Hugging Face Spaces (Gradio) ----------
const JOB_TIMEOUT = 12 * 60 * 1000; // 12 min máx. por paso
const hfAuth = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
const hosts = new Map();
async function spaceHost(space) {
  if (!hosts.has(space)) {
    const r = await fetch(`https://huggingface.co/api/spaces/${space}/host`, { headers: hfAuth });
    if (!r.ok) throw new Error(`Space no encontrado (${r.status})`);
    hosts.set(space, (await r.json()).host);
  }
  return hosts.get(space);
}

// Los Spaces gratuitos tienen varias réplicas: si la subida, la generación y la descarga
// caen en réplicas distintas fallan con 404/403. Fijamos una réplica para todo el trabajo.
async function connect(space) {
  const host = await spaceHost(space);
  let base = host;
  try {
    const r = await fetch(`${host}/config`, { headers: hfAuth, signal: AbortSignal.timeout(20000) });
    const rep = r.headers.get('x-proxied-replica');
    await r.body?.cancel();
    if (rep) base = `${host}/--replicas/${rep.split('-').pop()}`;
  } catch {}
  const client = await Client.connect(base, { events: ['data', 'status'], ...(HF_TOKEN ? { token: HF_TOKEN, hf_token: HF_TOKEN } : {}) });
  const pin = (u) => (u.startsWith(host) && !u.includes('/--replicas/') ? base + u.slice(host.length) : u);
  const origFetch = client.fetch.bind(client);
  client.fetch = (input, init) => origFetch(typeof input === 'string' || input instanceof URL ? pin(String(input)) : input, init);
  client.config.root = base;
  client.pin = pin;
  return client;
}

function friendlyError(msg = '') {
  if (/quota|ZeroGPU|GPU duration/i.test(msg)) {
    return HF_TOKEN
      ? 'Se agotó tu cuota gratuita de GPU de hoy en Hugging Face. Se recarga cada día; mientras tanto prueba un vídeo más corto o el modelo «LTX‑Video Distilled».'
      : 'Se agotó la cuota gratuita anónima de GPU. Crea una cuenta gratis en huggingface.co, genera un token (Settings → Access Tokens) y ponlo en .env como HF_TOKEN=... para tener mucha más cuota diaria.';
  }
  if (/sleeping|paused|building|runtime error/i.test(msg)) return 'El modelo se está iniciando en Hugging Face. Espera un minuto y vuelve a intentarlo.';
  return msg || 'Error desconocido del servicio de IA';
}

// Reintenta una vez si la sesión del Space se pierde (error transitorio habitual)
// `post` procesa el resultado (p. ej. descargarlo) dentro del reintento
async function runGradio(job, spaceKey, endpoint, args, post = (d) => d) {
  const attempt = async () => post(await runGradioOnce(job, spaceKey, endpoint, args));
  try { return await attempt(); } catch (e) {
    if (job.status !== 'running' || !/session not found|not found|404|403|connection|closed|timed? ?out|fetch failed|descargar/i.test(e.message)) throw e;
    job.detail = 'Reconectando con el servicio…';
    return attempt();
  }
}
const runGradioFile = (job, spaceKey, endpoint, args) => runGradio(job, spaceKey, endpoint, args, gradioFileToOutput);

async function runGradioOnce(job, spaceKey, endpoint, args) {
  const space = SPACES[spaceKey];
  let client;
  try { client = await connect(space); } catch (e) {
    throw new Error(friendlyError(`No se pudo conectar con ${space}: ${e.message}`));
  }
  const sub = client.submit(endpoint, args);
  job.cancel = () => { sub.cancel?.(); client.close?.(); };
  const timer = setTimeout(() => { sub.cancel?.(); client.close?.(); }, JOB_TIMEOUT);
  const pinUrls = (x) => (typeof x === 'string' ? client.pin(x) : Array.isArray(x) ? x.map(pinUrls)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, pinUrls(v)])) : x);
  try {
    return await Promise.race([
      consume(job, sub).then(pinUrls),
      new Promise((_, fail) => setTimeout(() => fail(new Error('El servicio tardó demasiado. Inténtalo de nuevo más tarde.')), JOB_TIMEOUT)),
    ]);
  } finally { clearTimeout(timer); }
}

const STALL_MS = 3 * 60 * 1000; // sin noticias del servicio en 3 min => reconectar
// Algunos Spaces envían vistas previas intermedias: guardamos el último dato y
// devolvemos cuando el trabajo termina (stage "complete") o se cierra el flujo.
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
      last = m.data;
    }
  }
  if (last !== undefined) return last;
  throw new Error('El servicio cerró la conexión sin devolver resultado');
}

async function gradioFileToOutput(data) {
  const url = findFileUrl(data);
  if (!url) throw new Error(HF_TOKEN
    ? 'El modelo no devolvió resultado. Suele pasar cuando se agota la cuota gratuita diaria de GPU o el Space está saturado: prueba con menos duración, otro modelo o más tarde.'
    : 'El modelo no devolvió resultado. Lo más probable es que se haya agotado la cuota anónima de GPU. Añade un HF_TOKEN gratuito en .env para tener mucha más cuota (ver README), o prueba con menos duración u otro modelo.');
  const { buf, type } = await download(url);
  return saveBuffer(buf, type, url);
}

// ---------- Tareas ----------
async function generateImageBuffer(job, model, prompt, ratio, seed) {
  const [w, h] = IMG_SIZES[ratio] || IMG_SIZES['1:1'];
  if (model === 'pollinations') return pollinationsImage(prompt, ratio, seed);
  const args = model === 'flux-krea'
    ? { prompt, seed, randomize_seed: false, width: w, height: h, guidance_scale: 4.5, num_inference_steps: 28 }
    : { prompt, seed, randomize_seed: false, width: w, height: h, num_inference_steps: 4 };
  try {
    return await runGradio(job, model, '/infer', args, (data) => {
      const url = findFileUrl(data);
      if (!url) throw new Error('Sin imagen');
      return download(url);
    });
  } catch (e) {
    // Si FLUX falla (cuota o caída), usamos Pollinations para no dejar al usuario sin resultado
    job.detail = 'FLUX no disponible, usando Pollinations…';
    job.note = `Generado con Pollinations porque FLUX falló: ${e.message}`;
    return pollinationsImage(prompt, ratio, seed);
  }
}

const tasks = {
  async image(job, p) {
    if (!IMAGE_MODELS.some((m) => m.key === p.model)) throw new Error('Modelo no válido');
    job.stage = 'Preparando prompt…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    const n = Math.min(Math.max(Number(p.count) || 1, 1), 4);
    const base = p.seed !== '' && p.seed != null ? Number(p.seed) : randomSeed();
    const outputs = [];
    for (let i = 0; i < n; i++) {
      job.stage = n > 1 ? `Generando imagen ${i + 1} de ${n}…` : 'Generando imagen…';
      job.progress = i / n;
      const { buf, type } = await generateImageBuffer(job, p.model, prompt, p.ratio, base + i);
      outputs.push(await saveBuffer(buf, type));
    }
    return { type: 'image', urls: outputs, seed: base };
  },

  async video(job, p) {
    const model = VIDEO_MODELS.find((m) => m.key === p.model);
    if (!model) throw new Error('Modelo no válido');
    const duration = Math.min(Number(p.duration) || Number(model.defaultDuration), Math.max(...model.durations.map(Number)));
    const seed = p.seed !== '' && p.seed != null ? Number(p.seed) : randomSeed();
    job.stage = 'Preparando prompt…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    const ratio = model.ratios.includes(p.ratio) ? p.ratio : '16:9';

    let image = p.image ? dataUrlToBlob(p.image) : null;
    let keyframe = null;

    // Texto → vídeo directo (LTX distilled)
    if (!image && model.key === 'ltxfast') {
      job.stage = 'Generando vídeo…';
      const [w, h] = LTX_FAST_SIZES[ratio];
      const out = await runGradioFile(job, 'ltxfast', '/text_to_video', {
        prompt, negative_prompt: p.negative || 'worst quality, inconsistent motion, blurry, jittery, distorted',
        height_ui: h, width_ui: w, mode: 'text-to-video', duration_ui: duration,
        seed_ui: seed, randomize_seed: false, improve_texture_flag: true,
      });
      return { type: 'video', urls: [out], seed };
    }

    // Texto → vídeo en dos pasos: fotograma clave con FLUX + animación
    if (!image) {
      job.stage = 'Paso 1/2 · Creando fotograma inicial…';
      const { buf, type } = await generateImageBuffer(job, 'flux-schnell', prompt, ratio, seed);
      keyframe = await saveBuffer(buf, type);
      image = new Blob([buf], { type: type || 'image/jpeg' });
      job.keyframe = keyframe;
      job.progress = 0; job.detail = '';
    }

    job.stage = keyframe ? 'Paso 2/2 · Animando…' : 'Animando imagen…';
    let out;
    if (model.key === 'wan22') {
      out = await runGradioFile(job, 'wan22', '/generate_video', {
        input_image: handle_file(image), prompt, steps: 6,
        ...(p.negative ? { negative_prompt: p.negative } : {}), duration_seconds: duration,
        guidance_scale: 1, guidance_scale_2: 1, seed, randomize_seed: false,
      });
    } else if (model.key === 'ltx23') {
      const [w, h] = (p.imageW && p.imageH)
        ? fitLtx23(p.imageW, p.imageH) : LTX23_SIZES[ratio];
      out = await runGradioFile(job, 'ltx23', '/generate_video', {
        input_image: handle_file(image), prompt, duration, enhance_prompt: false,
        seed, randomize_seed: false, height: h, width: w,
      });
    } else {
      const [w, h] = (p.imageW && p.imageH) ? fitLtxFast(p.imageW, p.imageH) : LTX_FAST_SIZES[ratio];
      out = await runGradioFile(job, 'ltxfast', '/image_to_video', {
        prompt, negative_prompt: p.negative || 'worst quality, inconsistent motion, blurry, jittery, distorted',
        input_image_filepath: handle_file(image), height_ui: h, width_ui: w, mode: 'image-to-video',
        duration_ui: duration, seed_ui: seed, randomize_seed: false, improve_texture_flag: true,
      });
    }
    return { type: 'video', urls: [out], seed, keyframe };
  },

  async edit(job, p) {
    const image = dataUrlToBlob(p.image);
    if (p.tool === 'rmbg') {
      job.stage = 'Quitando fondo…';
      return { type: 'image', urls: [await runGradioFile(job, 'rmbg', '/png', { f: handle_file(image) })] };
    }
    if (!p.prompt) throw new Error('Escribe qué quieres cambiar');
    job.stage = 'Preparando instrucción…';
    const prompt = p.translate === false ? p.prompt : await toEnglish(p.prompt);
    job.prompt = prompt;
    job.stage = 'Editando con FLUX Kontext…';
    const out = await runGradioFile(job, 'kontext', '/infer', {
      input_image: handle_file(image), prompt, seed: randomSeed(), randomize_seed: false,
      guidance_scale: 2.5, steps: 28,
    });
    return { type: 'image', urls: [out] };
  },
};

// Ajusta dimensiones al aspecto de la imagen (múltiplos de 32)
const r32 = (n) => Math.max(256, Math.round(n / 32) * 32);
function fitBox(w, h, long) { return w >= h ? [r32(long), r32(long * h / w)] : [r32(long * w / h), r32(long)]; }
const fitLtx23 = (w, h) => fitBox(w, h, 1536);
const fitLtxFast = (w, h) => fitBox(w, h, 832);

// ---------- Cola de trabajos en memoria ----------
const jobs = new Map();
function createJob(kind, params) {
  if (!tasks[kind]) throw new Error('Tarea desconocida');
  const id = crypto.randomUUID();
  const job = { id, kind, status: 'running', stage: 'Iniciando…', detail: '', progress: null, createdAt: Date.now() };
  jobs.set(id, job);
  tasks[kind](job, params)
    .then((result) => { Object.assign(job, { status: 'done', result, finishedAt: Date.now() }); })
    .catch((e) => { Object.assign(job, { status: 'error', error: e.message, finishedAt: Date.now() }); console.error(`[${kind}]`, e.message); });
  return job;
}
setInterval(() => { // limpiar trabajos viejos de memoria
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 3600_000) jobs.delete(id);
}, 600_000).unref();

const publicJob = ({ cancel, ...j }) => j;

// ---------- HTTP ----------
async function handleApi(req, res, url) {
  if (url.pathname === '/api/config') return send(res, 200, { hfToken: Boolean(HF_TOKEN) });
  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const { kind, params } = await readBody(req);
    if (!params || typeof params !== 'object') return send(res, 400, { error: 'Faltan parámetros' });
    if (kind !== 'edit' && !String(params.prompt || '').trim()) return send(res, 400, { error: 'Escribe un prompt' });
    return send(res, 200, publicJob(createJob(kind, params)));
  }
  const m = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: 'Trabajo no encontrado (¿se reinició el servidor?)' });
    if (req.method === 'DELETE') { job.cancel?.(); Object.assign(job, { status: 'error', error: 'Cancelado', finishedAt: Date.now() }); }
    return send(res, 200, publicJob(job));
  }
  return send(res, 404, { error: 'Ruta no encontrada' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const root = p.startsWith('/outputs/') ? __dirname : PUBLIC;
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root === PUBLIC ? PUBLIC : OUTPUTS)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No encontrado'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Soporte de Range para que los vídeos se puedan adelantar
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    return send(res, 500, { error: e.message || 'Error interno' });
  }
}).listen(PORT, () => {
  console.log(`\n  ✦ Lumina Studio en http://localhost:${PORT}`);
  console.log(HF_TOKEN
    ? '  ✓ Token de Hugging Face cargado (cuota gratuita ampliada)\n'
    : '  ℹ Modo anónimo gratuito. Añade HF_TOKEN en .env para más cuota diaria (gratis).\n');
});
