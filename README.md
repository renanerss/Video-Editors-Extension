# Scroll Recorder para Editores

Extensão Chromium (Manifest V3) que rola a página automaticamente em velocidade ajustável — pensada para gravar telas para edição de vídeo.

## Baixar e instalar

**[⬇ Baixar scroll-recorder-1.0.zip](https://github.com/renanerss/Video-Editors-Extension/raw/main/releases/scroll-recorder-1.0.zip)**

Funciona em Google Chrome, Microsoft Edge, Brave e outros navegadores Chromium 116 ou mais novos (veja a [compatibilidade](#compatibilidade-com-navegadores)).

1. **Extraia** o `.zip` numa pasta que você vá manter, por exemplo em Documentos. O navegador carrega a *pasta*, não o zip: se apagar a pasta, a extensão some.
2. Abra `chrome://extensions` (no Edge: `edge://extensions`) e ative o **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação** e escolha a pasta `scroll-recorder` (a que tem o `manifest.json` dentro).
4. Opcional: clique no ícone de quebra-cabeça da barra e **fixe** a extensão.

O Chrome mostra um aviso de extensões em modo desenvolvedor ao abrir. É normal para extensões instaladas fora da Chrome Web Store.

### Como usar
- **Clique no ícone:** Iniciar scroll, velocidade, direção, movimento suave e **Gravar e rolar**.
- **Botão direito no ícone:** "Gravar e rolar (padrão)" e, gravando, "Parar gravação". Usa as opções salvas no popup.
- **Atalho:** `Alt+Shift+R` inicia e para a gravação (mude em `chrome://extensions/shortcuts`).
- **Vídeo:** resolução, quadros por segundo, qualidade e formato (MP4 H.264 ou WebM).
- **Pasta de destino:** botão *Pasta* no popup. Sem escolher, o vídeo vai para Downloads.
- Ao gravar, o Chrome pergunta o que compartilhar (tela, janela ou aba). Escolha a janela da página.
- Páginas internas (`chrome://`, Chrome Web Store) não podem ser controladas.

### Para desenvolvedores
Também dá para carregar esta pasta do repositório direto em `chrome://extensions` > **Carregar sem compactação**.
Para gerar o zip: `bash scripts/build-zip.sh` (cria `releases/scroll-recorder-<versão>.zip` só com os arquivos de execução, mais o `INSTALAR.txt`).

## Status
- [x] Fase 1: auto-scroll (play/pause, velocidade ao vivo, atalhos que já iniciam, direção) e tema claro/escuro
- [x] Fase 2: gravação de tela (getDisplayMedia, contagem 3-2-1, grava e rola juntos, download)
- [x] Fase 2.1: duração da gravação, pasta de destino (qualquer pasta), "perguntar sempre onde salvar" e proteção contra perder o vídeo
- [x] Fase 2.2: checkbox "Começar do início da página" (grava sempre do topo)
- [x] Revisão de UI/UX com o design system Aetheris (tokens, Inter + JetBrains Mono, ícones SVG, acessibilidade)
- [x] Fase 3: qualidade do vídeo — resolução (nativa, 4K, 1440p, 1080p, 720p, com redimensionamento real), fps (24/30/60), bitrate (Alta 50 / Média 25 / Leve 10 Mbps) e formato (MP4 H.264 ou WebM)
- [x] Menu do botão direito no ícone: "Gravar e rolar (padrão)" e, gravando, "Parar gravação" (usa as opções salvas no popup, incluindo a última velocidade e direção)
- [x] Atalho global **Alt+Shift+R** (mesmo comportamento do menu; mude em `chrome://extensions/shortcuts`)
- [x] Cronômetro: tempo decorrido e tamanho do arquivo no popup, tempo no selo do ícone enquanto grava
- [x] Movimento suave (opcional, desligado por padrão): acelera nos primeiros ~1 s e freia nos últimos ~1 s (fim da página ou fim do tempo)
- [x] Fase 4: polimento (itens acima: velocidade lembrada, atalho, cronômetro, movimento suave)

## Qualidade do vídeo
Painel **Vídeo** no popup. Os valores ficam salvos e são travados durante a gravação.
- **Resolução:** o *lado menor* vira o valor escolhido (1080p vale para tela 16:9 e para janela vertical), mantendo a proporção. Nunca aumenta além da fonte: gravar uma janela 720p em "1080p" sairia 720p. Cada quadro passa por um canvas, então o tamanho final é exato, mas gasta mais CPU que a gravação nativa.
- **Quadros:** 24, 30 ou 60 fps. É um teto: se a fonte entregar menos, o vídeo sai com menos.
- **Qualidade:** bitrate Alta (50 Mbps ≈ 375 MB/min), Média (25) ou Leve (10).
- **Formato:** MP4 só é gerado com H.264 (`avc1`) — abre direto no Premiere/After Effects. Se o Chrome não tiver o codec, cai para WebM e o popup avisa. Chromium sem codecs proprietários (como o dos testes) sempre cai em WebM.

## Design
Baseado no design system **Aetheris** (escuro: `#030303`, acento mint `#00ffa3`, Inter + JetBrains Mono).
O tema claro é uma derivação com contraste medido (texto ≥ 4,5:1; controles e foco ≥ 3:1).
- `ui/theme.css`: tokens e componentes compartilhados (popup e página de opções)
- `ui/icons.svg`: conjunto único de ícones (sem emojis)
- `fonts/`: Inter e JetBrains Mono locais (a CSP do MV3 não permite fontes remotas)

## Compatibilidade com navegadores

Auditoria de 2026-10-03. A coluna **Como** diz o que foi realmente verificado.

| Navegador | Situação | Como |
|---|---|---|
| Chrome / Chromium | Funciona | Testado (Chromium, suítes `tests/`) |
| Edge | Esperado | Mesma base; não testado |
| Brave | Esperado | Mesma base; não testado |
| Opera / Opera GX | Esperado nas versões atuais | Não testado. Exige Chromium 116 ou superior (`minimum_chrome_version`); o Opera 116 usa Chromium 131 |
| Vivaldi | Pode falhar no popup | Não testado. Veja "Vivaldi" abaixo |
| Firefox | **Não instala** | Testado no Firefox 157: `background.service_worker is currently disabled` |
| Safari | **Inviável** com esta arquitetura | Documentação e dados da MDN; não testado |

### Vivaldi
Relatos no fórum oficial descrevem popups de extensão quebrados quando o **zoom da interface não é 100%**
(o popup vira um quadradinho ou some) e quando o ícone da extensão **não está na barra de ferramentas**.
O Vivaldi também tem bugs conhecidos na API `sidePanel` (usada pelo Claude in Chrome). Se o popup não abrir:
confira o zoom da interface e fixe o ícone na barra.

### Por que não Firefox / Safari
| Recurso usado pela gravação | Chrome/Edge/Opera | Firefox | Safari |
|---|---|---|---|
| `offscreen` (documento que segura a gravação) | sim | não | não |
| `background.service_worker` | sim | não (usa `background.scripts`) | sim |
| `downloads` | sim | sim | **não** |
| `showDirectoryPicker` (escolher qualquer pasta) | sim | **não** | **não** |
| MP4 H.264 no `MediaRecorder` | depende do codec do sistema | medido: **não** (só WebM VP8) | sim (documentado) |

Um port para Firefox seria viável para o **scroll**; a **gravação** precisaria de redesenho
(WebM, só dentro de Downloads, sem documento offscreen). Safari exigiria macOS e Xcode e perderia
gravação e escolha de pasta.

Fontes: [MDN Browser Compat Data](https://github.com/mdn/browser-compat-data),
[Chrome: API offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[Vivaldi: bugs de popup](https://forum.vivaldi.net/topic/116215/extension-popup-bugs),
[Vivaldi: popups não abrem](https://forum.vivaldi.net/topic/107999/extension-pop-ups-not-working),
[Opera 116](https://blogs.opera.com/desktop/2025/01/opera-116/),
[Firefox: MediaRecorder e video/mp4](https://bugzilla.mozilla.org/show_bug.cgi?id=1631143).

## Testes
`node tests/e2e.mjs` — tema e scroll.
`node tests/e2e-ui.mjs` — UI/UX: contraste real nos dois temas, foco, nomes acessíveis, altura ≤ 600 px, movimento reduzido, teclado.
`node tests/e2e-save.mjs` — duração, pasta, "perguntar sempre", cancelar/salvar de novo/descartar.
`node tests/e2e-quality.mjs` — resolução, fps, bitrate e formato medidos com ffprobe (precisa de ffmpeg).
`node tests/e2e-menu.mjs` — menu do botão direito no ícone (inicia com o padrão, vira "Parar", respeita duração).
`node tests/e2e-clock.mjs` — cronômetro, tamanho do arquivo e selo do ícone.
`node tests/e2e-ease.mjs` — movimento suave: mede a velocidade real do scroll no início, meio e fim.
`node tests/e2e-record.mjs` — fluxo de gravação (a fonte de vídeo é simulada; o seletor de tela real não existe sem monitor). `CANCEL=1` testa o cancelamento do seletor.
