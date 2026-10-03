// Fase 3: resolução, fps, bitrate e formato. A fonte de vídeo é simulada (canvas), como nos outros testes;
// o redimensionamento, o gravador e o arquivo final rodam de verdade e são medidos com ffprobe.
import { execFileSync } from "node:child_process";
import { launch } from "./helpers.mjs";

const SOURCE = [2560, 1440];
const T = await launch({ source: SOURCE });
const { check, session, reopen, waitPhase, lastDownload, setOptions, setSpeed } = T;

const probe = (file) => {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=codec_name,width,height,nb_read_frames:format=duration,bit_rate", "-of", "json", file]).toString();
  const j = JSON.parse(out);
  // MediaRecorder grava WebM sem duração no cabeçalho: usa o último pts e o tamanho do arquivo.
  const duration = T.lastPtsSeconds(file);
  return { codec: j.streams[0].codec_name, width: j.streams[0].width, height: j.streams[0].height,
    frames: Number(j.streams[0].nb_read_frames), duration, bitrate: (T.fs.statSync(file).size * 8) / duration };
};

// Grava a página curta até o fim com as opções de qualidade dadas e devolve o que saiu.
async function recordWith(quality) {
  const { target, popup } = await session(`${T.base}/short`);
  await setOptions(popup, { quality });
  await reopen(popup);
  await setSpeed(popup, 1000);
  await popup.click("#record");
  const live = await waitPhase(popup, "recording");
  const status = await popup.evaluate(() => document.getElementById("statusText").textContent);
  const done = await waitPhase(popup, "idle", 40000);
  const file = (await lastDownload(popup)).filename;
  await target.close(); await popup.close();
  return { live, status, done, file, info: probe(file) };
}

/* ---- 1) Normalização: valor estranho no storage nunca quebra a gravação ---- */
{
  const { popup } = await session(`${T.base}/short`);
  const q = await popup.evaluate(() => Quality.normalize({ resolution: "999", fps: 144, bitrate: "ultra", format: "avi" }));
  check("opções inválidas voltam ao padrão", JSON.stringify(q) === JSON.stringify({ resolution: "native", fps: 60, bitrate: "high", format: "mp4" }), JSON.stringify(q));
  const sizes = await popup.evaluate(() => [
    Quality.outputSize(3840, 2160, "1080"), Quality.outputSize(1080, 1920, "720"),
    Quality.outputSize(1280, 720, "1080"), Quality.outputSize(2561, 1441, "720"),
  ]);
  check("4K -> 1080p mantém 16:9", sizes[0].width === 1920 && sizes[0].height === 1080, JSON.stringify(sizes[0]));
  check("janela vertical: o lado menor vira 720", sizes[1].width === 720 && sizes[1].height === 1280, JSON.stringify(sizes[1]));
  check("nunca aumenta além da fonte", !sizes[2].scaled && sizes[2].width === 1280, JSON.stringify(sizes[2]));
  check("dimensões sempre pares (H.264)", sizes[3].width % 2 === 0 && sizes[3].height % 2 === 0, JSON.stringify(sizes[3]));
  await popup.close();
}

/* ---- 2) Popup: os selects mostram, salvam e travam durante a gravação ---- */
{
  const { target, popup } = await session(`${T.base}/long`);
  check("painel de qualidade começa fechado e mostra o resumo", !(await popup.$eval("#qual", (d) => d.open)) && (await popup.textContent("#qSummary")) === "Nativa · 60 fps · MP4", await popup.textContent("#qSummary"));
  await popup.click("#qual > summary");
  check("sanfona: abrir qualidade fecha as opções de gravação", !(await popup.$eval("#opts", (d) => d.open)));
  check("com qualidade aberta, o popup cabe em 600 px", (await popup.evaluate(() => document.body.offsetHeight)) <= 600, `(${await popup.evaluate(() => document.body.offsetHeight)} px)`);
  check("padrão: Nativa / 60 fps / Alta / MP4",
    (await popup.inputValue("#qRes")) === "native" && (await popup.inputValue("#qFps")) === "60" &&
    (await popup.inputValue("#qBit")) === "high" && (await popup.inputValue("#qFmt")) === "mp4");
  await popup.selectOption("#qRes", "1080");
  await popup.selectOption("#qFps", "30");
  await popup.selectOption("#qBit", "medium");
  await popup.selectOption("#qFmt", "webm");
  check("estimativa de tamanho acompanha o bitrate", (await popup.textContent("#qHint")).includes("188"), await popup.textContent("#qHint"));
  await reopen(popup);
  check("painel aberto é lembrado ao reabrir", await popup.$eval("#qual", (d) => d.open));
  check("escolhas persistem ao reabrir o popup",
    (await popup.inputValue("#qRes")) === "1080" && (await popup.inputValue("#qFps")) === "30" &&
    (await popup.inputValue("#qBit")) === "medium" && (await popup.inputValue("#qFmt")) === "webm");
  const stored = await popup.evaluate(async () => (await chrome.storage.local.get("recSettings")).recSettings.quality);
  check("salvo em recSettings.quality", stored.resolution === "1080" && stored.fps === 30 && stored.bitrate === "medium" && stored.format === "webm", JSON.stringify(stored));
  await popup.click("#record");
  await waitPhase(popup, "recording");
  await reopen(popup);
  check("selects ficam bloqueados enquanto grava", await popup.$$eval("#qRes, #qFps, #qBit, #qFmt", (s) => s.every((e) => e.disabled)));
  check("painéis somem enquanto grava (libera espaço)", await popup.$eval("#qual", (d) => d.hidden));
  await popup.click("#record"); // parar
  await waitPhase(popup, "idle", 30000);
  await target.close(); await popup.close();
}

/* ---- 3) 1440p -> 1080p, 24 fps, Leve, WebM ---- */
{
  const r = await recordWith({ resolution: "1080", fps: 24, bitrate: "light", format: "webm" });
  console.log("     ffprobe:", JSON.stringify(r.info));
  check("saiu em 1920x1080", r.info.width === 1920 && r.info.height === 1080, `${r.info.width}x${r.info.height}`);
  check("formato WebM", r.live.ext === "webm" && /^vp[89]$/.test(r.info.codec), `${r.live.ext}/${r.info.codec}`);
  check("status mostra o que está gravando", /1920×1080 · 24 fps · WEBM/.test(r.status), r.status);
  const fps = r.info.frames / r.info.duration;
  check("fps ~24 (teto respeitado)", fps > 15 && fps <= 26, `(${fps.toFixed(1)} fps)`);
  check("bitrate Leve respeita ~10 Mbps", r.info.bitrate > 0 && r.info.bitrate < 14_000_000, `(${(r.info.bitrate / 1e6).toFixed(1)} Mbps)`);
  check("sem erro", !r.done.error);
}

/* ---- 4) 1440p -> 720p, 30 fps ---- */
{
  const r = await recordWith({ resolution: "720", fps: 30, bitrate: "medium", format: "webm" });
  check("saiu em 1280x720", r.info.width === 1280 && r.info.height === 720, `${r.info.width}x${r.info.height}`);
  const fps = r.info.frames / r.info.duration;
  check("fps ~30", fps > 20 && fps <= 32, `(${fps.toFixed(1)} fps)`);
}

/* ---- 5) Nativa: sem redimensionar ---- */
{
  const r = await recordWith({ resolution: "native", fps: 30, bitrate: "high", format: "webm" });
  check("nativa mantém 2560x1440", r.info.width === 2560 && r.info.height === 1440, `${r.info.width}x${r.info.height}`);
}

/* ---- 6) MP4 pedido: H.264 se o Chrome suportar, senão WebM com aviso (nunca MP4 com outro codec) ---- */
{
  const { popup } = await session(`${T.base}/short`);
  const h264 = await popup.evaluate(() => MediaRecorder.isTypeSupported("video/mp4;codecs=avc1"));
  await popup.close();
  const r = await recordWith({ resolution: "1080", fps: 30, bitrate: "high", format: "mp4" });
  console.log(`     H.264 suportado neste Chromium: ${h264}`);
  if (h264) check("MP4 sai em H.264", r.live.ext === "mp4" && r.info.codec === "h264", r.info.codec);
  else {
    check("sem H.264: cai para WebM", r.live.ext === "webm" && r.info.codec !== "h264", r.info.codec);
    check("status avisa o fallback", /não suporta MP4 H\.264/.test(r.status), r.status);
  }
  check("resolução é respeitada também no fallback", r.info.width === 1920, `${r.info.width}x${r.info.height}`);
}

await T.finish();
