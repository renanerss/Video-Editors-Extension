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
  recording: ["REC", "#dc2626"], saving: ["…", "#4f46e5"],
};
const getRec = async () => (await chrome.storage.session.get("rec")).rec ?? { phase: "idle" };
async function setRec(rec) {
  await chrome.storage.session.set({ rec });
  const [text, color] = rec.error ? ["!", "#dc2626"] : BADGES[rec.phase];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
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
  await setRec({ phase: "idle", ...extra });
  await closeOffscreen();
}

async function abort(message) {
  await toOffscreen({ type: "discard" }).catch(() => {});
  await reset({ error: message });
}

/* ---------- Fluxo ---------- */
async function startRecording({ tabId, speed, direction }) {
  if ((await getRec()).phase !== "idle") return { ok: false };
  await setRec({ phase: "picking", tabId, speed, direction });
  try {
    await ensureOffscreen();
    await toOffscreen({ type: "acquire" });
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
    await tabSend(rec.tabId, { type: "configure", speed: rec.speed, direction: rec.direction });
    await tabSend(rec.tabId, { type: "countdown", seconds: COUNTDOWN_S }); // responde quando termina e some da tela
    const r = await toOffscreen({ type: "start" });
    if (!r?.ok) throw new Error(r?.error ?? "Falha ao iniciar o gravador.");
  } catch (e) {
    return abort(`Não foi possível iniciar: ${e.message}`);
  }
  await setRec({ ...rec, phase: "recording", startedAt: Date.now() });
  await sleep(PRE_ROLL_MS);
  tabSend(rec.tabId, { type: "start" }).catch((e) => abort(e.message));
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
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const downloadId = await chrome.downloads.download({
      url: r.url, filename: `scroll-${stamp}.${r.ext}`, saveAs: false,
    });
    await setRec({ phase: "saving", downloadId, name: r.name, ext: r.ext });
  } catch (e) {
    await abort(e.message);
  } finally {
    finishing = false;
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
  await toOffscreen({ type: "discard", name: rec.name }).catch(() => {});
  await reset(state === "complete" ? { saved } : { error: "O download foi interrompido." });
});

/* ---------- Mensagens ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "scroll-stopped") { onScrollStopped(sender.tab?.id); return; } // vem da página
  if (msg?.target !== "background") return;

  switch (msg.type) {
    case "record-start": startRecording(msg).then(sendResponse); return true;
    case "record-stop":
      getRec().then(async (rec) => {
        if (rec.phase === "recording") {
          await tabSend(rec.tabId, { type: "stop" }).catch(() => {});
          await finish(300);
        }
        sendResponse({ ok: true });
      });
      return true;
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
    case "clear-notice": getRec().then((rec) => rec.phase === "idle" && setRec({ phase: "idle" })); break;
  }
});
