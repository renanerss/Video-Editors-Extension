const $ = (id) => document.getElementById(id);
const els = {
  theme: $("theme"), themeIcon: $("themeIcon"),
  play: $("play"), playIcon: $("playIcon"), playText: $("playText"),
  speed: $("speed"), speedVal: $("speedVal"), dirDown: $("dirDown"), dirUp: $("dirUp"),
  status: $("status"), statusIcon: $("statusIcon"), statusText: $("statusText"),
  record: $("record"), recIcon: $("recIcon"), recText: $("recText"),
  opts: $("opts"), qual: $("qual"), qSummary: $("qSummary"), duration: $("duration"), durHint: $("durHint"),
  qRes: $("qRes"), qFps: $("qFps"), qBit: $("qBit"), qFmt: $("qFmt"), qHint: $("qHint"),
  folderLabel: $("folderLabel"), folderBtn: $("folderBtn"), ask: $("ask"), top: $("top"), ease: $("ease"),
  clock: $("clock"), clockTime: $("clockTime"), clockSize: $("clockSize"),
  unsaved: $("unsaved"), retry: $("retry"), discard: $("discard"), discardText: $("discardText"),
};
const settings = { speed: 120, direction: 1, ease: false };
let running = false;
let tabId = null;
let injected = false; // evita reinjetar o script a cada movimento do slider

const setIcon = (use, name) => use.setAttribute("href", `../ui/icons.svg#${name}`);

/* ---------- Tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "claro" : "escuro";
  setIcon(els.themeIcon, theme === "dark" ? "sun" : "moon"); // mostra o ícone do tema para o qual vai trocar
  els.theme.setAttribute("aria-label", `Mudar para o tema ${next}`);
  els.theme.title = `Tema ${next}`;
}
async function initTheme() {
  const { theme } = await chrome.storage.local.get("theme");
  applyTheme(theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
}
els.theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});

/* ---------- Comunicação com a aba ---------- */
async function ensureScroller() {
  if (tabId === null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
  }
  if (tabId === null) throw new Error("Nenhuma aba ativa.");
  if (injected) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/scroller.js"] });
  injected = true;
}
// Velocidade e direção ficam salvas: o popup reabre como estava e o menu do ícone usa a última escolha.
const saveScroll = () => chrome.storage.local.set({ scrollSettings: { speed: settings.speed, direction: settings.direction, ease: settings.ease } });
const send = (msg) => chrome.tabs.sendMessage(tabId, { target: "scroller", ...msg });

function render() {
  setIcon(els.playIcon, running ? "pause" : "play");
  els.playText.textContent = running ? "Pausar scroll" : "Iniciar scroll";
  els.speed.value = settings.speed;
  els.speedVal.textContent = settings.speed;
  els.speed.setAttribute("aria-valuetext", `${settings.speed} pixels por segundo`);
  const min = Number(els.speed.min), max = Number(els.speed.max);
  els.speed.style.setProperty("--pct", `${((settings.speed - min) / (max - min)) * 100}%`);
  (settings.direction === 1 ? els.dirDown : els.dirUp).checked = true;
  els.ease.checked = settings.ease;
}

// Garante o script na página e envia as configurações atuais. Retorna o estado, ou undefined se a página não permite.
async function applySettings() {
  try {
    await ensureScroller();
    if (notice?.error) { notice = null; renderStatus(); }
    return await send({ type: "configure", ...settings });
  } catch {
    showError("Não é possível controlar esta página (ex.: chrome:// ou Chrome Web Store).");
  }
}

async function setRunning(want) {
  const res = await applySettings();
  if (!res) return;
  if (res.running !== want) running = (await send({ type: want ? "start" : "stop" })).running;
  else running = res.running;
  render();
}

/* ---------- Eventos ---------- */
els.play.addEventListener("click", () => setRunning(!running));

// Slider: a velocidade muda na hora, a cada movimento (evento "input"), sem esperar soltar.
els.speed.addEventListener("input", () => {
  settings.speed = Number(els.speed.value);
  render();
  saveScroll();
  if (running) applySettings();
});

// Atalhos de velocidade: ajustam e já começam a rolar.
document.querySelectorAll(".presets button").forEach((b) =>
  b.addEventListener("click", () => {
    settings.speed = Number(b.dataset.speed);
    render();
    saveScroll();
    setRunning(true);
  })
);
for (const radio of [els.dirDown, els.dirUp]) {
  radio.addEventListener("change", () => {
    settings.direction = Number(radio.value);
    saveScroll();
    if (running) applySettings();
  });
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "scroll-stopped") { running = false; render(); }
});

/* ---------- Gravação ---------- */
let rec = { phase: "idle" };
let notice = null; // { error } ou { saved, note }: fica na tela até iniciar outra gravação
const PHASE_TEXT = {
  picking: "Escolha o que gravar na janela do Chrome…",
  countdown: "Prepare-se: a gravação já vai começar.",
  recording: "Gravando. O vídeo é salvo quando o scroll chegar ao fim.",
  saving: "Salvando o vídeo…",
};

function setRec(next) {
  rec = next ?? { phase: "idle" };
  if (rec.phase === "idle" && (rec.error || rec.saved)) notice = { error: rec.error, saved: rec.saved, note: rec.note };
  else if (rec.phase !== "idle") notice = null;
  renderRecording();
}

/* ---------- Opções de gravação (salvas em chrome.storage.local) ---------- */
let recSettings = { durationSec: null, askEveryTime: false, folderName: null, startAtTop: false, quality: Quality.normalize() };

function renderOptions() {
  els.duration.value = recSettings.durationSec ?? "";
  els.ask.checked = recSettings.askEveryTime;
  els.top.checked = Boolean(recSettings.startAtTop);
  const label = recSettings.askEveryTime ? "Pergunta toda vez" : recSettings.folderName ?? "Downloads";
  els.folderLabel.textContent = label;
  els.folderLabel.title = label;
  els.folderBtn.title = recSettings.askEveryTime
    ? "A pasta escolhida é ignorada enquanto “Perguntar sempre” estiver ligado"
    : "Escolher a pasta de destino";
  const q = Quality.normalize(recSettings.quality);
  els.qRes.value = q.resolution;
  els.qFps.value = String(q.fps);
  els.qBit.value = q.bitrate;
  els.qFmt.value = q.format;
  els.qHint.textContent = qualityHint(q);
  els.qSummary.textContent = `${q.resolution === "native" ? "Nativa" : q.resolution + "p"} · ${q.fps} fps · ${q.format.toUpperCase()}`;
  validateDuration();
}
// Estimativa do tamanho do arquivo: bitrate x duração (ex.: 50 Mbps ≈ 375 MB por minuto).
function qualityHint(q) {
  const mbPerMin = Math.round((Quality.BITRATES[q.bitrate] * 60) / 8);
  return `≈ ${mbPerMin} MB por minuto de vídeo`;
}
const saveOptions = () => chrome.storage.local.set({ recSettings });

// Validação na hora (não só ao clicar em gravar).
function durationInvalid() {
  const raw = els.duration.value;
  if (raw === "") return false;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 3;
}
function validateDuration() {
  const bad = durationInvalid();
  els.duration.setAttribute("aria-invalid", String(bad));
  els.durHint.hidden = !bad;
}
els.duration.addEventListener("input", validateDuration);
els.duration.addEventListener("change", () => {
  const n = Number(els.duration.value);
  recSettings.durationSec = els.duration.value === "" || !Number.isFinite(n) ? null : Math.round(n);
  saveOptions();
});
for (const [el, key, parse] of [
  [els.qRes, "resolution", String], [els.qFps, "fps", Number], [els.qBit, "bitrate", String], [els.qFmt, "format", String],
]) {
  el.addEventListener("change", () => {
    recSettings.quality = Quality.normalize({ ...recSettings.quality, [key]: parse(el.value) });
    saveOptions();
    renderOptions();
  });
}
els.ease.addEventListener("change", () => {
  settings.ease = els.ease.checked;
  saveScroll();
  if (running) applySettings(); // vale já na próxima rolagem; no meio do caminho só afeta o fim
});
els.top.addEventListener("change", () => {
  recSettings.startAtTop = els.top.checked;
  saveOptions();
});
els.ask.addEventListener("change", () => {
  recSettings.askEveryTime = els.ask.checked;
  saveOptions();
  renderOptions();
});
// Sanfona: um painel por vez (o popup do Chrome tem teto de 600 px). Lembra qual ficou aberto.
for (const [panel, other] of [[els.opts, els.qual], [els.qual, els.opts]]) {
  panel.addEventListener("toggle", () => {
    if (panel.open) other.open = false;
    chrome.storage.local.set({ optsOpen: els.opts.open, qualOpen: els.qual.open });
  });
}
// A escolha da pasta fica numa aba de opções: o popup fecha quando um diálogo nativo abre.
els.folderBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recSettings) {
    recSettings = { ...recSettings, ...changes.recSettings.newValue };
    renderOptions();
  }
});

function showError(message) {
  notice = { error: message };
  renderStatus();
}

// Se a pasta escolhida pede autorização, tenta aqui (dentro do clique) ou manda para as opções.
async function folderReady() {
  if (recSettings.askEveryTime || !recSettings.folderName) return true;
  const dir = await FolderStore.load();
  if (!dir) return true; // sem handle: o service worker cai em Downloads e avisa
  const opts = { mode: "readwrite" };
  if ((await dir.queryPermission(opts)) === "granted") return true;
  try { if ((await dir.requestPermission(opts)) === "granted") return true; } catch {}
  chrome.runtime.openOptionsPage();
  showError("A pasta precisa ser autorizada de novo. Autorize na aba que abriu e grave outra vez.");
  return false;
}

// Uma única linha de status: ícone de forma diferente por estado (cor nunca é o único sinal).
function statusView() {
  if (rec.phase === "unsaved") return { state: "error", icon: "alert", text: rec.error ?? "O vídeo ainda não foi salvo." };
  if (rec.phase === "recording") {
    const wanted = Quality.normalize(recSettings.quality).format;
    const fallback = wanted === "mp4" && rec.ext === "webm" ? " Seu Chrome não suporta MP4 H.264, então salvo em WebM." : "";
    const spec = rec.width ? ` ${rec.width}×${rec.height} · ${rec.fps} fps · ${rec.ext.toUpperCase()}.` : "";
    return { state: "recording", icon: "dot", text: PHASE_TEXT.recording + spec + fallback };
  }
  if (rec.phase !== "idle") return { state: "busy", icon: "dot", text: PHASE_TEXT[rec.phase] ?? "" };
  if (notice?.error) return { state: "error", icon: "alert", text: notice.error };
  if (notice?.saved) return { state: "success", icon: "check", text: `Salvo: ${notice.saved}` + (notice.note ? ` (${notice.note})` : "") };
  return { state: "idle", icon: "dot", text: "Pronto. Contagem de 3 s, rola e salva o vídeo." };
}
function renderStatus() {
  const v = statusView();
  els.status.dataset.state = v.state;
  setIcon(els.statusIcon, v.icon);
  els.statusText.textContent = v.text;
}

/* ---------- Cronômetro (tempo decorrido + tamanho do arquivo) ---------- */
let clockTimer = null;
let recBytes = 0;
function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
function formatBytes(b) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`;
}
function tickClock() {
  els.clockTime.textContent = formatClock(Date.now() - (rec.startedAt ?? Date.now()));
  els.clockSize.textContent = recBytes ? formatBytes(recBytes) : "";
}
function syncClock() {
  const on = rec.phase === "recording" && Boolean(rec.startedAt);
  els.clock.hidden = !on;
  if (on && clockTimer === null) clockTimer = setInterval(tickClock, 500);
  if (!on && clockTimer !== null) { clearInterval(clockTimer); clockTimer = null; recBytes = 0; }
  if (on) tickClock();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.recProgress) { recBytes = changes.recProgress.newValue?.bytes ?? 0; if (!els.clock.hidden) tickClock(); }
});

function renderRecording() {
  syncClock();
  const busy = rec.phase !== "idle";
  const recording = rec.phase === "recording";
  els.unsaved.hidden = rec.phase !== "unsaved";
  els.opts.hidden = els.qual.hidden = busy; // desabilitadas de qualquer jeito; liberam espaço (popup do Chrome tem teto de 600 px)
  els.duration.disabled = els.ask.disabled = els.top.disabled = els.ease.disabled = els.folderBtn.disabled = busy;
  for (const el of [els.qRes, els.qFps, els.qBit, els.qFmt]) el.disabled = busy;
  setIcon(els.recIcon, recording ? "stop" : "rec");
  els.recText.textContent = recording ? "Parar e salvar" : "Gravar e rolar";
  els.record.classList.toggle("btn-primary", !recording);
  els.record.classList.toggle("btn-danger", recording);
  els.record.disabled = busy && !recording;
  els.play.disabled = busy;
  renderStatus();
}

els.record.addEventListener("click", async () => {
  if (rec.phase === "recording") {
    await chrome.runtime.sendMessage({ target: "background", type: "record-stop" });
    return;
  }
  const durationSec = recSettings.durationSec ?? 0;
  if (durationInvalid() || (durationSec !== 0 && durationSec < 3)) {
    els.duration.focus();
    return showError("A duração mínima é de 3 segundos.");
  }
  if (recSettings.startAtTop && settings.direction === -1) {
    return showError("Com “Começar do início” e direção “Subir”, o scroll termina na hora. Mude para “Descer” ou desmarque a opção.");
  }
  if (!(await folderReady())) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.runtime.sendMessage({
    target: "background", type: "record-start",
    tabId: tab.id, speed: settings.speed, direction: settings.direction, ease: settings.ease, durationSec,
    startAtTop: Boolean(recSettings.startAtTop),
  });
  window.close(); // o seletor de tela do Chrome abre por cima; o popup não é mais necessário
});

els.retry.addEventListener("click", () => chrome.runtime.sendMessage({ target: "background", type: "save-retry" }));
// Descartar: confirmação em dois cliques no próprio botão (o confirm() nativo é feio e pode fechar o popup).
let discardTimer = null;
function disarmDiscard() {
  clearTimeout(discardTimer);
  discardTimer = null;
  els.discardText.textContent = "Descartar";
}
els.discard.addEventListener("click", () => {
  if (discardTimer === null) {
    els.discardText.textContent = "Confirmar?";
    discardTimer = setTimeout(disarmDiscard, 4000);
    return;
  }
  disarmDiscard();
  chrome.runtime.sendMessage({ target: "background", type: "save-discard" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.rec) return;
  setRec(changes.rec.newValue);
});

/* ---------- Início: recupera o estado se o scroll já estiver rodando ---------- */
(async () => {
  await initTheme();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const { scrollSettings } = await chrome.storage.local.get("scrollSettings");
  if (scrollSettings) Object.assign(settings, scrollSettings);
  try {
    const res = await send({ type: "configure" }); // só funciona se o script já estiver injetado
    injected = true;
    running = res.running;
    // Rodando agora, vale o que a página está fazendo; parado, vale o que ficou salvo.
    if (res.running) Object.assign(settings, { speed: res.speed, direction: res.direction });
  } catch { /* script ainda não injetado: usa o salvo ou os padrões */ }
  render();
  const stored = await chrome.storage.local.get(["recSettings", "optsOpen", "qualOpen"]);
  if (stored.qualOpen) { els.qual.open = true; els.opts.open = false; }
  else if (stored.optsOpen === false) els.opts.open = false;
  recSettings = { ...recSettings, ...stored.recSettings };
  renderOptions();
  recBytes = (await chrome.storage.session.get("recProgress")).recProgress?.bytes ?? 0;
  setRec((await chrome.storage.session.get("rec")).rec);
  if (rec.error || rec.saved) chrome.runtime.sendMessage({ target: "background", type: "clear-notice" }); // mostra uma vez só
})();
