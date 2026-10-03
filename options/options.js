const $ = (id) => document.getElementById(id);
const OPTS = { mode: "readwrite" };

async function setFolderName(name) {
  const { recSettings = {} } = await chrome.storage.local.get("recSettings");
  await chrome.storage.local.set({ recSettings: { ...recSettings, folderName: name } });
}

const setIcon = (id, name) => $(id).setAttribute("href", `../ui/icons.svg#${name}`);

// Mensagem de retorno de uma ação: ícone + texto (cor nunca é o único sinal).
function say(message, state = "success") {
  $("msg").dataset.state = message ? state : "idle";
  setIcon("msgIcon", state === "error" ? "alert" : "check");
  $("msgText").textContent = message;
  $("msg").hidden = !message;
}

async function render(message = "", state = "success") {
  const dir = await FolderStore.load();
  $("current").textContent = dir ? dir.name : "Downloads (padrão do Chrome)";
  $("authorize").hidden = $("clear").hidden = !dir;
  const perm = $("perm");
  if (!dir) {
    perm.dataset.state = "none";
    perm.hidden = true;
  } else {
    perm.hidden = false;
    const ok = (await dir.queryPermission(OPTS)) === "granted";
    $("authorize").hidden = ok; // só faz sentido quando a autorização foi perdida
    perm.dataset.state = ok ? "ok" : "warn";
    setIcon("permIcon", ok ? "check" : "alert");
    $("permText").textContent = ok ? "Autorizada para salvar." : "Precisa de autorização. Clique em “Autorizar de novo”.";
  }
  say(message, state);
}

$("choose").addEventListener("click", async () => {
  try {
    const dir = await showDirectoryPicker({ ...OPTS, id: "scroll-recorder" });
    await FolderStore.save(dir);
    await setFolderName(dir.name);
    await render("Pasta salva. Escolha “Permitir em todas as visitas” se o Chrome perguntar, para não precisar autorizar sempre.");
  } catch (e) {
    if (e.name !== "AbortError") await render(`Não foi possível escolher a pasta: ${e.message}`, "error");
  }
});

$("authorize").addEventListener("click", async () => {
  const dir = await FolderStore.load();
  if (!dir) return;
  const state = await dir.requestPermission(OPTS);
  await render(state === "granted" ? "Pasta autorizada." : "Permissão negada.", state === "granted" ? "success" : "error");
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
