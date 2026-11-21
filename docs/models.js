// Catálogo de modelos GRATUITOS (lo usan la interfaz y el servidor).
// Vídeo y edición se ejecutan en Hugging Face Spaces (ZeroGPU, gratis con cuota diaria).
// Las imágenes rápidas usan Pollinations (gratis, sin clave).

export const VIDEO_MODELS = [
  {
    key: 'wan22',
    name: 'Wan 2.2 (Alibaba)',
    tag: 'La mejor calidad de movimiento. En «Texto → Vídeo» primero crea un fotograma con FLUX y luego lo anima.',
    durations: ['2', '3', '4', '5'],
    defaultDuration: '4',
    ratios: ['16:9', '9:16', '1:1'],
  },
  {
    key: 'ltx23',
    name: 'LTX‑2.3 (Lightricks)',
    tag: 'Alta resolución, vídeos de hasta 10 s y ¡con audio generado!',
    durations: ['3', '5', '8', '10'],
    defaultDuration: '5',
    ratios: ['16:9', '9:16', '1:1'],
  },
  {
    key: 'ltxfast',
    name: 'LTX‑Video Distilled',
    tag: 'El más rápido. Texto → vídeo directo, ideal para probar ideas.',
    durations: ['2', '4', '6', '8'],
    defaultDuration: '4',
    ratios: ['16:9', '9:16', '1:1'],
  },
];

export const IMAGE_MODELS = [
  { key: 'local', name: '🖥️ Mi GPU · Z‑Image‑Turbo', tag: 'Se genera en tu propio ordenador: gratis, sin cuota y sin límites. Requiere instalar «Lumina Local» (botón «🖥️ Mi GPU»).' },
  { key: 'flux-schnell', name: 'FLUX.1 Schnell', tag: 'Rápido y de buena calidad (Hugging Face).' },
  { key: 'flux-krea', name: 'FLUX.1 Krea', tag: 'Máximo realismo y detalle. Más lento.' },
  { key: 'pollinations', name: 'Pollinations', tag: 'Sin cuota diaria. Calidad básica y pequeña marca de agua.' },
];

export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];

export const AI_EDIT_TOOLS = [
  {
    key: 'instruct', name: '✏️ Editar con instrucción', needsPrompt: true,
    hint: 'FLUX Kontext: describe el cambio. Ej.: «cambia el fondo a una playa al atardecer», «ponle gafas de sol», «conviértelo en acuarela».',
  },
  {
    key: 'rmbg', name: '✂️ Quitar fondo', needsPrompt: false,
    hint: 'Separa el sujeto y deja el fondo transparente (PNG).',
  },
];

export const PROMPT_CHIPS = {
  video: ['plano cinematográfico', 'cámara lenta', 'toma de dron', 'travelling lento', 'luz de hora dorada',
    'estilo anime', 'hiperrealista', 'cámara en mano', 'zoom lento', 'iluminación neón'],
  image: ['fotografía profesional', 'ilustración digital', 'estilo animación 3D', 'acuarela', 'retrato de estudio',
    'arte conceptual', 'minimalista', 'cyberpunk', 'óleo clásico', 'fotografía de producto'],
};
