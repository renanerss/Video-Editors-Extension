// Documento invisível que segura a captura de tela e o MediaRecorder.
// Precisa existir porque o service worker do MV3 "dorme" e não tem acesso a getDisplayMedia.
// Os pedaços do vídeo são gravados direto em disco (OPFS), não na memória:
// a 50 Mbps, 10 minutos seriam ~3,7 GB de RAM.

const TIMESLICE_MS = 1000;

// MP4/H.264 abre direto no Premiere/After Effects.
// Sem "video/mp4" genérico de propósito: ele aceita qualquer codec e poderia gerar MP4 com VP9,
// que o Premiere não abre bem. MP4 só se for H.264 (avc1) explícito.
const MP4_CANDIDATES = [
  ["video/mp4;codecs=avc1.640034", "mp4"], // High@5.2 (até 4K60)
  ["video/mp4;codecs=avc1.64002A", "mp4"], // High@4.2 (1080p60)
  ["video/mp4;codecs=avc1", "mp4"],
];
const WEBM_CANDIDATES = [
  ["video/webm;codecs=vp9", "webm"],
  ["video/webm;codecs=vp8", "webm"],
  ["video/webm", "webm"],
];

const captureDisplay = (constraints) => navigator.mediaDevices.getDisplayMedia(constraints);

let stream = null;
let recorder = null;
let writable = null;
let fileHandle = null;
let fileName = null;
let writeChain = Promise.resolve();
let chosen = null; // { mime, ext }
let quality = Quality.normalize();
let pipeline = null; // { stop() } quando o vídeo é redimensionado por canvas
let outStream = null; // o que vai para o MediaRecorder (a captura direta ou o canvas)

const notify = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => {});

// Respeita a escolha do usuário; se o formato pedido não existir neste Chrome, cai para o outro.
function pickFormat(preferred) {
  const order = preferred === "webm" ? [...WEBM_CANDIDATES, ...MP4_CANDIDATES] : [...MP4_CANDIDATES, ...WEBM_CANDIDATES];
  const hit = order.find(([mime]) => MediaRecorder.isTypeSupported(mime));
  return hit ? { mime: hit[0], ext: hit[1] } : null;
}

function releaseStream() {
  pipeline?.stop();
  pipeline = null;
  outStream?.getTracks().forEach((t) => t.stop());
  outStream = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Redimensiona de verdade: cada quadro da captura é desenhado num canvas do tamanho final
// (proporção mantida) e o canvas vira o stream gravado.
function resizePipeline(source, width, height, fps) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false });
  g.imageSmoothingQuality = "high";
  g.fillStyle = "#000"; g.fillRect(0, 0, width, height);
  const draw = (img, vw, vh) => {
    // Janela redimensionada durante a gravação: encaixa sem esticar (faixas pretas).
    const k = Math.min(width / vw, height / vh);
    const w = vw * k, h = vh * k;
    if (w < width || h < height) { g.fillStyle = "#000"; g.fillRect(0, 0, width, height); }
    g.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  };
  const out = canvas.captureStream(fps);
  let alive = true, timer = null, reader = null, video = null;

  if (typeof MediaStreamTrackProcessor !== "undefined") {
    // Lê os quadros direto da captura, no ritmo real da fonte. Um <video> não serviria: este
    // documento é invisível e o navegador não dispara requestVideoFrameCallback nele.
    reader = new MediaStreamTrackProcessor({ track: source.getVideoTracks()[0] }).readable.getReader();
    (async () => {
      while (alive) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        try { draw(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
      }
    })().catch(() => {});
  } else {
    video = document.createElement("video");
    video.muted = true;
    video.srcObject = source;
    video.play().catch(() => {});
    timer = setInterval(() => { if (video.videoWidth) draw(video, video.videoWidth, video.videoHeight); }, 1000 / fps);
  }
  return {
    stream: out,
    stop() {
      alive = false; clearInterval(timer);
      reader?.cancel().catch(() => {});
      if (video) { video.pause(); video.srcObject = null; }
    },
  };
}

async function acquire(options) {
  try {
    quality = Quality.normalize(options);
    chosen = pickFormat(quality.format);
    if (!chosen) throw new Error("Este navegador não suporta gravação de vídeo (MediaRecorder).");
    // "ideal" alto: o navegador entrega a resolução nativa da fonte escolhida (até 4K).
    // O fps pedido vale como teto: a fonte pode entregar menos.
    stream = await captureDisplay({
      video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: quality.fps, max: quality.fps } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    // Botão "Parar compartilhamento" do Chrome: finaliza e salva o que já foi gravado.
    track.addEventListener("ended", () => {
      if (recorder && recorder.state !== "inactive") notify({ type: "capture-ended" });
      else releaseStream();
    });
    const s = track.getSettings();
    const size = Quality.outputSize(s.width, s.height, quality.resolution);
    if (size.scaled) {
      pipeline = resizePipeline(stream, size.width, size.height, quality.fps);
      outStream = pipeline.stream;
    } else {
      outStream = stream; // resolução nativa: nada entre a captura e o gravador
    }
    notify({
      type: "acquired", mime: chosen.mime, ext: chosen.ext,
      width: size.width, height: size.height, fps: Math.min(Math.round(s.frameRate || quality.fps), quality.fps),
      bitrate: quality.bitrate,
    });
  } catch (e) {
    releaseStream();
    notify({ type: "acquire-failed", name: e.name, message: e.message });
  }
}

async function start() {
  try {
    const root = await navigator.storage.getDirectory();
    fileName = `rec-${Date.now()}.${chosen.ext}`;
    fileHandle = await root.getFileHandle(fileName, { create: true });
    writable = await fileHandle.createWritable();
    writeChain = Promise.resolve();
    recorder = new MediaRecorder(outStream, {
      mimeType: chosen.mime, videoBitsPerSecond: Quality.BITRATES[quality.bitrate] * 1_000_000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size) writeChain = writeChain.then(() => writable.write(e.data));
    };
    const started = new Promise((res) => recorder.addEventListener("start", res, { once: true }));
    recorder.start(TIMESLICE_MS);
    await started;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function stop() {
  try {
    if (!recorder || recorder.state === "inactive") throw new Error("Nenhuma gravação em andamento.");
    const stopped = new Promise((res) => recorder.addEventListener("stop", res, { once: true }));
    recorder.stop();
    await stopped;
    await writeChain;
    await writable.close();
    releaseStream();
    const file = await fileHandle.getFile();
    return { ok: true, url: URL.createObjectURL(file), name: fileName, ext: chosen.ext, size: file.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function discard(name) {
  try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch {}
  try { await writable?.abort(); } catch {}
  releaseStream();
  recorder = null; writable = null;
  const target = name ?? fileName;
  if (target) {
    try { await (await navigator.storage.getDirectory()).removeEntry(target); } catch {}
  }
  fileName = null; fileHandle = null;
}

// Copia a gravação (do OPFS) para a pasta escolhida pelo usuário, sem passar pela memória.
async function uniqueName(dir, filename) {
  const dot = filename.lastIndexOf(".");
  const [base, ext] = dot < 0 ? [filename, ""] : [filename.slice(0, dot), filename.slice(dot)];
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? filename : `${base} (${i})${ext}`;
    try { await dir.getFileHandle(candidate); } catch (e) {
      if (e.name === "NotFoundError") return candidate; // não existe: pode usar
      throw e;
    }
  }
}

async function saveToFolder(name, filename) {
  let partial = null, dir = null;
  try {
    dir = await FolderStore.load();
    if (!dir) throw new Error("A pasta escolhida não foi encontrada.");
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error("A pasta precisa ser autorizada de novo (abra as opções da extensão).");
    }
    const source = await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
    partial = await uniqueName(dir, filename);
    const out = await (await dir.getFileHandle(partial, { create: true })).createWritable();
    await source.stream().pipeTo(out); // fecha o arquivo ao terminar
    return { ok: true, filename: partial };
  } catch (e) {
    if (partial && dir) { try { await dir.removeEntry(partial); } catch {} }
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  switch (msg.type) {
    case "acquire": acquire(msg.quality); sendResponse({ ok: true }); return; // resposta real vem por evento
    case "start": start().then(sendResponse); return true;
    case "stop": stop().then(sendResponse); return true;
    case "save-to-folder": saveToFolder(msg.name, msg.filename).then(sendResponse); return true;
    case "discard": discard(msg.name).then(() => sendResponse({ ok: true })); return true;
  }
});
