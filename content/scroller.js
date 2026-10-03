// Injetado sob demanda pelo popup (activeTab). Faz o auto-scroll da página.
(() => {
  if (window.__scrollRecorder) return;

  const state = {
    running: false,
    speed: 120,        // px por segundo
    direction: 1,      // 1 = descer, -1 = subir
    target: null,
    pos: 0,            // posição em ponto flutuante (o navegador arredonda scrollTop)
    lastSet: 0,
    lastTime: 0,
    ease: false,       // começa e termina devagar (movimento de câmera)
    startedAt: 0,      // instante do start, para a rampa de aceleração
    stopAt: null,      // instante (ms) em que o scroll para sozinho; usado pela gravação com duração
    raf: 0,
  };

  const EASE_MS = 1000; // duração da aceleração inicial e da frenagem final

  // Fator (0..1) aplicado à velocidade escolhida. Sem easing é sempre 1.
  // - Início: sobe suave (smoothstep) nos primeiros EASE_MS.
  // - Fim da página: frenagem a desaceleração constante (v ~ raiz da distância restante), que
  //   cobre exatamente speed*EASE_MS/2 de rolagem, ou seja, ~EASE_MS de frenagem.
  // - Fim do tempo (gravação com duração): rampa descendente nos últimos EASE_MS.
  // O piso evita ficar parado antes de chegar ao fim.
  function easeFactor(now, remainingPx) {
    if (!state.ease) return 1;
    const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
    const fIn = smooth((now - state.startedAt) / EASE_MS);
    const brake = Math.max(state.speed * EASE_MS / 2000, 1);
    const fEnd = Math.sqrt(Math.min(Math.max(remainingPx / brake, 0), 1));
    const fTime = state.stopAt === null ? 1 : smooth((state.stopAt - now) / EASE_MS);
    return Math.max(Math.min(fIn, fEnd, fTime), 0.03);
  }

  const maxScroll = (el) => el.scrollHeight - el.clientHeight;

  // "instant" ignora o CSS scroll-behavior:smooth do site. Sem isso, cada atribuição
  // vira uma animação atrasada e a velocidade real fica presa em ~300 px/s.
  const scrollToY = (el, y) => el.scrollTo({ top: y, behavior: "instant" });

  function isScrollable(el) {
    if (maxScroll(el) <= 1) return false;
    const overflowY = getComputedStyle(el).overflowY;
    return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  }

  // Página normal: usa o scroll do documento. Apps com container interno
  // (ex.: Notion): escolhe o maior elemento rolável.
  function findTarget() {
    const root = document.scrollingElement || document.documentElement;
    if (maxScroll(root) > 1) return root;
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (!isScrollable(el)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best || root;
  }

  function tick(now) {
    if (!state.running) return;
    const el = state.target;
    // dt nunca negativo (o timestamp do rAF pode ser anterior ao do start) nem gigante (aba em segundo plano)
    const dt = Math.min(Math.max((now - state.lastTime) / 1000, 0), 0.1);
    state.lastTime = now;
    if (state.stopAt !== null && now >= state.stopAt) { stop(); return; }

    // Se o usuário rolou manualmente, ressincroniza a partir de onde ele parou.
    if (Math.abs(el.scrollTop - state.lastSet) > 2) state.pos = el.scrollTop;

    const max = maxScroll(el);
    const remaining = state.direction === 1 ? max - state.pos : state.pos;
    state.pos += state.direction * state.speed * easeFactor(now, remaining) * dt;

    const atEnd = state.direction === 1 ? state.pos >= max : state.pos <= 0;
    if (atEnd) { // chegou ao fim: trava na borda e para
      state.pos = Math.min(Math.max(state.pos, 0), max);
      scrollToY(el, state.pos);
      stop();
      return;
    }

    scrollToY(el, state.pos);
    state.lastSet = el.scrollTop;
    state.raf = requestAnimationFrame(tick);
  }

  function start(durationMs) {
    if (state.running) return;
    state.stopAt = typeof durationMs === "number" ? performance.now() + durationMs : null;
    state.target = findTarget();
    state.pos = state.target.scrollTop;
    state.lastSet = state.pos;
    state.lastTime = state.startedAt = performance.now();
    state.running = true;
    state.raf = requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    // Avisa o popup (se estiver aberto) que o scroll terminou sozinho.
    chrome.runtime.sendMessage({ type: "scroll-stopped" }).catch(() => {});
  }

  // Contagem regressiva grande no centro da página. Some por completo antes de a gravação começar.
  function countdown(seconds) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:grid;place-items:center";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>
        .box{display:flex;flex-direction:column;align-items:center;gap:14px;font-family:ui-monospace,"JetBrains Mono",monospace}
        .ring{width:176px;height:176px;border-radius:50%;display:grid;place-items:center;background:rgba(3,3,3,.86);
          border:1px solid rgba(0,255,163,.55);box-shadow:0 0 40px rgba(0,255,163,.25);
          color:#00ffa3;font-size:96px;font-weight:600;line-height:1}
        .cap{padding:6px 12px;background:rgba(3,3,3,.86);color:#e8e8e8;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
      </style><div class="box" role="status"><div class="ring"></div><div class="cap">Gravação começa em instantes</div></div>`;
      const label = root.querySelector(".ring");
      let n = seconds;
      label.textContent = n;
      document.documentElement.append(host);
      const timer = setInterval(() => {
        n -= 1;
        if (n > 0) { label.textContent = n; return; }
        clearInterval(timer);
        host.remove();
        setTimeout(resolve, 150); // deixa o navegador pintar um frame sem o overlay
      }, 1000);
    });
  }

  // Leva a página ao topo e espera 2 frames para ela ser pintada ali antes de a contagem/gravação.
  function jumpToTop() {
    if (state.running) stop();
    scrollToY(findTarget(), 0);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function snapshot() {
    return { running: state.running, speed: state.speed, direction: state.direction, ease: state.ease };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== "scroller") return;
    switch (msg.type) {
      case "configure":
        if (typeof msg.speed === "number") state.speed = msg.speed;
        if (msg.direction === 1 || msg.direction === -1) state.direction = msg.direction;
        if (typeof msg.ease === "boolean") state.ease = msg.ease;
        break;
      case "start": start(msg.durationMs); break;
      case "stop": if (state.running) stop(); break;
      case "scrollToTop":
        jumpToTop().then(() => sendResponse(snapshot()));
        return true; // resposta assíncrona
      case "countdown":
        countdown(msg.seconds).then(() => sendResponse(snapshot()));
        return true; // resposta assíncrona
    }
    sendResponse(snapshot());
  });

  window.__scrollRecorder = { state };
})();
