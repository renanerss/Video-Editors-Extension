// Movimento suave: mede a velocidade real da página (amostras por quadro) com o easing desligado e ligado.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, setSpeed } = T;

// Roda no alvo: amostra [t, y] a cada quadro até a página parar de se mexer (ou `maxMs`).
const sampler = (target, maxMs) => target.evaluate((maxMs) => new Promise((resolve) => {
  const out = []; const t0 = performance.now(); let still = 0, last = -1;
  const f = (now) => {
    out.push([now - t0, scrollY]);
    still = scrollY === last ? still + 1 : 0; last = scrollY;
    if (now - t0 > maxMs || (out.length > 20 && still > 12 && scrollY > 0)) return resolve(out);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}), maxMs);
// Velocidade média (px/s) entre dois instantes da amostra.
const vel = (s, a, b) => {
  const at = (t) => s.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best));
  const [pa, pb] = [at(a), at(b)];
  return (pb[1] - pa[1]) / ((pb[0] - pa[0]) / 1000);
};

async function run({ ease, page = "long", speed, maxMs }) {
  const { target, popup } = await session(`${T.base}/${page}`);
  await setSpeed(popup, speed);
  await popup.evaluate((e) => { const c = document.getElementById("ease"); c.checked = e; c.dispatchEvent(new Event("change", { bubbles: true })); }, ease);
  const sampling = sampler(target, maxMs);
  await target.waitForTimeout(100);
  await popup.click("#play");
  const s = await sampling;
  await target.close(); await popup.close();
  return s;
}

/* ---- Início: sem easing sai na velocidade cheia; com easing acelera ---- */
{
  const off = await run({ ease: false, speed: 600, maxMs: 3000 });
  const on = await run({ ease: true, speed: 600, maxMs: 3000 });
  // t=0 das amostras = antes do clique; acha o instante em que a página começou a mexer.
  const startOf = (s) => s.find((p) => p[1] > 0)[0];
  const t0off = startOf(off), t0on = startOf(on);
  const vOff = vel(off, t0off + 50, t0off + 350);
  const vEarlyOn = vel(on, t0on + 50, t0on + 350);
  const vLateOn = vel(on, t0on + 1300, t0on + 1900);
  console.log(`     off: ${vOff.toFixed(0)} px/s | on início: ${vEarlyOn.toFixed(0)} px/s | on após 1,3 s: ${vLateOn.toFixed(0)} px/s`);
  check("sem easing: velocidade cheia desde o início (~600)", Math.abs(vOff - 600) < 150, `(${vOff.toFixed(0)})`);
  check("com easing: início bem mais lento (< 40% da velocidade)", vEarlyOn < 600 * 0.4, `(${vEarlyOn.toFixed(0)})`);
  check("com easing: chega à velocidade escolhida depois da rampa (~600)", Math.abs(vLateOn - 600) < 150, `(${vLateOn.toFixed(0)})`);
}

/* ---- Fim da página: freia antes de chegar; termina exatamente no fim ---- */
{
  const off = await run({ ease: false, page: "short", speed: 1000, maxMs: 8000 });
  const on = await run({ ease: true, page: "short", speed: 1000, maxMs: 8000 });
  const lastMoving = (s) => { for (let i = s.length - 1; i > 0; i--) if (s[i][1] !== s[i - 1][1]) return s[i][0]; return s.at(-1)[0]; };
  const endOff = lastMoving(off), endOn = lastMoving(on);
  const vOffEnd = vel(off, endOff - 150, endOff - 20);
  const vOnEnd = vel(on, endOn - 150, endOn - 20);
  const max = on.at(-1)[1];
  console.log(`     velocidade nos últimos 150 ms: off ${vOffEnd.toFixed(0)} px/s | on ${vOnEnd.toFixed(0)} px/s | fim em ${max}px`);
  check("sem easing: chega ao fim em velocidade cheia", vOffEnd > 700, `(${vOffEnd.toFixed(0)})`);
  check("com easing: freia antes do fim (< 40% da velocidade)", vOnEnd < 400, `(${vOnEnd.toFixed(0)})`);
  check("com easing: ainda chega exatamente ao fim da página", on.at(-1)[1] === off.at(-1)[1] && max > 0, `(${max} vs ${off.at(-1)[1]})`);
}

/* ---- Fim do tempo (duração): rampa descendente nos últimos ~1 s ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  await setSpeed(popup, 500);
  await popup.evaluate(() => { const c = document.getElementById("ease"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
  await popup.click("#play"); await popup.click("#play"); // injeta o script e deixa parado
  await target.evaluate(() => scrollTo(0, 0));
  const tabId = await popup.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.startsWith("http://localhost")).id);
  const sampling = sampler(target, 6000);
  await popup.evaluate((id) => chrome.tabs.sendMessage(id, { target: "scroller", type: "start", durationMs: 3000 }), tabId);
  const s = await sampling;
  const t0 = s.find((p) => p[1] > 0)[0];
  const vMid = vel(s, t0 + 1300, t0 + 1700);
  const vEnd = vel(s, t0 + 2600, t0 + 2950);
  console.log(`     duração 3 s: meio ${vMid.toFixed(0)} px/s | últimos 350 ms ${vEnd.toFixed(0)} px/s`);
  check("duração: no meio, velocidade cheia (~500)", Math.abs(vMid - 500) < 125, `(${vMid.toFixed(0)})`);
  check("duração: nos últimos instantes, bem mais lento", vEnd < 500 * 0.5, `(${vEnd.toFixed(0)})`);
  await target.close(); await popup.close();
}

/* ---- Persistência: o checkbox é lembrado e começa desligado ---- */
{
  const { popup, target } = await session(`${T.base}/long`);
  await popup.evaluate(() => chrome.storage.local.remove("scrollSettings")); // os blocos acima já ligaram e salvaram
  await T.reopen(popup);
  check("começa desligado", !(await popup.isChecked("#ease")));
  await popup.check("#ease");
  await T.reopen(popup);
  check("escolha é lembrada ao reabrir", await popup.isChecked("#ease"));
  const saved = await popup.evaluate(async () => (await chrome.storage.local.get("scrollSettings")).scrollSettings);
  check("salvo em scrollSettings.ease", saved?.ease === true, JSON.stringify(saved));
  await target.close(); await popup.close();
}

await T.finish();
