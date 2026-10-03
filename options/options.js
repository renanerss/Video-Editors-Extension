const $ = (id) => document.getElementById(id);
const OPTS = { mode: "readwrite" };

async function setFolderName(name) {
  const { recSettings = {} } = await chrome.storage.local.get("recSettings");
  await chrome.storage.local.set({ recSettings: { ...recSettings, folderName: name } });
}

async function render(message = "") {
  const dir = await FolderStore.load();
  $("current").textContent = dir ? dir.name : "Downloads (padrão do Chrome)";
  $("authorize").hidden = $("clear").hidden = !dir;
  let perm = "";
  if (dir) {
    const state = await dir.queryPermission(OPTS);
    perm = state === "granted" ? "✓ Autorizada para salvar." : "⚠ Precisa de autorização. Clique em “Autorizar de novo”.";
  }
  $("perm").textContent = perm;
  $("msg").textContent = message;
}

$("choose").addEventListener("click", async () => {
  try {
    const dir = await showDirectoryPicker({ ...OPTS, id: "scroll-recorder" });
    await FolderStore.save(dir);
    await setFolderName(dir.name);
    await render("Pasta salva. Escolha “Permitir em todas as visitas” se o Chrome perguntar, para não precisar autorizar sempre.");
  } catch (e) {
    if (e.name !== "AbortError") await render(`Não foi possível escolher a pasta: ${e.message}`);
  }
});

$("authorize").addEventListener("click", async () => {
  const dir = await FolderStore.load();
  if (!dir) return;
  const state = await dir.requestPermission(OPTS);
  await render(state === "granted" ? "Pasta autorizada." : "Permissão negada.");
});

$("clear").addEventListener("click", async () => {
  await FolderStore.clear();
  await setFolderName(null);
  await render("Pasta removida. Os vídeos vão para Downloads.");
});

(async () => {
  const { theme } = await chrome.storage.local.get("theme");
  document.documentElement.dataset.theme = theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  render();
})();
