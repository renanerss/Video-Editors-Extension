# Scroll Recorder para Editores

Extensão Chromium (Manifest V3) que rola a página automaticamente em velocidade ajustável — pensada para gravar telas para edição de vídeo.

## Instalar (modo desenvolvedor)
1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha esta pasta.

## Status
- [x] Fase 1: auto-scroll (play/pause, velocidade ao vivo, atalhos que já iniciam, direção) e tema claro/escuro
- [x] Fase 2: gravação de tela (getDisplayMedia, contagem 3-2-1, grava e rola juntos, download)
- [x] Fase 2.1: duração da gravação, pasta de destino (qualquer pasta), "perguntar sempre onde salvar" e proteção contra perder o vídeo
- [x] Fase 2.2: checkbox "Começar do início da página" (grava sempre do topo)
- [x] Revisão de UI/UX com o design system Aetheris (tokens, Inter + JetBrains Mono, ícones SVG, acessibilidade)
- [ ] Fase 3: MP4 H.264, bitrate, fps, resolução
- [ ] Fase 4: polimento

## Design
Baseado no design system **Aetheris** (escuro: `#030303`, acento mint `#00ffa3`, Inter + JetBrains Mono).
O tema claro é uma derivação com contraste medido (texto ≥ 4,5:1; controles e foco ≥ 3:1).
- `ui/theme.css`: tokens e componentes compartilhados (popup e página de opções)
- `ui/icons.svg`: conjunto único de ícones (sem emojis)
- `fonts/`: Inter e JetBrains Mono locais (a CSP do MV3 não permite fontes remotas)

## Testes
`node tests/e2e.mjs` — tema e scroll.
`node tests/e2e-ui.mjs` — UI/UX: contraste real nos dois temas, foco, nomes acessíveis, altura ≤ 600 px, movimento reduzido, teclado.
`node tests/e2e-save.mjs` — duração, pasta, "perguntar sempre", cancelar/salvar de novo/descartar.
`node tests/e2e-record.mjs` — fluxo de gravação (a fonte de vídeo é simulada; o seletor de tela real não existe sem monitor). `CANCEL=1` testa o cancelamento do seletor.
