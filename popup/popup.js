const $ = (id) => document.getElementById(id);
const els = {
  theme: $("theme"), play: $("play"), speed: $("speed"), speedOut: $("speedOut"),
  direction: $("direction"), loop: $("loop"), status: $("status"),
};
const settings = { speed: 120, direction: 1, loop: false };
let running = false;
let tabId = null;

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
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/scroller.js"] });
}
const send = (msg) => chrome.tabs.sendMessage(tabId, { target: "scroller", ...msg });

function render() {
  els.play.textContent = running ? "⏸ Pausar scroll" : "▶ Iniciar scroll";
  els.speed.value = settings.speed;
  els.speedOut.textContent = settings.speed;
  els.direction.textContent = settings.direction === 1 ? "⬇ Descer" : "⬆ Subir";
  els.loop.checked = settings.loop;
}

async function push(extra = {}) {
  try {
    await ensureScroller();
    return await send({ type: "configure", ...settings, ...extra });
  } catch {
    els.status.textContent = "Não é possível controlar esta página (ex.: chrome:// ou Chrome Web Store).";
  }
}

/* ---------- Eventos ---------- */
els.play.addEventListener("click", async () => {
  els.status.textContent = "";
  const ok = await push();
  if (!ok) return;
  const res = await send({ type: running ? "stop" : "start" });
  running = res.running;
  render();
});
els.speed.addEventListener("input", () => {
  settings.speed = Number(els.speed.value);
  render();
  if (tabId !== null) send({ type: "configure", speed: settings.speed }).catch(() => {});
});
document.querySelectorAll(".presets button").forEach((b) =>
  b.addEventListener("click", () => {
    settings.speed = Number(b.dataset.speed);
    render();
    if (tabId !== null) send({ type: "configure", speed: settings.speed }).catch(() => {});
  })
);
els.direction.addEventListener("click", () => {
  settings.direction *= -1;
  render();
  if (tabId !== null) send({ type: "configure", direction: settings.direction }).catch(() => {});
});
els.loop.addEventListener("change", () => {
  settings.loop = els.loop.checked;
  if (tabId !== null) send({ type: "configure", loop: settings.loop }).catch(() => {});
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "scroll-stopped") { running = false; render(); }
});

/* ---------- Início: recupera o estado se o scroll já estiver rodando ---------- */
(async () => {
  await initTheme();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  try {
    const res = await send({ type: "configure" }); // só funciona se o script já estiver injetado
    Object.assign(settings, { speed: res.speed, direction: res.direction, loop: res.loop });
    running = res.running;
  } catch { /* script ainda não injetado: usa os padrões */ }
  render();
})();
