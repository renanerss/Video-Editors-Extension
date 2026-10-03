// Teste end-to-end: carrega a extensão no Chromium e controla o popup como um usuário.
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const src = path.resolve(import.meta.dirname, "..");
// Cópia de teste: activeTab só vale com clique real no ícone, então liberamos o host só aqui.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
for (const d of ["popup", "content", "icons"]) fs.cpSync(path.join(src, d), path.join(ext, d), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json")));
manifest.host_permissions = ["<all_urls>"];
fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest));
const page_html = `<body style="margin:0"><div style="height:20000px;background:linear-gradient(#fff,#000)"></div></body>`;
const server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page_html); })
  .listen(0);
const url = `http://localhost:${server.address().port}/`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pw-")), {
  channel: "chromium",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
import crypto from "node:crypto";
const extId = [...crypto.createHash("sha256").update(ext).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

const target = await ctx.newPage();
await target.goto(url);
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
// Em uma aba normal o "aba ativa" seria a da página; aqui forçamos o tabId da página alvo.
await target.bringToFront();

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`); if (!ok) failures++; };

// Tema
const theme0 = await popup.evaluate(() => document.documentElement.dataset.theme);
await popup.click("#theme");
const theme1 = await popup.evaluate(() => document.documentElement.dataset.theme);
check("botão de tema alterna", theme0 !== theme1, `${theme0} -> ${theme1}`);
await popup.reload();
check("tema persiste após reabrir", (await popup.evaluate(() => document.documentElement.dataset.theme)) === theme1);

// Scroll (a popup está em aba própria; apontamos o tabId manualmente via evaluate)
const tabId = await popup.evaluate(async (u) => (await chrome.tabs.query({ url: u + "*" }))[0].id, url);
const send = (m) => popup.evaluate(([id, m]) => chrome.tabs.sendMessage(id, { target: "scroller", ...m }), [tabId, m]);
await popup.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content/scroller.js"] }), tabId);
await send({ type: "configure", speed: 200, direction: 1, loop: false });
await send({ type: "start" });
const y0 = await target.evaluate(() => scrollY);
await target.waitForTimeout(2000);
const y1 = await target.evaluate(() => scrollY);
const rate = (y1 - y0) / 2;
check("rola ~200 px/s", rate > 150 && rate < 250, `(${rate.toFixed(0)} px/s)`);

await send({ type: "configure", speed: 20 });
const y2 = await target.evaluate(() => scrollY);
await target.waitForTimeout(2000);
const rateSlow = ((await target.evaluate(() => scrollY)) - y2) / 2;
check("velocidade lenta (20 px/s) não engasga", rateSlow > 12 && rateSlow < 28, `(${rateSlow.toFixed(1)} px/s)`);

await send({ type: "stop" });
const y3 = await target.evaluate(() => scrollY);
await target.waitForTimeout(500);
check("pausa realmente para", (await target.evaluate(() => scrollY)) === y3);

await send({ type: "configure", direction: -1, speed: 300 });
await send({ type: "start" });
await target.waitForTimeout(500);
check("direção 'subir' funciona", (await target.evaluate(() => scrollY)) < y3);
await send({ type: "stop" });

await ctx.close(); server.close();
process.exit(failures ? 1 : 0);
