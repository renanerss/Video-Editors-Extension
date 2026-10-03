# Scroll Recorder para Editores

Extensão Chromium (Manifest V3) que rola a página automaticamente em velocidade ajustável — pensada para gravar telas para edição de vídeo.

## Instalar (modo desenvolvedor)
1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha esta pasta.

## Status
- [x] Fase 1: auto-scroll (play/pause, velocidade, direção, repetir) e tema claro/escuro
- [ ] Fase 2: gravação de tela + download
- [ ] Fase 3: MP4 H.264, bitrate, fps, resolução
- [ ] Fase 4: polimento

## Testes
`node tests/e2e.mjs` — carrega a extensão no Chromium (Playwright) e valida tema e scroll.
