// Setup compartilhado dos testes da extensão (Playwright + Chromium).
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export async function launch() {
  const src = path.resolve(import.meta.dirname, "..");
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
  for (const d of ["popup", "content", "icons", "background", "offscreen", "lib", "options"]) {
    fs.cpSync(path.join(src, d), path.join(ext, d), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json")));
  manifest.host_permissions = ["<all_urls>"]; // activeTab só vale com clique real no ícone
  fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest));

  // Única troca: a fonte de vídeo (não existe seletor de tela sem monitor). O resto roda de verdade.
  const off = path.join(ext, "offscreen/offscreen.js");
  const code = fs.readFileSync(off, "utf8");
  const patched = code.replace(/const captureDisplay = .*;/, `const captureDisplay = async () => {
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const g = c.getContext("2d"); let i = 0;
    setInterval(() => { g.fillStyle = "hsl(" + ((i++ * 4) % 360) + " 80% 50%)"; g.fillRect(0, 0, 1280, 720); }, 33);
    return c.captureStream(30);
  };`);
  if (patched === code) throw new Error("não achei captureDisplay para trocar");
  fs.writeFileSync(off, patched);

  const server = http.createServer((req, res) => {
    const h = req.url.includes("short") ? 3500 : 60000;
    res.setHeader("content-type", "text/html");
    res.end(`<html style="scroll-behavior:smooth"><body style="margin:0"><div style="height:${h}px;background:linear-gradient(#fff,#000)"></div></body></html>`);
  }).listen(0);
  const base = `http://localhost:${server.address().port}`;

  const extId = [...crypto.createHash("sha256").update(ext).digest("hex").slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pw-")), {
    channel: "chromium", acceptDownloads: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });

  let failures = 0;
  const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`); if (!ok) failures++; };

  // Página alvo ativa + popup carregado em outra aba (o popup controla a aba ativa).
  async function session(pageUrl) {
    const target = await ctx.newPage();
    await target.goto(pageUrl);
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await target.bringToFront();
    await reopen(popup);
    return { target, popup };
  }
  // Recarregar apaga os stubs: window.close fecharia a aba de teste e confirm() travaria.
  async function reopen(popup) {
    await popup.reload();
    await popup.evaluate(() => { window.close = () => {}; window.confirm = () => true; });
  }
  const phase = (popup) => popup.evaluate(async () => (await chrome.storage.session.get("rec")).rec ?? { phase: "idle" });
  async function waitPhase(popup, want, timeout = 30000) {
    const t0 = Date.now();
    for (;;) {
      const r = await phase(popup);
      if (r.phase === want) return r;
      if (Date.now() - t0 > timeout) throw new Error(`timeout esperando '${want}' (atual: ${JSON.stringify(r)})`);
      await popup.waitForTimeout(100);
    }
  }
  const opfsKeys = (popup) => popup.evaluate(async () => {
    const r = await navigator.storage.getDirectory(); const n = [];
    for await (const k of r.keys()) n.push(k); return n;
  });
  const downloadsCount = (popup) => popup.evaluate(async () => (await chrome.downloads.search({})).length);
  const lastDownload = (popup) => popup.evaluate(async () => (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }))[0]);
  const lastPtsSeconds = (file) => {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "packet=pts_time,duration_time", "-of", "csv=p=0", file]).toString().trim().split("\n");
    const pts = out.map((l) => Number(l.split(",")[0])).filter(Number.isFinite);
    if (!pts.length) throw new Error("ffprobe sem pts: " + out.slice(0, 3).join(" | ") + " file=" + file + " exists=" + fs.existsSync(file));
    return Math.max(...pts);
  };
  const setOptions = (popup, opts) => popup.evaluate(async (o) => {
    await chrome.storage.local.set({ recSettings: o });
  }, opts);
  const setSpeed = (popup, v) => popup.$eval("#speed", (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  // Usa uma pasta do OPFS no lugar do seletor nativo (que não existe em teste).
  const useFakeFolder = (popup, name) => popup.evaluate(async (n) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(n, { create: true });
    await FolderStore.save(dir);
  }, name);

  const finish = async () => { await ctx.close(); server.close(); process.exit(failures ? 1 : 0); };
  return { ctx, base, extId, check, session, reopen, phase, waitPhase, opfsKeys, downloadsCount, lastDownload,
    lastPtsSeconds, setOptions, setSpeed, useFakeFolder, finish, fs };
}
