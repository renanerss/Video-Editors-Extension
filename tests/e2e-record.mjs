// Teste da Fase 2. A única coisa trocada é a FONTE do vídeo (canvas animado no lugar do seletor
// de tela, que não existe em ambiente sem monitor). Todo o resto roda de verdade.
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const src = path.resolve(import.meta.dirname, "..");
const ext = fs.mkdtempSync(path.join(os.tmpdir(), "ext-rec-"));
for (const d of ["popup", "content", "icons", "background", "offscreen"]) fs.cpSync(path.join(src, d), path.join(ext, d), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json")));
manifest.host_permissions = ["<all_urls>"]; // activeTab só vale com clique real no ícone
fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest));

const off = path.join(ext, "offscreen/offscreen.js");
const CANCEL = process.env.CANCEL; // simula o usuário fechando o seletor de tela
const patched = fs.readFileSync(off, "utf8").replace(
  /const captureDisplay = .*;/,
  CANCEL ? `const captureDisplay = async () => { throw new DOMException("Permission denied", "NotAllowedError"); };` : `const captureDisplay = async () => {
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const g = c.getContext("2d"); let i = 0;
    setInterval(() => { g.fillStyle = "hsl(" + ((i++ * 4) % 360) + " 80% 50%)"; g.fillRect(0, 0, 1280, 720); }, 33);
    return c.captureStream(30);
  };`);
if (patched === fs.readFileSync(off, "utf8")) throw new Error("não achei captureDisplay para trocar");
fs.writeFileSync(off, patched);

const server = http.createServer((req, res) => {
  const h = req.url.includes("short") ? 3500 : 60000;
  res.setHeader("content-type", "text/html");
  res.end(`<html style="scroll-behavior:smooth"><body style="margin:0"><div style="height:${h}px;background:linear-gradient(#fff,#000)"></div></body></html>`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const extId = [...crypto.createHash("sha256").update(ext).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pw-")), {
  channel: "chromium", acceptDownloads: true, downloadsPath: downloads,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`); if (!ok) failures++; };

async function session(pageUrl) {
  const target = await ctx.newPage();
  await target.goto(pageUrl);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await target.bringToFront();
  await popup.reload();
  return { target, popup };
}
const phase = (popup) => popup.evaluate(async () => (await chrome.storage.session.get("rec")).rec ?? { phase: "idle" });
async function waitPhase(popup, want, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const r = await phase(popup);
    if (r.phase === want) return r;
    if (Date.now() - t0 > timeout) throw new Error(`timeout esperando '${want}' (atual: ${JSON.stringify(r)})`);
    await popup.waitForTimeout(100);
  }
}
const overlayVisible = (target) => target.evaluate(() => [...document.documentElement.children].some((e) => e.style.zIndex === "2147483647"));

if (CANCEL) {
  const { target, popup } = await session(`${base}/short`);
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.click("#record");
  await popup.waitForTimeout(1500);
  const r = await phase(popup);
  check("cancelar o seletor volta ao início", r.phase === "idle", JSON.stringify(r));
  check("cancelar não mostra erro", !r.error && (await popup.textContent("#status")) === "");
  check("botão de gravar volta a funcionar", !(await popup.$eval("#record", (b) => b.disabled)));
  await ctx.close(); server.close();
  process.exit(failures ? 1 : 0);
}

/* ---- 1) Gravação completa até o fim da página ---- */
{
  const { target, popup } = await session(`${base}/short`);
  await popup.$eval("#speed", (el) => { el.value = 1000; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await popup.evaluate(() => { window.close = () => {}; }); await popup.click("#record");
  const seen = [];
  for (const p of ["picking", "countdown"]) { await waitPhase(popup, p); seen.push(p); }
  await target.waitForTimeout(500);
  check("contagem regressiva aparece na página", await overlayVisible(target));
  check("página ainda não rolou durante a contagem", (await target.evaluate(() => scrollY)) === 0);
  const r = await waitPhase(popup, "recording");
  check("overlay some antes de gravar", !(await overlayVisible(target)));
  check("popup mostra 'Parar e salvar'", (await popup.textContent("#record")).includes("Parar"));
  check("botões de scroll bloqueados gravando", await popup.$eval("#play", (b) => b.disabled));
  console.log("     formato escolhido:", r.mime, `(${r.width}x${r.height})`);
  check("nunca grava MP4 que não seja H.264", r.ext !== "mp4" || /avc1/.test(r.mime));
  await waitPhase(popup, "saving");
  const done = await waitPhase(popup, "idle", 30000);
  check("página rolou até o fim", await target.evaluate(() => scrollY + innerHeight >= document.scrollingElement.scrollHeight - 1));
  check("gravação terminou com arquivo salvo", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  const items = await popup.evaluate(() => chrome.downloads.search({}));
  const file = items[0]?.filename;
  const size = file && fs.existsSync(file) ? fs.statSync(file).size : 0;
  check("arquivo existe e não está vazio", size > 20000, `(${(size / 1024).toFixed(0)} KB)`);
  if (file) {
    const { execFileSync } = await import("node:child_process");
    try {
      const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "default=nw=1", file]).toString();
      console.log("     ffprobe:", out.trim().replace(/\n/g, " "));
      check("ffprobe lê o vídeo", /width=1280/.test(out));
    } catch (e) { console.log("     (ffprobe indisponível)"); }
  }
  const opfsLeft = await popup.evaluate(async () => { const r = await navigator.storage.getDirectory(); const n = []; for await (const k of r.keys()) n.push(k); return n; });
  check("arquivo temporário (OPFS) limpo", opfsLeft.length === 0, JSON.stringify(opfsLeft));
  check("sem erro", !done.error);
  await target.close(); await popup.close();
}

/* ---- 2) Parar manualmente no meio ---- */
{
  const { target, popup } = await session(`${base}/long`);
  await popup.$eval("#speed", (el) => { el.value = 200; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await popup.evaluate(() => { window.close = () => {}; }); await popup.click("#record");
  await waitPhase(popup, "recording");
  await popup.waitForTimeout(2500);
  await popup.evaluate(() => { window.close = () => {}; }); await popup.click("#record"); // vira "Parar e salvar"
  const done = await waitPhase(popup, "idle", 30000);
  const y = await target.evaluate(() => scrollY);
  check("parar manual salva o vídeo", Boolean(done.saved), done.saved ?? JSON.stringify(done));
  await target.waitForTimeout(500);
  check("parar manual também para o scroll", (await target.evaluate(() => scrollY)) === y);
  await target.close(); await popup.close();
}

await ctx.close(); server.close();
process.exit(failures ? 1 : 0);
