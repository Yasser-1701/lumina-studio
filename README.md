# ✦ Lumina Studio — App de IA 100 % gratis

### 👉 Abrir la app: **https://yasser-1701.github.io/lumina-studio/**

Crea **vídeos con IA**, genera **imágenes** y **edita fotos** desde el móvil o el ordenador.
Gratis, sin tarjeta y sin cuenta.

## 📲 Instalarla como app en el móvil

**Android (Chrome):** abre el enlace, pulsa **«📲 Instalar app»** arriba (o el menú ⋮ → *Instalar aplicación*).

**iPhone (Safari):** abre el enlace, pulsa el botón **Compartir** ⬆️ → **«Añadir a pantalla de inicio»**.

**Ordenador (Chrome/Edge):** pulsa el icono de instalar en la barra de direcciones.

La app aparece con su icono, se abre a pantalla completa y el editor de fotos funciona sin conexión.

## Qué puedes hacer

| Función | Modelo (gratis) |
|---|---|
| 🎬 Imagen → Vídeo | **Wan 2.2**, **LTX‑2.3** (¡con audio!), LTX‑Video |
| 🎬 Texto → Vídeo | LTX‑Video directo, o FLUX + Wan 2.2 / LTX‑2.3 |
| 🖼️ Texto → Imagen | **FLUX.1 Schnell**, **FLUX.1 Krea**, Pollinations |
| ✨ Editar con una frase | **FLUX.1 Kontext** («ponle una bufanda roja», «cambia el fondo»…) |
| ✂️ Quitar fondo | BiRefNet (PNG transparente) |
| 🎚️ Retocar | Filtros, brillo, contraste, temperatura, viñeta, recortes, giro y texto |
| 📁 Galería | Todo se guarda en tu dispositivo |

Puedes escribir en español: los prompts se traducen al inglés automáticamente.

## 🖥️ Usar tu propia GPU (Windows, gratis y sin límites)

Genera imágenes en tu ordenador con **Z‑Image‑Turbo**, sin cuota y sin internet para generar.
Funciona con tarjetas **AMD, NVIDIA o Intel de 6 GB o más** (usa Vulkan, vía [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)).

1. En la app pulsa **«🖥️ Mi GPU»** → **«Instalar Lumina Local (Windows)»**
   (o descarga [`instalar-lumina-local.bat`](https://yasser-1701.github.io/lumina-studio/local/instalar-lumina-local.bat)).
2. Ábrelo con doble clic. Si sale «Windows protegió su PC»: **Más información → Ejecutar de todas formas**.
3. Descarga ~7 GB la primera vez (si se corta, vuelve a abrirlo y continúa).
4. Usa el icono **«Lumina Local»** del escritorio: arranca tu GPU y abre la app conectada.
   En la pestaña Imagen elige **«🖥️ Mi GPU · Z‑Image‑Turbo»**.

Se instala en `%LOCALAPPDATA%\LuminaLocal` (sin permisos de administrador). Para quitarlo, usa
«Desinstalar Lumina Local.bat» de esa carpeta. Los vídeos siguen en la nube gratuita: una gráfica de 8 GB no da para vídeo.

## ⚙️ Más cuota (gratis)

Los modelos usan GPUs gratuitas de Hugging Face, con una cuota diaria. Si se agota:

1. Crea una cuenta gratis en https://huggingface.co/join
2. Crea un token en https://huggingface.co/settings/tokens/new?tokenType=read
3. En la app pulsa **«⚙️ Más cuota»** (arriba a la derecha) y pégalo.

El token se guarda solo en tu dispositivo.

## Límites (es gratis)

- Imágenes: ~15 s. Vídeos: 1–4 min (puede haber cola).
- Vídeos de hasta 5 s (Wan 2.2), 8 s (LTX‑Video) o 10 s (LTX‑2.3).
- Pollinations: 1 imagen cada ~45 s (la app espera sola).

## Para desarrolladores

La app es 100 % estática (HTML + JS) y está en la carpeta `docs/`, publicada con GitHub Pages.
Para usarla en local: `npm start` y abre http://localhost:3000. No necesita `npm install`.

```
docs/index.html   Interfaz
docs/app.js       Lógica de la interfaz, editor de fotos y galería
docs/engine.js    Motor de IA (Hugging Face Spaces + Pollinations) — cambia aquí los modelos (SPACES)
docs/models.js    Catálogo de modelos y opciones
docs/sw.js        Service worker (app instalable / offline)
```
