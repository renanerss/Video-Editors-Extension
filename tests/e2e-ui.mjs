// UI/UX: contraste real (estilos computados), foco visível, nomes acessíveis, altura do popup,
// sem emojis como ícones, fontes carregadas, movimento reduzido e teclado.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, reopen, ctx } = T;

const { target, popup } = await session(`${T.base}/long`);
await popup.setViewportSize({ width: 320, height: 800 });
const height = () => popup.evaluate(async () => { await document.fonts.ready; return document.body.offsetHeight; }); // espera as fontes: com a fonte reserva o texto quebra em mais linhas
const setRec = (rec) => popup.evaluate((r) => chrome.storage.session.set({ rec: r }), rec);

// Razão de contraste WCAG a partir de duas cores "rgb(r, g, b)" computadas pelo navegador.
const contrastIn = (page, selA, selB, prop = "color", propB = "backgroundColor") => page.evaluate(([a, b, p, pb]) => {
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e)[pb]; if (!/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255,255,255)"; };
  const A = getComputedStyle(document.querySelector(a))[p];
  const B = b === "bg" ? bgOf(document.querySelector(a)) : getComputedStyle(document.querySelector(b))[pb];
  const [la, lb] = [lum(rgb(A)), lum(rgb(B))].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}, [selA, selB, prop, propB]);

for (const theme of ["dark", "light"]) {
  await popup.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  // Espera as transições de cor terminarem de verdade (tempo fixo é frágil sob carga) antes de medir.
  await popup.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const pairs = [
    ["texto principal", "h1", "bg", 4.5],
    ["rótulo (eyebrow)", ".eyebrow", "bg", 4.5],
    ["valor da velocidade", "#speedVal", "bg", 4.5],
    ["status", "#statusText", "bg", 4.5],
    ["botão primário", "#record", "#record", 4.5],
    ["botão secundário", "#play", "bg", 4.5],
  ];
  for (const [name, a, b, min] of pairs) {
    const r = await contrastIn(popup, a, b);
    check(`[${theme}] contraste ${name} >= ${min}:1`, r >= min, `(${r.toFixed(2)}:1)`);
  }
  const ctl = await contrastIn(popup, "#duration", "bg", "borderTopColor");
  check(`[${theme}] borda do campo >= 3:1`, ctl >= 3, `(${ctl.toFixed(2)}:1)`);
}
await popup.evaluate(() => { document.documentElement.dataset.theme = "dark"; });

/* ---- Altura: o popup do Chrome tem teto de 600 px ---- */
check("ocioso cabe em 600 px", (await height()) <= 600, `(${await height()} px)`);
await setRec({ phase: "idle", error: "A pasta precisa ser autorizada de novo. Autorize na aba que abriu e grave outra vez." });
await popup.waitForTimeout(150);
await reopen(popup); // idle + notice aparece na reabertura? força o estado local abaixo
await popup.evaluate(() => { showError("Com “Começar do início” e direção “Subir”, o scroll termina na hora. Mude para “Descer” ou desmarque a opção."); });
check("com erro longo cabe em 600 px", (await height()) <= 600, `(${await height()} px)`);
await setRec({ phase: "unsaved", name: "x", ext: "webm", url: "blob:x", error: "Você cancelou o salvamento. O vídeo ainda está guardado." });
await popup.waitForTimeout(150);
check("estado 'não salvo' cabe em 600 px", (await height()) <= 600, `(${await height()} px)`);
check("'não salvo' usa ícone de alerta (não só cor)", (await popup.getAttribute("#statusIcon", "href")).endsWith("#alert"));
await setRec({ phase: "recording", ext: "webm" });
await popup.waitForTimeout(150);
check("gravando cabe em 600 px", (await height()) <= 600, `(${await height()} px)`);
check("gravando mostra 'Parar e salvar'", (await popup.textContent("#recText")).includes("Parar"));
await setRec({ phase: "idle" });
await popup.waitForTimeout(150);

/* ---- Layout ---- */
check("sem rolagem horizontal", await popup.evaluate(() => document.documentElement.scrollWidth <= 320));

/* ---- Ícones e nomes acessíveis ---- */
const emoji = await popup.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText));
check("sem emojis como ícones", !emoji);
const unnamed = await popup.evaluate(() => [...document.querySelectorAll("button, input, summary")]
  .filter((el) => {
    const name = el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.textContent || el.title;
    return !name?.trim();
  }).map((el) => el.id || el.tagName));
check("todo controle tem nome acessível", unnamed.length === 0, JSON.stringify(unnamed));
check("botão de tema descreve a ação", /Mudar para o tema/.test(await popup.getAttribute("#theme", "aria-label")));
check("slider tem valor em texto", /pixels por segundo/.test(await popup.getAttribute("#speed", "aria-valuetext")));
check("status é região viva", (await popup.getAttribute("#status", "role")) === "status");

/* ---- Fontes do design system carregadas localmente ---- */
const fonts = await popup.evaluate(async () => {
  await document.fonts.ready;
  return { inter: document.fonts.check('600 12px "Inter"'), mono: document.fonts.check('500 12px "JetBrains Mono"'),
    loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family) };
});
check("Inter e JetBrains Mono carregadas", fonts.inter && fonts.mono && fonts.loaded.length >= 2, JSON.stringify(fonts.loaded));

/* ---- Teclado: foco visível e rádios com setas ---- */
await popup.keyboard.press("Tab");
const outline = await popup.evaluate(() => { const s = getComputedStyle(document.activeElement); return parseFloat(s.outlineWidth); });
check("foco por teclado tem contorno visível (>= 2 px)", outline >= 2, `(${outline}px em ${await popup.evaluate(() => document.activeElement.id)})`);
await popup.focus("#dirDown");
await popup.keyboard.press("ArrowRight");
check("seta do teclado muda a direção para 'Subir'", await popup.isChecked("#dirUp"));
await popup.keyboard.press("ArrowLeft");
check("e volta para 'Descer'", await popup.isChecked("#dirDown"));

/* ---- Validação inline da duração ---- */
await popup.fill("#duration", "2");
check("duração 2 s: campo inválido + dica visível", (await popup.getAttribute("#duration", "aria-invalid")) === "true" && await popup.isVisible("#durHint"));
await popup.fill("#duration", "5");
check("duração 5 s: erro some na hora", (await popup.getAttribute("#duration", "aria-invalid")) === "false" && !(await popup.isVisible("#durHint")));
await popup.fill("#duration", "");

/* ---- Slider: preenchimento acompanha o valor ---- */
await T.setSpeed(popup, 1000);
check("preenchimento do slider em 100%", (await popup.$eval("#speed", (el) => el.style.getPropertyValue("--pct"))) === "100%");
await T.setSpeed(popup, 10);
check("preenchimento do slider em 0%", (await popup.$eval("#speed", (el) => el.style.getPropertyValue("--pct"))) === "0%");

/* ---- Movimento reduzido ---- */
await popup.emulateMedia({ reducedMotion: "reduce" });
await setRec({ phase: "saving" });
await popup.waitForTimeout(150);
const anim = await popup.evaluate(() => getComputedStyle(document.querySelector("#status svg")).animationName);
check("prefers-reduced-motion desliga a animação do status", anim === "none", `(${anim})`);
await popup.emulateMedia({ reducedMotion: "no-preference" });
const animOn = await popup.evaluate(() => getComputedStyle(document.querySelector("#status svg")).animationName);
check("sem a preferência, o status pulsa", animOn === "pulse", `(${animOn})`);
await setRec({ phase: "idle" });

/* ---- Opções lembram aberto/fechado ---- */
await popup.click("#opts > summary");
await popup.waitForTimeout(150);
await reopen(popup);
check("opções fechadas ficam fechadas ao reabrir", !(await popup.$eval("#opts", (d) => d.open)));
await popup.click("#opts > summary");

/* ---- Página de opções ---- */
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${T.extId}/options/options.html`);
await opt.setViewportSize({ width: 360, height: 700 });
check("opções: sem rolagem horizontal em 360 px", await opt.evaluate(() => document.documentElement.scrollWidth <= 360));
check("opções: sem emojis", !(await opt.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText))));
check("opções: 'Autorizar' e 'Usar Downloads' escondidos sem pasta", !(await opt.isVisible("#authorize")) && !(await opt.isVisible("#clear")));

await T.finish();
