// Cronômetro: tempo e tamanho no popup e tempo no selo do ícone enquanto grava.
import { launch } from "./helpers.mjs";
const T = await launch();
const { check, session, waitPhase, setSpeed, reopen } = T;
const badge = (popup) => popup.evaluate(() => chrome.action.getBadgeText({}));

const { target, popup } = await session(`${T.base}/long`);
await setSpeed(popup, 100);
check("cronômetro escondido quando ocioso", await popup.$eval("#clock", (e) => e.hidden));
await popup.click("#record");
await waitPhase(popup, "recording");
await reopen(popup); // o popup real fecha ao gravar: reabrir recupera o cronômetro do estado salvo
await popup.waitForTimeout(3500);

check("cronômetro aparece gravando", !(await popup.$eval("#clock", (e) => e.hidden)));
const t = await popup.textContent("#clockTime");
check("mostra o tempo decorrido (>= 0:03)", /^0:0[3-9]$|^0:[1-5]\d$/.test(t), t);
const size1 = await popup.evaluate(async () => (await chrome.storage.session.get("recProgress")).recProgress?.bytes ?? 0);
check("tamanho do arquivo informado pelo gravador", size1 > 5000, `(${size1} bytes)`);
check("tamanho aparece no popup", /MB$/.test((await popup.textContent("#clockSize")).trim()), await popup.textContent("#clockSize"));
await popup.waitForTimeout(2000);
const size2 = await popup.evaluate(async () => (await chrome.storage.session.get("recProgress")).recProgress.bytes);
check("tamanho cresce com o tempo", size2 > size1, `(${size1} -> ${size2})`);
const b = await badge(popup);
check("selo do ícone mostra m:ss no lugar de REC", /^\d:\d\d$/.test(b), b);
check("cronômetro fora da região 'status' (não é lido a cada segundo)", await popup.$eval("#clock", (e) => !e.closest("#status") && e.getAttribute("role") === "timer"));
check("popup gravando cabe em 600 px", (await popup.evaluate(() => document.body.offsetHeight)) <= 600);

await popup.click("#record"); // parar
await waitPhase(popup, "idle", 30000);
await popup.waitForTimeout(300);
check("cronômetro some ao terminar", await popup.$eval("#clock", (e) => e.hidden));
check("selo do ícone limpo ao terminar", (await badge(popup)) === "", await badge(popup));
const left = await popup.evaluate(async () => (await chrome.storage.session.get("recProgress")).recProgress);
check("tamanho antigo não vaza para a próxima gravação", left === undefined, JSON.stringify(left));
await T.finish();
