// Orquestra a gravação: popup -> seletor de tela -> contagem -> gravar + rolar -> salvar.
// O service worker pode "dormir" a qualquer momento, então o estado fica em chrome.storage.session
// e o fluxo avança por eventos (mensagens), nunca esperando algo demorado em memória.

const OFFSCREEN_URL = "offscreen/offscreen.html";
const COUNTDOWN_S = 3;
const PRE_ROLL_MS = 500;   // grava um pouco parado antes de rolar (margem para o editor cortar)
const POST_ROLL_MS = 1000; // e um pouco depois de chegar ao fim

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabSend = (tabId, msg) => chrome.tabs.sendMessage(tabId, { target: "scroller", ...msg });
const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg });

let finishing = false;

/* ---------- Estado (visível ao popup via storage.onChanged) ---------- */
const BADGES = {
  idle: ["", "#000000"], picking: ["…", "#6b7280"], countdown: ["3", "#d97706"],
  recording: ["REC", "#dc2626"], saving: ["…", "#4f46e5"], unsaved: ["!", "#dc2626"],
};
const getRec = async () => (await chrome.storage.session.get("rec")).rec ?? { phase: "idle" };
async function setRec(rec) {
  await chrome.storage.session.set({ rec });
  updateMenu(rec.phase);
  const [text, color] = rec.error ? ["!", "#dc2626"] : BADGES[rec.phase];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

/* ---------- Menu do botão direito no ícone (fixado ou não) ---------- */
const MENU_ID = "toggle-recording";
const MENU_BY_PHASE = {
  idle: ["Gravar e rolar (padrão)", true],
  recording: ["Parar gravação", true],
  picking: ["Escolhendo o que gravar…", false],
  countdown: ["Preparando…", false],
  saving: ["Salvando o vídeo…", false],
  unsaved: ["Vídeo não salvo — abra a extensão", false],
};
function updateMenu(phase) {
  const [title, enabled] = MENU_BY_PHASE[phase] ?? MENU_BY_PHASE.idle;
  chrome.contextMenus.update(MENU_ID, { title, enabled }).catch(() => {}); // ainda não criado: ok
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_ID, title: MENU_BY_PHASE.idle[0], contexts: ["action"] });
  updateMenu((await getRec()).phase);
});

// "Padrão" = o que está salvo no popup: duração, começar do topo, qualidade, velocidade e direção.
const DEFAULT_SCROLL = { speed: 120, direction: 1, ease: false };
// Menu e atalho fazem a mesma coisa: ocioso grava com o padrão; gravando, para.
async function toggleRecording(tab) {
  const rec = await getRec();
  if (rec.phase === "recording") return stopRecording();
  if (rec.phase !== "idle") return;
  if (!tab?.id) tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id) return;
  const { durationSec = 0, startAtTop = false } = await getSettings();
  if (durationSec && durationSec < 3) return setRec({ phase: "idle", error: "A duração mínima é de 3 segundos. Ajuste no popup." });
  const { scrollSettings } = await chrome.storage.local.get("scrollSettings");
  const { speed, direction, ease } = { ...DEFAULT_SCROLL, ...scrollSettings };
  await startRecording({ tabId: tab.id, speed, direction, ease, durationSec, startAtTop });
}
const onMenuClick = (info, tab) => info.menuItemId === MENU_ID && toggleRecording(tab);
const onCommand = (command, tab) => command === MENU_ID && toggleRecording(tab);
chrome.contextMenus.onClicked.addListener(onMenuClick);
chrome.commands.onCommand.addListener(onCommand); // atalho: Alt+Shift+R (mudável em chrome://extensions/shortcuts)

// Tempo no ícone enquanto grava (m:ss; passando de 10 min, só os minutos: o selo comporta ~4 caracteres).
function clockText(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m >= 10 ? `${m}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
}
// O gravador avisa a cada pedaço (~1 s). O tamanho vai para uma chave própria, para não
// disparar todo o fluxo de estado (setRec) por segundo.
async function onProgress(bytes) {
  const rec = await getRec();
  if (rec.phase !== "recording" || !rec.startedAt) return;
  await chrome.storage.session.set({ recProgress: { bytes, at: Date.now() } });
  await chrome.action.setBadgeText({ text: clockText(Date.now() - rec.startedAt) });
}

/* ---------- Offscreen ---------- */
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DISPLAY_MEDIA"],
    justification: "Capturar a tela e gravar o vídeo enquanto a página rola.",
  });
}
const closeOffscreen = () => chrome.offscreen.closeDocument().catch(() => {});

async function reset(extra = {}) {
  await chrome.storage.session.remove("recProgress");
  await setRec({ phase: "idle", ...extra });
  await closeOffscreen();
}

async function abort(message) {
  await toOffscreen({ type: "discard" }).catch(() => {});
  await reset({ error: message });
}

/* ---------- Fluxo ---------- */
async function startRecording({ tabId, speed, direction, ease, durationSec, startAtTop }) {
  if ((await getRec()).phase !== "idle") return { ok: false };
  const { quality } = await getSettings();
  await setRec({ phase: "picking", tabId, speed, direction, ease: Boolean(ease), durationSec: durationSec || 0, startAtTop: Boolean(startAtTop) });
  try {
    await ensureOffscreen();
    await toOffscreen({ type: "acquire", quality });
  } catch (e) {
    await abort(e.message);
  }
  return { ok: true };
}

async function onAcquired(info) {
  let rec = await getRec();
  if (rec.phase !== "picking") return;
  rec = { ...rec, phase: "countdown", ...info };
  await setRec(rec);
  try {
    await chrome.scripting.executeScript({ target: { tabId: rec.tabId }, files: ["content/scroller.js"] });
    await tabSend(rec.tabId, { type: "configure", speed: rec.speed, direction: rec.direction, ease: rec.ease });
    if (rec.startAtTop) await tabSend(rec.tabId, { type: "scrollToTop" }); // antes da contagem: ela já aparece no topo
    await tabSend(rec.tabId, { type: "countdown", seconds: COUNTDOWN_S }); // responde quando termina e some da tela
    const r = await toOffscreen({ type: "start" });
    if (!r?.ok) throw new Error(r?.error ?? "Falha ao iniciar o gravador.");
  } catch (e) {
    return abort(`Não foi possível iniciar: ${e.message}`);
  }
  await setRec({ ...rec, phase: "recording", startedAt: Date.now() });
  await sleep(PRE_ROLL_MS);
  // Com duração, o vídeo todo dura ~N s: o scroll cobre N menos as margens (antes e depois).
  const durationMs = rec.durationSec ? Math.max(rec.durationSec * 1000 - PRE_ROLL_MS - POST_ROLL_MS, 300) : undefined;
  tabSend(rec.tabId, { type: "start", durationMs }).catch((e) => abort(e.message));
}

async function stopRecording() {
  const rec = await getRec();
  if (rec.phase !== "recording") return;
  await tabSend(rec.tabId, { type: "stop" }).catch(() => {});
  await finish(300);
}

async function finish(delayMs) {
  if (finishing) return;
  finishing = true;
  try {
    const rec = await getRec();
    if (rec.phase !== "recording") return;
    await setRec({ ...rec, phase: "saving" });
    await sleep(delayMs);
    const r = await toOffscreen({ type: "stop" });
    if (!r?.ok) throw new Error(r?.error ?? "Falha ao finalizar a gravação.");
    const file = { url: r.url, name: r.name, ext: r.ext };
    // A gravação já existe: qualquer falha daqui em diante não pode descartá-la.
    await deliver(file).catch((e) => setRec({ phase: "unsaved", ...file, error: e.message }));
  } catch (e) {
    await abort(e.message);
  } finally {
    finishing = false;
  }
}

const pad = (n) => String(n).padStart(2, "0");
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
async function getSettings() {
  const { recSettings = {} } = await chrome.storage.local.get("recSettings");
  return recSettings; // { durationSec, askEveryTime, folderName }
}

// Entrega o vídeo pronto. Depois que a gravação existe, NADA aqui pode descartá-la:
// qualquer falha vira "unsaved", e o usuário decide entre salvar de novo e descartar.
async function deliver(file) {
  const { askEveryTime = false, folderName = null } = await getSettings();
  const filename = `scroll-${stamp()}.${file.ext}`;
  let note;

  if (!askEveryTime && folderName) {
    const r = await toOffscreen({ type: "save-to-folder", name: file.name, filename }).catch((e) => ({ ok: false, error: e.message }));
    if (r?.ok) {
      await toOffscreen({ type: "discard", name: file.name }).catch(() => {});
      return reset({ saved: `${folderName}/${r.filename}` });
    }
    note = `${r?.error ?? "Falha ao salvar na pasta."} Salvei em Downloads.`;
  }

  try {
    const downloadId = await chrome.downloads.download({ url: file.url, filename, saveAs: askEveryTime });
    await setRec({ phase: "saving", downloadId, ...file, note });
  } catch (e) {
    const canceled = /cancel/i.test(e.message);
    await setRec({ phase: "unsaved", ...file, error: canceled ? "Você cancelou o salvamento. O vídeo ainda está guardado." : e.message });
  }
}

async function onScrollStopped(tabId) {
  const rec = await getRec();
  if (rec.phase === "recording" && tabId === rec.tabId) finish(POST_ROLL_MS);
}

// Download terminou: limpa o arquivo temporário e volta ao estado inicial.
chrome.downloads.onChanged.addListener(async (delta) => {
  const rec = await getRec();
  if (rec.phase !== "saving" || delta.id !== rec.downloadId || !delta.state) return;
  const state = delta.state.current;
  if (state !== "complete" && state !== "interrupted") return;
  let saved;
  if (state === "complete") {
    const [item] = await chrome.downloads.search({ id: delta.id });
    saved = item?.filename?.split(/[\\/]/).pop();
  }
  if (state === "interrupted") {
    // Não descarta: o arquivo temporário continua e dá para tentar de novo.
    await setRec({ phase: "unsaved", url: rec.url, name: rec.name, ext: rec.ext, error: "O download foi interrompido. O vídeo ainda está guardado." });
    return;
  }
  await toOffscreen({ type: "discard", name: rec.name }).catch(() => {});
  await reset({ saved, note: rec.note });
});

/* ---------- Mensagens ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "scroll-stopped") { onScrollStopped(sender.tab?.id); return; } // vem da página
  if (msg?.target !== "background") return;

  switch (msg.type) {
    case "record-start": startRecording(msg).then(sendResponse); return true;
    case "record-stop":
      stopRecording().then(() => sendResponse({ ok: true }));
      return true;
    case "progress": onProgress(msg.bytes); break;
    case "acquired": onAcquired(msg); break;
    case "acquire-failed":
      // "NotAllowedError" = você cancelou o seletor: não é erro, só volta ao início.
      reset(msg.name === "NotAllowedError" ? {} : { error: msg.message });
      break;
    case "capture-ended":
      getRec().then(async (rec) => {
        if (rec.phase !== "recording") return;
        await tabSend(rec.tabId, { type: "stop" }).catch(() => {});
        finish(0);
      });
      break;
    case "save-retry":
      getRec().then(async (rec) => {
        if (rec.phase !== "unsaved") return sendResponse({ ok: false });
        await setRec({ phase: "saving", url: rec.url, name: rec.name, ext: rec.ext });
        await deliver({ url: rec.url, name: rec.name, ext: rec.ext });
        sendResponse({ ok: true });
      });
      return true;
    case "save-discard":
      getRec().then(async (rec) => {
        if (rec.phase === "unsaved") {
          await toOffscreen({ type: "discard", name: rec.name }).catch(() => {});
          await reset();
        }
        sendResponse({ ok: true });
      });
      return true;
    case "clear-notice": getRec().then((rec) => rec.phase === "idle" && setRec({ phase: "idle" })); break;
  }
});
