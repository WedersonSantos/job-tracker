const API = "http://127.0.0.1:3333/form-fill/chrome";
document.querySelector("#version").textContent =
  "Versão " + chrome.runtime.getManifest().version;
const select = document.querySelector("#request"),
  status = document.querySelector("#status"),
  button = document.querySelector("#fill");
const stop = document.querySelector("#stop");
let active;
let usingProfiles = false;
let starting = false;
const profileSelected = () =>
  select.selectedOptions[0]?.dataset.source === "profile";
async function updateStatus() {
  if (!active || starting || profileSelected()) return;
  const state = await chrome.runtime.sendMessage({
    type: "status",
    tabId: active.id,
  });
  if (state) {
    status.textContent = state.message;
    button.disabled = state.running || select.options.length === 0;
    select.disabled = state.running;
    stop.hidden = !state.active;
  }
}
try {
  [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (
    !active?.url?.startsWith("https://") ||
    new URL(active.url).hostname === "accounts.google.com"
  )
    throw new Error("Conclua o login e abra a página HTTPS da vaga.");
  document.querySelector("#destination").textContent =
    "Começar em: " + new URL(active.url).hostname;
  const response = await fetch(API + "/pending", {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Não consegui acessar o Job Tracker local.");
  const requests = await response.json();
  for (const request of requests) {
    const option = document.createElement("option");
    option.value = request.id;
    option.dataset.source = "request";
    option.textContent = request.name + " — " + new URL(request.url).hostname;
    select.append(option);
  }
  if (!requests.length) {
    // Requests are temporary; saved CVs survive server restarts. Let the user
    // explicitly choose one and prepare a fresh request for this very tab.
    const profilesResponse = await fetch(new URL("/profiles", API).href, {
      signal: AbortSignal.timeout(15000),
    });
    if (!profilesResponse.ok)
      throw new Error(
        "Não consegui carregar os currículos. Confira o aplicativo local.",
      );
    const profiles = await profilesResponse.json();
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.dataset.source = "profile";
      option.textContent = profile.name;
      select.append(option);
    }
    if (!profiles.length)
      throw new Error(
        "Cadastre e salve um currículo no Job Tracker antes de preencher.",
      );
    usingProfiles = true;
  }
  status.textContent = usingProfiles
    ? "Escolha um currículo salvo para preencher esta aba."
    : "Confira o currículo e clique para abrir o formulário e preencher.";
  button.disabled = false;
  await updateStatus();
} catch (error) {
  status.textContent = error.message ?? "Mantenha o aplicativo local ligado.";
}
void updateStatus().catch(() => {});
setInterval(() => {
  void updateStatus().catch(() => {});
}, 600);
select.addEventListener("change", () => {
  if (!starting && profileSelected()) {
    status.textContent = "Escolha um currículo salvo para preencher esta aba.";
    button.disabled = select.options.length === 0;
  }
});
stop.addEventListener("click", async () => {
  if (active) {
    await chrome.runtime.sendMessage({ type: "stop", tabId: active.id });
    await updateStatus();
  }
});
button.addEventListener("click", async () => {
  if (starting) return;
  starting = true;
  button.disabled = true;
  select.disabled = true;
  let started = false;
  try {
    // The user explicitly grants cross-site access through Chrome's permission prompt.
    const allowed = await chrome.permissions.request({
      origins: ["https://*/*"],
    });
    if (!allowed)
      throw new Error(
        "Para navegar entre portais e empresas, permita o acesso HTTPS solicitado pelo Chrome.",
      );
    const [current] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (current?.id !== active.id || current.url !== active.url)
      throw new Error("A aba mudou. Abra a extensão novamente.");
    let requestId = select.value;
    if (profileSelected()) {
      const response = await fetch(
        API + "?profileId=" + encodeURIComponent(select.value),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: current.url, prepareOnly: true }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const prepared = await response.json();
      if (!response.ok || typeof prepared.requestId !== "string")
        throw new Error(
          prepared.message ??
            "Não consegui preparar o currículo para esta aba.",
        );
      requestId = prepared.requestId;
      const [latest] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (latest?.id !== active.id || latest.url !== active.url)
        throw new Error("A aba mudou. Abra a extensão novamente.");
      // Keep the selected CV label; subsequent clicks renew this same request.
      select.selectedOptions[0].value = requestId;
      select.selectedOptions[0].dataset.source = "request";
    }
    await chrome.runtime.sendMessage({
      type: "start",
      tabId: active.id,
      requestId,
    });
    started = true;
    status.textContent =
      "Abrindo o caminho até o formulário. Você pode fechar este painel.";
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  } finally {
    starting = false;
    if (started) await updateStatus().catch(() => {});
    else select.disabled = false;
  }
});
