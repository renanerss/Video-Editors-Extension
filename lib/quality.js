// Opções de qualidade do vídeo: valores válidos, padrões e normalização.
// Usado pelo popup (para montar os controles) e pelo gravador (para validar o que veio salvo).
const Quality = (() => {
  const FPS = [24, 30, 60];
  const BITRATES = { high: 50, medium: 25, light: 10 }; // Mbps
  const RESOLUTIONS = { native: null, 2160: 2160, 1440: 1440, 1080: 1080, 720: 720 }; // altura (lado menor) de saída
  const FORMATS = ["mp4", "webm"];
  const DEFAULTS = { resolution: "native", fps: 60, bitrate: "high", format: "mp4" };

  // Aceita qualquer coisa vinda do storage e devolve sempre um objeto válido.
  function normalize(raw = {}) {
    const fps = Number(raw.fps);
    return {
      resolution: String(raw.resolution) in RESOLUTIONS ? String(raw.resolution) : DEFAULTS.resolution,
      fps: FPS.includes(fps) ? fps : DEFAULTS.fps,
      bitrate: raw.bitrate in BITRATES ? raw.bitrate : DEFAULTS.bitrate,
      format: FORMATS.includes(raw.format) ? raw.format : DEFAULTS.format,
    };
  }

  // Tamanho de saída: o LADO MENOR vira `target` (1080p em tela 16:9 ou em janela vertical),
  // mantendo a proporção. Nunca aumenta além da fonte (esticar só gasta bitrate).
  function outputSize(srcW, srcH, resolution) {
    const target = RESOLUTIONS[resolution];
    const short = Math.min(srcW, srcH);
    if (!target || target >= short) return { width: srcW, height: srcH, scaled: false };
    const k = target / short;
    const even = (n) => Math.max(2, Math.round(n / 2) * 2); // H.264 exige dimensões pares
    return { width: even(srcW * k), height: even(srcH * k), scaled: true };
  }

  return { FPS, BITRATES, RESOLUTIONS, FORMATS, DEFAULTS, normalize, outputSize };
})();
