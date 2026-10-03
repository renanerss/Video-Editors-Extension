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

## Qualidade do vídeo
Painel **Vídeo** no popup. Os valores ficam salvos e são travados durante a gravação.
- **Resolução:** o *lado menor* vira o valor escolhido (1080p vale para tela 16:9 e para janela vertical), mantendo a proporção. Nunca aumenta além da fonte: gravar uma janela 720p em "1080p" sairia 720p. Cada quadro passa por um canvas, então o tamanho final é exato, mas gasta mais CPU que a gravação nativa.
- **Quadros:** 24, 30 ou 60 fps. É um teto: se a fonte entregar menos, o vídeo sai com menos.
- **Qualidade:** bitrate Alta (50 Mbps ≈ 375 MB/min), Média (25) ou Leve (10).
- **Formato:** MP4 só é gerado com H.264 (`avc1`) — abre direto no Premiere/After Effects. Se o Chrome não tiver o codec, cai para WebM e o popup avisa. Chromium sem codecs proprietários (como o dos testes) sempre cai em WebM.

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
