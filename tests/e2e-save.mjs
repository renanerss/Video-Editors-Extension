// Fase 2.1: duração, pasta de destino, "perguntar sempre" e proteção contra perder a gravação.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, reopen, phase, waitPhase, opfsKeys, downloadsCount, lastDownload, setOptions, setSpeed, useFakeFolder } = T;
const swOf = () => T.ctx.serviceWorkers().find((w) => w.url().includes(T.extId));
const record = (popup) => popup.click("#record");

/* ---- 1) Duração: o vídeo todo dura ~N s e o scroll respeita o tempo ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await setOptions(popup, { durationSec: 6 });
  await reopen(popup);
  check("campo de duração mostra o valor salvo", (await popup.inputValue("#duration")) === "6");
  await setSpeed(popup, 200);
  await record(popup);
  await waitPhase(popup, "recording");
  const done = await waitPhase(popup, "idle", 40000);
  const y = await target.evaluate(() => scrollY);
  const file = (await lastDownload(popup)).filename;
  const len = T.lastPtsSeconds(file);
  check("vídeo dura ~6 s", len > 5.2 && len < 7.0, `(${len.toFixed(2)} s)`);
  check("scroll cobre 6 s menos margens (~900 px a 200 px/s)", y > 650 && y < 1150, `(${y} px)`);
  check("salvou", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  await target.close(); await popup.close();
}

/* ---- 2) Duração inválida (< 3 s) é recusada sem iniciar nada ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await setOptions(popup, { durationSec: 2 });
  await reopen(popup);
  await record(popup);
  await popup.waitForTimeout(500);
  check("duração < 3 s mostra erro", (await popup.textContent("#status")).includes("mínima"));
  check("e não inicia gravação", (await phase(popup)).phase === "idle");
  await target.close(); await popup.close();
}

/* ---- 3) Pasta escolhida: o arquivo vai para lá, não para Downloads ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await useFakeFolder(popup, "saida");
  await setOptions(popup, { durationSec: 4, folderName: "saida" });
  await reopen(popup);
  check("popup mostra o nome da pasta", (await popup.textContent("#folderLabel")) === "saida");
  const before = await downloadsCount(popup);
  await setSpeed(popup, 300);
  await record(popup);
  await waitPhase(popup, "recording"); // senão "idle" (estado de antes do clique) seria lido cedo demais
  const done = await waitPhase(popup, "idle", 40000);
  const info = await popup.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("saida");
    const out = [];
    for await (const [name, h] of dir.entries()) out.push({ name, size: (await h.getFile()).size });
    return out;
  });
  check("arquivo caiu na pasta escolhida", info.length === 1 && /^scroll-\d{8}-\d{6}\.webm$/.test(info[0].name), JSON.stringify(info));
  check("arquivo não está vazio", (info[0]?.size ?? 0) > 20000);
  check("aviso mostra pasta/arquivo", /^saida\/scroll-/.test(done.saved ?? ""), done.saved);
  check("nada foi para Downloads", (await downloadsCount(popup)) === before);
  check("temporário (OPFS) limpo", (await opfsKeys(popup)).every((k) => !k.startsWith("rec-")), JSON.stringify(await opfsKeys(popup)));
  await target.close(); await popup.close();
}

/* ---- 4) Pasta sumiu/sem autorização: cai em Downloads COM aviso, sem perder o vídeo ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await popup.evaluate(() => FolderStore.clear()); // folderName continua salvo, mas o handle não existe mais
  await setOptions(popup, { durationSec: 4, folderName: "saida" });
  await reopen(popup);
  const before = await downloadsCount(popup);
  await setSpeed(popup, 300);
  await record(popup);
  await waitPhase(popup, "recording"); // senão "idle" (estado de antes do clique) seria lido cedo demais
  const done = await waitPhase(popup, "idle", 40000);
  check("fallback salvou em Downloads", (await downloadsCount(popup)) === before + 1);
  await reopen(popup);
  const status = await popup.textContent("#status");
  check("popup explica o fallback", /Salvei em Downloads/.test(status), status);
  await target.close(); await popup.close();
}

/* ---- 5) "Perguntar sempre": pede saveAs; cancelar NÃO perde o vídeo ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await setOptions(popup, { durationSec: 4, askEveryTime: true, folderName: "saida" });
  await reopen(popup);
  check("com 'perguntar sempre' o rótulo muda", (await popup.textContent("#folderLabel")) === "Pergunta toda vez");
  const sw = swOf();
  await sw.evaluate(() => {
    globalThis.__origDownload = chrome.downloads.download; // para restaurar depois dos testes com stub
    const orig = chrome.downloads.download.bind(chrome.downloads);
    globalThis.__calls = []; globalThis.__mode = "cancel";
    chrome.downloads.download = async (o) => {
      globalThis.__calls.push({ saveAs: o.saveAs });
      if (globalThis.__mode === "cancel") throw new Error("Download canceled by the user");
      return orig({ ...o, saveAs: false }); // o diálogo nativo não existe em teste
    };
  });
  await setSpeed(popup, 300);
  await record(popup);
  const unsaved = await waitPhase(popup, "unsaved", 40000);
  check("pediu o diálogo 'Salvar como' (saveAs: true)", (await sw.evaluate(() => __calls))[0]?.saveAs === true);
  check("cancelar não descarta: arquivo ainda guardado", (await opfsKeys(popup)).some((k) => k === unsaved.name), JSON.stringify(await opfsKeys(popup)));
  check("popup mostra Salvar de novo/Descartar", await popup.isVisible("#retry") && await popup.isVisible("#discard"));
  check("nova gravação bloqueada enquanto não resolver", await popup.$eval("#record", (b) => b.disabled));

  await sw.evaluate(() => { globalThis.__mode = "pass"; });
  await popup.click("#retry");
  const done = await waitPhase(popup, "idle", 30000);
  const calls = await sw.evaluate(() => __calls);
  check("'Salvar de novo' pede o diálogo outra vez", calls.length === 2 && calls[1].saveAs === true, JSON.stringify(calls));
  check("e salva", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  check("temporário limpo após salvar", (await opfsKeys(popup)).every((k) => !k.startsWith("rec-")));
  await target.close(); await popup.close();
}

/* ---- 6) Descartar de propósito ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await setOptions(popup, { durationSec: 4, askEveryTime: true });
  await reopen(popup);
  const sw = swOf();
  await sw.evaluate(() => { chrome.downloads.download = async () => { throw new Error("Download canceled by the user"); }; });
  await setSpeed(popup, 300);
  await record(popup);
  await waitPhase(popup, "unsaved", 40000);
  await popup.click("#discard");
  await waitPhase(popup, "idle");
  check("descartar apaga o temporário", (await opfsKeys(popup)).every((k) => !k.startsWith("rec-")), JSON.stringify(await opfsKeys(popup)));
  await sw.evaluate(() => { chrome.downloads.download = globalThis.__origDownload; }); // fim dos stubs
  await target.close(); await popup.close();
}

/* ---- 7) "Começar do início da página" ---- */
const jump = (target, y) => target.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y);
const scrollY = (target) => target.evaluate(() => scrollY);
{
  // Ligado: mesmo com a página rolada a 5000 px, a gravação começa no topo.
  const { target, popup } = await session(`${T.base}/long`);
  await jump(target, 5000);
  await setOptions(popup, { durationSec: 5, startAtTop: true });
  await reopen(popup);
  check("checkbox mostra o valor salvo", await popup.isChecked("#top"));
  await setSpeed(popup, 300);
  await popup.click("#record");
  await waitPhase(popup, "countdown");
  await popup.waitForTimeout(600);
  check("na contagem a página já está no topo", (await scrollY(target)) === 0, `(${await scrollY(target)} px)`);
  await waitPhase(popup, "recording");
  const done = await waitPhase(popup, "idle", 40000);
  const y = await scrollY(target);
  check("scroll começou do topo (~1050 px, não 5000+)", y > 700 && y < 1500, `(${y} px)`);
  check("gravação salva", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  await target.close(); await popup.close();
}
{
  // Desligado: continua de onde a página estava.
  const { target, popup } = await session(`${T.base}/long`);
  await jump(target, 5000);
  await setOptions(popup, { durationSec: 5, startAtTop: false });
  await reopen(popup);
  await setSpeed(popup, 300);
  await popup.click("#record");
  await waitPhase(popup, "countdown");
  await popup.waitForTimeout(600);
  check("desligado: página não é movida", (await scrollY(target)) === 5000);
  await waitPhase(popup, "recording");
  await waitPhase(popup, "idle", 40000);
  const y = await scrollY(target);
  check("desligado: segue de onde estava (~6050 px)", y > 5700 && y < 6500, `(${y} px)`);
  await target.close(); await popup.close();
}
{
  // Ligado + "Subir": bloqueia com aviso (o scroll terminaria na hora).
  const { target, popup } = await session(`${T.base}/long`);
  await jump(target, 5000);
  await setOptions(popup, { durationSec: 5, startAtTop: true });
  await reopen(popup);
  await popup.click("#direction"); // vira "Subir"
  await popup.click("#record");
  await popup.waitForTimeout(500);
  check("topo + Subir mostra aviso", (await popup.textContent("#status")).includes("Subir"));
  check("e não inicia gravação", (await phase(popup)).phase === "idle");
  check("e não move a página", (await scrollY(target)) === 5000);
  await popup.click("#top"); // desmarca
  check("desmarcar persiste", !(await popup.evaluate(async () => (await chrome.storage.local.get("recSettings")).recSettings.startAtTop)));
  await target.close(); await popup.close();
}

await T.finish();
