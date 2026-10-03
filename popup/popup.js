const $ = (id) => document.getElementById(id);
const els = {
  theme: $("theme"), play: $("play"), speed: $("speed"), speedOut: $("speedOut"),
  direction: $("direction"), status: $("status"),
  record: $("record"), recHint: $("recHint"),
};
const settings = { speed: 120, direction: 1 };
let running = false;
let tabId = null;
let injected = false; // evita reinjetar o script a cada movimento do slider

/* ---------- Tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.theme.textContent = theme === "dark" ? "☀️" : "🌙"; // mostra o tema para o qual vai trocar
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
const send = (msg) => chrome.tabs.sendMessage(tabId, { target: "scroller", ...msg });

function render() {
  els.play.textContent = running ? "⏸ Pausar scroll" : "▶ Iniciar scroll";
  els.speed.value = settings.speed;
  els.speedOut.textContent = settings.speed;
  els.direction.textContent = settings.direction === 1 ? "⬇ Descer" : "⬆ Subir";
}

// Garante o script na página e envia as configurações atuais. Retorna o estado, ou undefined se a página não permite.
async function applySettings() {
  try {
    await ensureScroller();
    els.status.textContent = "";
    return await send({ type: "configure", ...settings });
  } catch {
    els.status.textContent = "Não é possível controlar esta página (ex.: chrome:// ou Chrome Web Store).";
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
  if (running) applySettings();
});

// Atalhos de velocidade: ajustam e já começam a rolar.
document.querySelectorAll(".presets button").forEach((b) =>
  b.addEventListener("click", () => {
    settings.speed = Number(b.dataset.speed);
    render();
    setRunning(true);
  })
);
els.direction.addEventListener("click", () => {
  settings.direction *= -1;
  render();
  if (running) applySettings();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "scroll-stopped") { running = false; render(); }
});

/* ---------- Gravação ---------- */
let rec = { phase: "idle" };
let notice = null; // { error } ou { saved }: fica na tela até iniciar outra gravação
const PHASE_TEXT = {
  picking: "Escolha o que gravar na janela do Chrome…",
  countdown: "Prepare-se… a gravação já vai começar.",
  recording: "● Gravando. O vídeo é salvo quando o scroll chegar ao fim.",
  saving: "Salvando o vídeo…",
};

function setRec(next) {
  rec = next ?? { phase: "idle" };
  if (rec.error || rec.saved) notice = { error: rec.error, saved: rec.saved };
  else if (rec.phase !== "idle") notice = null;
  renderRecording();
}

function renderRecording() {
  const busy = rec.phase !== "idle";
  const recording = rec.phase === "recording";
  els.record.textContent = recording ? "⏹ Parar e salvar" : "⏺ Gravar e rolar";
  els.record.classList.toggle("stop", recording);
  els.record.disabled = busy && !recording;
  els.play.disabled = busy;
  els.recHint.hidden = busy;
  els.status.classList.toggle("error", !busy && Boolean(notice?.error));
  if (!busy && notice?.error) els.status.textContent = notice.error;
  else if (!busy && notice?.saved) els.status.textContent = `✓ Salvo em Downloads: ${notice.saved}`;
  else if (busy) {
    const webm = rec.ext === "webm" ? " (Seu Chrome não suporta MP4 H.264: salvando em WebM.)" : "";
    els.status.textContent = (PHASE_TEXT[rec.phase] ?? "") + (recording ? webm : "");
  } else if (!els.status.textContent.startsWith("Não é possível")) els.status.textContent = "";
}

els.record.addEventListener("click", async () => {
  if (rec.phase === "recording") {
    await chrome.runtime.sendMessage({ target: "background", type: "record-stop" });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.runtime.sendMessage({
    target: "background", type: "record-start",
    tabId: tab.id, speed: settings.speed, direction: settings.direction,
  });
  window.close(); // o seletor de tela do Chrome abre por cima; o popup não é mais necessário
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
  try {
    const res = await send({ type: "configure" }); // só funciona se o script já estiver injetado
    Object.assign(settings, { speed: res.speed, direction: res.direction });
    injected = true;
    running = res.running;
  } catch { /* script ainda não injetado: usa os padrões */ }
  render();
  setRec((await chrome.storage.session.get("rec")).rec);
  if (rec.error || rec.saved) chrome.runtime.sendMessage({ target: "background", type: "clear-notice" }); // mostra uma vez só
})();
