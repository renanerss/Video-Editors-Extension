// Teste end-to-end: carrega a extensão no Chromium e controla o popup como um usuário.
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const src = path.resolve(import.meta.dirname, "..");
// Cópia de teste: activeTab só vale com clique real no ícone, então liberamos o host só aqui.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
for (const d of ["popup", "content", "icons", "background", "offscreen", "lib", "options"]) fs.cpSync(path.join(src, d), path.join(ext, d), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json")));
manifest.host_permissions = ["<all_urls>"];
fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest));
const page_html = (smooth) => `<html style="${smooth ? "scroll-behavior:smooth" : ""}"><body style="margin:0"><div style="height:60000px;background:linear-gradient(#fff,#000)"></div></body></html>`;
const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(page_html(req.url.includes("smooth"))); })
  .listen(0);
const url = `http://localhost:${server.address().port}/` + (process.env.SMOOTH ? "?smooth" : "");

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

// Scroll pela interface real: com a página alvo ativa, recarregamos o popup (ele controla a aba ativa).
await target.bringToFront();
await popup.reload();
const rate = async (ms = 1500) => {
  const a = await target.evaluate(() => scrollY);
  await target.waitForTimeout(ms);
  return ((await target.evaluate(() => scrollY)) - a) / (ms / 1000);
};
const near = (v, t) => Math.abs(v - t) <= t * 0.2;

await popup.click('.presets button[data-speed="150"]');
check("atalho 'Médio' já começa a rolar (~150 px/s)", near(await rate(), 150));
check("botão vira 'Pausar'", (await popup.textContent("#play")).includes("Pausar"));

// Slider: cada movimento atualiza a velocidade na hora.
const setSlider = (v) => popup.$eval("#speed", (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
await setSlider(400);
await popup.waitForTimeout(100);
check("slider -> 400 px/s ao vivo", near(await rate(), 400));
await setSlider(800);
await popup.waitForTimeout(100);
check("slider -> 800 px/s ao vivo", near(await rate(), 800));
await setSlider(1000);
await popup.waitForTimeout(100);
check("slider -> 1000 px/s ao vivo", near(await rate(), 1000));
await setSlider(50);
await popup.waitForTimeout(100);
check("slider -> 50 px/s ao vivo", near(await rate(), 50));

await popup.click("#play");
const y = await target.evaluate(() => scrollY);
await target.waitForTimeout(400);
check("pausar para a página", (await target.evaluate(() => scrollY)) === y);
check("slider parado não inicia o scroll", (await setSlider(300), await target.waitForTimeout(400), (await target.evaluate(() => scrollY)) === y));

await popup.click("#direction");
await popup.click("#play");
await target.waitForTimeout(500);
check("direção 'subir' funciona", (await target.evaluate(() => scrollY)) < y);
await popup.click("#play");

// Fim da página: para sozinho e o botão volta a "Iniciar".
await popup.click("#direction"); // descer
await target.evaluate(() => scrollTo({ top: document.scrollingElement.scrollHeight - innerHeight - 100, behavior: "instant" }));
await setSlider(1000);
await popup.click('.presets button[data-speed="400"]');
await target.waitForTimeout(800);
check("para sozinho no fim da página", (await target.evaluate(() => scrollY + innerHeight >= document.scrollingElement.scrollHeight - 1)));
check("botão volta a 'Iniciar' no fim", (await popup.textContent("#play")).includes("Iniciar"));
check("não existe mais 'Repetir'", (await popup.$("#loop")) === null);

await ctx.close(); server.close();
process.exit(failures ? 1 : 0);
