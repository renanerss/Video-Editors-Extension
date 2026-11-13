// Modo "Gravar tela": grava sem rolar a página, sem limite de tempo, e para por botão, atalho ou menu.
// Só a fonte do vídeo é trocada (helpers.mjs); o resto roda de verdade.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, phase, waitPhase, lastDownload, setSpeed } = T;
const swOf = () => T.ctx.serviceWorkers().find((w) => w.url().includes(T.extId));
// O Chromium de teste salva o download com um UUID; então olhamos o nome que a extensão PEDE.
const spyNames = () => swOf().evaluate(() => {
  if (globalThis.__names) return;
  globalThis.__names = [];
  const o = chrome.downloads.download;
  chrome.downloads.download = (opts) => { globalThis.__names.push(opts.filename); return o.call(chrome.downloads, opts); };
});
const lastName = () => swOf().evaluate(() => globalThis.__names.at(-1));

/* ---- 1) Pelo popup: não rola, passa do "tempo" de uma gravação com scroll, para pelo botão ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await spyNames();
  await popup.click("#recordPlain");
  const r = await waitPhase(popup, "recording");
  check("estado guarda o modo 'plain'", r.mode === "plain");
  check("botão 'Gravar e rolar' bloqueado gravando", await popup.$eval("#record", (b) => b.disabled));
  check("botão de gravar tela vira 'Parar e salvar'", (await popup.textContent("#recordPlain")).includes("Parar"));
  await popup.waitForTimeout(8000); // com scroll, 'durationSec' e margens já teriam mexido na página
  check("ainda gravando depois de 8 s (sem limite)", (await phase(popup)).phase === "recording");
  check("página NÃO rolou", (await target.evaluate(() => scrollY)) === 0);
  await popup.click("#recordPlain");
  const done = await waitPhase(popup, "idle", 30000);
  check("salvou", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  const dl = await lastDownload(popup);
  const name = await lastName();
  check("nome pedido começa com 'gravacao-'", /^gravacao-\d{8}-\d{6}\.(mp4|webm)$/.test(name), name);
  const len = T.lastPtsSeconds(dl.filename);
  check("vídeo tem ~8 s (sem pré/pós-roll)", len > 7 && len < 10.5, `(${len.toFixed(2)} s)`);
  check("página continua parada no fim", (await target.evaluate(() => scrollY)) === 0);
  check("arquivo temporário limpo", (await T.opfsKeys(popup)).length === 0);
  await target.close(); await popup.close();
}

/* ---- 2) Atalhos: um inicia (Alt+Shift+T), o outro (Alt+Shift+R) para ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await target.bringToFront();
  await swOf().evaluate(() => onCommand("record-plain"));
  const r = await waitPhase(popup, "recording");
  check("atalho de gravar tela inicia no modo plain", r.mode === "plain");
  await popup.waitForTimeout(1500);
  await swOf().evaluate(() => onCommand("toggle-recording")); // o atalho de rolar para qualquer gravação
  const done = await waitPhase(popup, "idle", 30000);
  check("o outro atalho para a gravação e salva", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  check("página não rolou", (await target.evaluate(() => scrollY)) === 0);
  await target.close(); await popup.close();
}

/* ---- 3) Menu do ícone: rótulos por modo, e parar pelo item ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await target.bringToFront();
  await swOf().evaluate(() => onMenuClick({ menuItemId: "record-plain" }, undefined));
  await waitPhase(popup, "recording");
  await swOf().evaluate(() => onMenuClick({ menuItemId: "record-plain" }, undefined)); // gravando: o mesmo item para
  const done = await waitPhase(popup, "idle", 30000);
  check("item do menu para a gravação", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  await target.close(); await popup.close();
}

/* ---- 4) Modo com scroll continua igual (nome 'scroll-' e a página rola) ---- */
{
  const { target, popup } = await session(`${T.base}/short`);
  await spyNames();
  await setSpeed(popup, 1000);
  await popup.click("#record");
  const r = await waitPhase(popup, "recording");
  check("modo com scroll guarda 'scroll'", r.mode === "scroll");
  check("botão de gravar tela bloqueado no modo scroll", await popup.$eval("#recordPlain", (b) => b.disabled));
  const done = await waitPhase(popup, "idle", 40000);
  const dl = await lastDownload(popup);
  const name = await lastName();
  check("nome pedido começa com 'scroll-'", /^scroll-\d{8}-\d{6}\.(mp4|webm)$/.test(name), name);
  check("a página rolou", (await target.evaluate(() => scrollY)) > 1000);
  check("salvou", Boolean(done.saved));
  await target.close(); await popup.close();
}

await T.finish();
