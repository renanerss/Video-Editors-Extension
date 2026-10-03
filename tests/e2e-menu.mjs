// Menu do botão direito no ícone: grava com o padrão salvo e vira "Parar" enquanto grava.
// O menu nativo não é clicável pelo Playwright: chamamos o mesmo handler dentro do service worker.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, phase, waitPhase, setOptions, lastDownload } = T;
const sw = () => T.ctx.serviceWorkers().find((w) => w.url().includes(T.extId));

const { target, popup } = await session(`${T.base}/short`);
await setOptions(popup, { quality: { resolution: "native", fps: 30, bitrate: "light", format: "webm" } });
const tabId = await popup.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/*" }))[0]?.id ?? (await chrome.tabs.query({})).find((t) => t.url.startsWith("http://localhost"))?.id);
const worker = sw();

// Registra cada atualização do título do menu.
await worker.evaluate(() => {
  globalThis.__titles = [];
  const orig = chrome.contextMenus.update.bind(chrome.contextMenus);
  chrome.contextMenus.update = (id, props) => { globalThis.__titles.push([props.title, props.enabled]); return orig(id, props); };
});
const titles = () => worker.evaluate(() => globalThis.__titles);
const click = () => worker.evaluate((id) => onMenuClick({ menuItemId: "toggle-recording" }, { id }), tabId);

// O item foi criado no ícone (recriar com o mesmo id falha por duplicidade)
const dup = await worker.evaluate(() => new Promise((res) => {
  chrome.contextMenus.create({ id: "toggle-recording", title: "x", contexts: ["action"] }, () => res(chrome.runtime.lastError?.message ?? "criou de novo"));
}));
check("item do menu existe no ícone da extensão", /duplicate/i.test(dup), dup);

// Clicar com outro id não faz nada
await worker.evaluate((id) => onMenuClick({ menuItemId: "outro" }, { id }), tabId);
check("item desconhecido é ignorado", (await phase(popup)).phase === "idle");

// 1) Ocioso -> clique inicia a gravação com as opções salvas
await click();
const live = await waitPhase(popup, "recording");
check("clique no menu inicia a gravação", live.phase === "recording");
check("sem nada salvo, usa 120 px/s descendo", live.speed === 120 && live.direction === 1, `${live.speed}/${live.direction}`);
check("usa a qualidade salva (WebM, 30 fps, Leve)", live.ext === "webm" && live.bitrate === "light", `${live.ext}/${live.bitrate}`);
const t = await titles();
check("menu vira 'Parar gravação'", t.some(([title, on]) => title === "Parar gravação" && on), JSON.stringify(t.slice(-3)));

// 2) Gravando -> clique para e salva
await target.waitForTimeout(1500);
await click();
const done = await waitPhase(popup, "idle", 30000);
check("clique durante a gravação para e salva", Boolean(done.saved) && !done.error, done.saved ?? JSON.stringify(done));
const t2 = await titles();
check("menu volta a 'Gravar e rolar'", t2.at(-1)?.[0] === "Gravar e rolar (padrão)" && t2.at(-1)?.[1] === true, JSON.stringify(t2.at(-1)));
const dl = await lastDownload(popup);
check("arquivo existe e não está vazio", T.fs.existsSync(dl.filename) && T.fs.statSync(dl.filename).size > 10000);

// 3) Durante fases intermediárias o item fica desabilitado
check("durante 'salvando' o item fica desabilitado", t2.some(([title, on]) => /Salvando/.test(title) && on === false), JSON.stringify(t2));

// 4) Duração inválida salva no storage: erro em vez de gravar
await setOptions(popup, { durationSec: 2 });
await click();
await popup.waitForTimeout(500);
const r = await phase(popup);
check("duração < 3 s não grava e mostra erro", r.phase === "idle" && /mínima/.test(r.error ?? ""), JSON.stringify(r));

// 4b) Velocidade e direção: o que o popup salva é o que o menu usa
await popup.reload();
await T.setSpeed(popup, 300);
await popup.check("#dirDown");
const saved = await popup.evaluate(async () => (await chrome.storage.local.get("scrollSettings")).scrollSettings);
check("popup salva velocidade e direção", saved?.speed === 300 && saved?.direction === 1, JSON.stringify(saved));
await popup.reload();
check("popup reabre com a velocidade salva", (await popup.inputValue("#speed")) === "300");
await popup.evaluate(() => chrome.storage.local.set({ scrollSettings: { speed: 400, direction: 1 } }));
await setOptions(popup, { durationSec: 4, quality: { format: "webm" } });
await click();
const lv = await waitPhase(popup, "recording");
check("menu usa a última velocidade salva", lv.speed === 400, String(lv.speed));
await waitPhase(popup, "idle", 40000);

// 4c) Atalho de teclado: mesmo comportamento do menu (inicia e, gravando, para)
const manifest = await popup.evaluate(() => chrome.runtime.getManifest().commands);
check("atalho declarado no manifest (Alt+Shift+R)", manifest?.["toggle-recording"]?.suggested_key?.default === "Alt+Shift+R", JSON.stringify(manifest));
const key = () => worker.evaluate((id) => onCommand("toggle-recording", { id }), tabId);
await worker.evaluate((id) => onCommand("outro-comando", { id }), tabId);
check("comando desconhecido é ignorado", (await phase(popup)).phase === "idle");
await setOptions(popup, { durationSec: 0, quality: { format: "webm" } });
await key();
await waitPhase(popup, "recording");
check("atalho inicia a gravação", true);
await target.waitForTimeout(1200);
await key();
const kd = await waitPhase(popup, "idle", 30000);
check("atalho durante a gravação para e salva", Boolean(kd.saved) && !kd.error, kd.saved ?? JSON.stringify(kd));

// 5) Respeita 'duração' salva
await setOptions(popup, { durationSec: 5, quality: { format: "webm" } });
await click();
await waitPhase(popup, "recording");
const d2 = await waitPhase(popup, "idle", 40000);
const len = T.lastPtsSeconds((await lastDownload(popup)).filename);
check("respeita a duração salva (~5 s)", len > 4.2 && len < 6.2, `(${len.toFixed(2)} s)`);
check("sem erro", !d2.error);

await T.finish();
