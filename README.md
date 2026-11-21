# ✦ Lumina Studio — Estudio de IA 100 % gratis

Crea **vídeos con IA**, genera **imágenes** y **edita fotos**, todo con modelos open‑source gratuitos.
No hace falta tarjeta, ni API de pago, ni cuenta.

| Función | Modelo (gratis) | Dónde se ejecuta |
|---|---|---|
| 🎬 Imagen → Vídeo | **Wan 2.2** (Alibaba), **LTX‑2.3** (con audio), LTX‑Video | GPUs gratuitas de Hugging Face |
| 🎬 Texto → Vídeo | LTX‑Video directo, o FLUX + Wan 2.2 / LTX‑2.3 (2 pasos) | Hugging Face |
| 🖼️ Texto → Imagen | **FLUX.1 Schnell**, **FLUX.1 Krea**, Pollinations | Hugging Face / Pollinations |
| ✨ Editar con una frase | **FLUX.1 Kontext** («ponle una bufanda roja», «cambia el fondo»…) | Hugging Face |
| ✂️ Quitar fondo | BiRefNet | Hugging Face |
| 🎚️ Editor de fotos | Filtros, brillo, contraste, temperatura, viñeta, recorte, giro, texto | Tu navegador (sin internet) |
| 🌐 Traducción de prompts | Escribe en español; se traduce al inglés automáticamente | Pollinations |

Además tiene una **galería** con todo lo que creas. Todo se conecta entre sí: genera una imagen, edítala con IA, retócala y **anímala** como vídeo con un clic.

## Instalación

Necesitas [Node.js 18 o superior](https://nodejs.org).

```bash
cd lumina-studio
npm install
npm start
```

Abre **http://localhost:3000**.

## (Opcional, gratis) Más cuota de GPU

Sin cuenta funciona en modo anónimo, pero Hugging Face da poca cuota diaria de GPU a los usuarios anónimos.
Con una cuenta gratuita tienes bastante más:

1. Crea una cuenta en https://huggingface.co (gratis).
2. Ve a **Settings → Access Tokens → Create new token**, de tipo **Read**.
3. Copia `.env.example` como `.env` y pega el token:
   ```
   HF_TOKEN=hf_xxxxxxxxxxxxxxxx
   ```
4. Reinicia el servidor (`npm start`).

## Qué esperar (es gratis, con límites)

- **Tiempo:** de 15 s (imágenes) a 1–4 min (vídeos). Si hay mucha gente usando el modelo, entras en cola.
- **Duración:** Wan 2.2 hasta 5 s, LTX‑2.3 hasta 10 s, LTX‑Video hasta 8 s.
- **Cuota:** la cuota de GPU se recarga cada día. Si se agota, la app te lo dice. Mientras tanto puedes usar Pollinations (imágenes sin cuota) y el editor de fotos.
- La calidad es muy buena, pero no llega al nivel de los servicios de pago más avanzados.
- Los archivos generados se guardan en la carpeta `outputs/`.

## Si un modelo deja de funcionar

Los modelos son *Spaces* públicos de Hugging Face. Si alguno cambia o lo retiran, edita el bloque `SPACES` al principio de `server.js` y pon otro Space equivalente. Puedes buscarlos en https://huggingface.co/spaces.

## Estructura

```
server.js         Servidor + cola de trabajos (Hugging Face / Pollinations)
public/index.html Interfaz
public/app.js     Lógica: vídeo, imagen, edición IA, editor manual, galería
public/models.js  Catálogo de modelos y opciones
public/styles.css Estilos
outputs/          Tus vídeos e imágenes generados
```
