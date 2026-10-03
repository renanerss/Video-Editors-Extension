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
    raf: 0,
  };

  const maxScroll = (el) => el.scrollHeight - el.clientHeight;

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

    // Se o usuário rolou manualmente, ressincroniza a partir de onde ele parou.
    if (Math.abs(el.scrollTop - state.lastSet) > 2) state.pos = el.scrollTop;

    const max = maxScroll(el);
    state.pos += state.direction * state.speed * dt;

    const atEnd = state.direction === 1 ? state.pos >= max : state.pos <= 0;
    if (atEnd) { // chegou ao fim: trava na borda e para
      state.pos = Math.min(Math.max(state.pos, 0), max);
      el.scrollTop = state.pos;
      stop();
      return;
    }

    el.scrollTop = state.pos;
    state.lastSet = el.scrollTop;
    state.raf = requestAnimationFrame(tick);
  }

  function start() {
    if (state.running) return;
    state.target = findTarget();
    state.pos = state.target.scrollTop;
    state.lastSet = state.pos;
    state.lastTime = performance.now();
    state.running = true;
    state.raf = requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    // Avisa o popup (se estiver aberto) que o scroll terminou sozinho.
    chrome.runtime.sendMessage({ type: "scroll-stopped" }).catch(() => {});
  }

  function snapshot() {
    return { running: state.running, speed: state.speed, direction: state.direction };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== "scroller") return;
    switch (msg.type) {
      case "configure":
        if (typeof msg.speed === "number") state.speed = msg.speed;
        if (msg.direction === 1 || msg.direction === -1) state.direction = msg.direction;
        break;
      case "start": start(); break;
      case "stop": if (state.running) stop(); break;
    }
    sendResponse(snapshot());
  });

  window.__scrollRecorder = { state };
})();
