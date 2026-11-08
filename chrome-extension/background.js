import { inspectApplicationDocument } from "./navigation.js";
import { fillCurrentDocument } from "./fill.js";
import { applicationTabs } from "./application-tabs.js";
import { presentationDocument } from "./presentation.js";
const API = "http://127.0.0.1:3333/form-fill/chrome";
const runs = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (id) => "jobtracker:" + id;
// Lazy construction also keeps the filling engine independent of the app bridge.
let appTabs;
function tabsForApplication() {
  return (appTabs ??= applicationTabs(chrome, async () => {
    const response = await fetch(API + "/pending", {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error("Não consegui consultar o aplicativo local.");
    return response.json();
  }));
}
async function save(state) {
  runs.set(state.currentId, state);
  if (state.closed) {
    await chrome.storage?.session?.remove(key(state.currentId));
    return;
  }
  // Session storage contains only the request identifier and progress, never CV answers/PDF.
  await chrome.storage?.session?.set({
    [key(state.currentId)]: { ...state, running: false },
  });
}
async function restore(tabId) {
  if (runs.has(tabId)) {
    const cached = runs.get(tabId);
    if (!cached.running && cached.expiresAt < Date.now()) {
      cached.active = false;
      cached.message =
        "O pedido expirou. Abra a vaga novamente pelo aplicativo.";
    }
    return cached;
  }
  const stored = (await chrome.storage?.session?.get(key(tabId)))?.[key(tabId)];
  if (!stored) return null;
  stored.running = false;
  if (stored.expiresAt < Date.now()) {
    stored.active = false;
    stored.message = "O pedido expirou. Abra a vaga novamente pelo aplicativo.";
  }
  runs.set(tabId, stored);
  return stored;
}
async function currentPage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "loading" && (!tab.url || tab.url === "about:blank"))
    return tab;
  if (!tab.url?.startsWith("https://"))
    throw new Error("Abra uma página HTTPS de vaga.");
  return tab;
}
async function execute(tabId, func, args) {
  return (
    await chrome.scripting.executeScript({ target: { tabId }, func, args })
  )[0]?.result;
}
async function readPlan(requestId, url) {
  const response = await fetch(API + "/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, url }),
    signal: AbortSignal.timeout(15000),
  });
  const plan = await response.json();
  if (!response.ok)
    throw new Error(plan.message ?? "Não consegui carregar o currículo.");
  return plan;
}
async function personalizePresentation(state, tab, plan) {
  if (!plan.presentation?.enabled) return false;
  const field = await execute(tab.id, presentationDocument, []);
  if (field?.kind !== "empty") return false;
  state.message = "Preparando sua apresentação para esta empresa…";
  await save(state);
  const deadline = Date.now() + 180000;
  while (state.active && Date.now() < deadline) {
    const current = await currentPage(state.currentId);
    if (current.id !== tab.id || current.url !== tab.url) return false;
    // Also check while waiting: manual edits always take precedence over the draft.
    const stillEmpty = await execute(tab.id, presentationDocument, []);
    if (stillEmpty?.kind !== "empty") return false;
    const response = await fetch(API + "/presentation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: state.requestId,
        url: tab.url,
        maxChars: field.maxChars,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const draft = await response.json();
    if (!state.active) return false;
    if (!response.ok || draft.status === "error")
      throw new Error(
        draft.message ??
          "Não consegui gerar a apresentação. Preencha esse campo manualmente.",
      );
    if (draft.status === "ready") {
      const latest = await currentPage(state.currentId);
      if (latest.id !== tab.id || latest.url !== tab.url) return false;
      const written = await execute(tab.id, presentationDocument, [draft.text]);
      if (written?.kind === "invalid")
        throw new Error(
          "A apresentação excedeu o limite. Revise esse campo manualmente.",
        );
      return written?.generated === true;
    }
    await pause(1500);
  }
  if (state.active)
    throw new Error(
      "A apresentação demorou para ficar pronta. Tente novamente pela extensão ou escreva esse campo manualmente.",
    );
  return false;
}
async function validateTarget(url) {
  const response = await fetch(API + "/validate-target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "O link da próxima etapa não foi autorizado pelo aplicativo local.",
    );
}
async function suspend(state, message, signature) {
  state.message = message;
  state.pauseSignature = signature ?? null;
  state.running = false;
  await save(state);
  await chrome.action.setBadgeText({ tabId: state.currentId, text: "!" });
}
async function moveToChild(state, popup, loginAction = false) {
  const previous = state.currentId;
  if (!loginAction) await tabsForApplication().move(previous, popup.id);
  if (loginAction) state.loginParentId = previous;
  state.currentId = popup.id;
  await chrome.storage?.session?.remove(key(previous));
  runs.set(state.currentId, state);
  await save(state);
  await chrome.tabs.update(state.currentId, { active: true });
}
async function clickStep(state, navigation, step, phase) {
  if (!state.active) return;
  if (step.href) {
    await validateTarget(step.href);
    if (state.active)
      await chrome.tabs.update(state.currentId, { url: step.href });
    return;
  }
  let popup = null;
  const parent = state.currentId;
  const listener = (tab) => {
    if (tab.openerTabId === parent) popup = tab;
  };
  chrome.tabs.onCreated.addListener(listener);
  try {
    try {
      const result = await execute(parent, inspectApplicationDocument, [
        navigation,
        step.key,
        phase,
      ]);
      if (result?.kind !== "clicked") {
        const error = new Error(
          "O botão mudou ou há campos inválidos. Corrija e continue; a extensão retomará na próxima página.",
        );
        error.review = true;
        error.signature = result?.signature;
        throw error;
      }
    } catch (error) {
      // Navigation can destroy the executing frame. Do not click a second time.
      if (!/frame|document|context|removed|navigation/i.test(error.message))
        throw error;
    }
    await pause(700);
    if (popup?.id) {
      let exists = true;
      if (step.loginAction) {
        try {
          await chrome.tabs.get(popup.id);
        } catch {
          exists = false;
        }
      }
      if (exists) await moveToChild(state, popup, step.loginAction);
    }
  } finally {
    chrome.tabs.onCreated.removeListener(listener);
  }
}
async function runFlow(state) {
  if (state.running || !state.active) return;
  state.running = true;
  state.pauseSignature = null;
  runs.set(state.currentId, state);
  try {
    await save(state);
    const initial = await currentPage(state.currentId);
    if (new URL(initial.url).hostname === "accounts.google.com") {
      await suspend(
        state,
        "Conclua o login. A extensão retomará quando você voltar ao formulário.",
        null,
      );
      return;
    }
    const plan = await readPlan(state.requestId, initial.url);
    if (!plan.navigation)
      throw new Error(
        "Atualize o aplicativo local para usar a navegação automática.",
      );
    state.expiresAt = Date.now() + 10 * 60_000;
    const visited = new Set();
    let steps = 0,
      lastStepAt = 0;
    const deadline = Date.now() + 90000;
    while (state.active && Date.now() < deadline) {
      const tab = await currentPage(state.currentId);
      if (tab.status !== "complete") {
        await pause(300);
        continue;
      }
      if (new URL(tab.url).hostname === "accounts.google.com") {
        await suspend(
          state,
          "Conclua o login. A extensão retomará quando você voltar ao formulário.",
          null,
        );
        return;
      }
      const navigation = { ...plan.navigation, followingForm: state.hadForm };
      await execute(state.currentId, inspectApplicationDocument, [
        navigation,
        null,
        "watch",
      ]);
      const found = await execute(state.currentId, inspectApplicationDocument, [
        navigation,
      ]);
      if (found?.kind === "assessment-ready") {
        state.active = false;
        state.message =
          found.reason === "ready"
            ? "Preparação do teste concluída. O botão Começar a responder está disponível para você continuar."
            : found.reason === "ranking"
              ? found.ranking?.duplicate
                ? "Questão de ordenação: há posições repetidas. Use 1, 2 e 3 uma única vez; 1 indica maior importância."
                : found.ranking?.complete
                  ? "Ordenação 1–3 completa. Confira se representa suas preferências e use Próximo passo."
                  : "Questão de ordenação identificada: 1 é maior importância e 3 é menor. Escolha duas posições diferentes; o site completa a restante."
              : "Esta etapa do teste exige sua participação. Continue manualmente; a extensão automatiza somente as telas de preparação.";
        await chrome.action.setBadgeText({ tabId: state.currentId, text: "✓" });
        return;
      }
      if (found?.kind === "assessment-step") {
        state.assessmentVisited ??= [];
        if (state.assessmentVisited.includes(found.signature)) {
          if (Date.now() - (state.assessmentLastStepAt ?? 0) < 6000) {
            await pause(300);
            continue;
          }
          await suspend(
            state,
            "A preparação não mudou de tela. Confira o teste e continue manualmente.",
            found.signature,
          );
          return;
        }
        if (state.assessmentVisited.length >= 10) {
          await suspend(
            state,
            "A preparação atingiu o limite de etapas. Continue manualmente no teste.",
            found.signature,
          );
          return;
        }
        state.assessmentVisited.push(found.signature);
        state.assessmentLastStepAt = Date.now();
        state.message =
          found.stage === "entry" || found.stage === "intro"
            ? "Abrindo a preparação do teste comportamental…"
            : "Avançando pelas dicas do teste comportamental…";
        await save(state);
        await clickStep(state, navigation, found, "assessment");
        await pause(300);
        continue;
      }
      if (found?.kind === "login" || found?.kind === "challenge") {
        await suspend(
          state,
          "Conclua o login ou a verificação de acesso. A extensão retomará ao mudar de etapa.",
          null,
        );
        return;
      }
      if (state.loginReturned && found?.loginAction) {
        state.loginReturned = false;
        await suspend(
          state,
          "O login não foi concluído. Entre com Google no site; a extensão retomará quando o formulário aparecer.",
          null,
        );
        return;
      }
      state.loginReturned = false;
      if (found?.kind === "form") {
        state.hadForm = true;
        const freshPlan = await readPlan(state.requestId, tab.url);
        if (!state.active) break;
        const presentationFilled = await personalizePresentation(
          state,
          tab,
          freshPlan,
        );
        if (!state.active) break;
        let report = await execute(state.currentId, fillCurrentDocument, [
          freshPlan,
        ]);
        if (presentationFilled)
          report.filled.push(
            "apresentação personalizada — revise antes de enviar",
          );
        await pause(300);
        let progress = await execute(
          state.currentId,
          inspectApplicationDocument,
          [navigation, null, "progress"],
        );
        const salaryFields = freshPlan.fields.filter((field) =>
          ["último salário", "pretensão salarial"].includes(field.what),
        );
        if (
          state.active &&
          progress?.kind === "review" &&
          progress.missing.some((label) =>
            salaryFields.some((field) =>
              new RegExp(field.labels, field.flags).test(label),
            ),
          )
        ) {
          // Some ATS redraw the question controls after the first input events.
          // Retry empty salary fields once, after that update; never overwrite answers.
          await pause(750);
          if (!state.active) break;
          const retried = await execute(state.currentId, fillCurrentDocument, [
            {
              ...freshPlan,
              fields: salaryFields,
              attachment: null,
              facts: { skills: [] },
            },
          ]);
          report = {
            ...retried,
            filled: [
              ...new Set([
                ...(report?.filled ?? []),
                ...(retried?.filled ?? []),
              ]),
            ],
          };
          await pause(300);
          progress = await execute(
            state.currentId,
            inspectApplicationDocument,
            [navigation, null, "progress"],
          );
        }
        for (
          let wait = 0;
          progress?.kind === "pending" && wait < 15 && state.active;
          wait++
        ) {
          await pause(400);
          progress = await execute(
            state.currentId,
            inspectApplicationDocument,
            [navigation, null, "progress"],
          );
        }
        if (!state.active) break;
        if (progress?.kind === "pending") {
          await suspend(
            state,
            "O botão de continuação está desabilitado. Confira os campos e continue manualmente; a extensão retomará na próxima página.",
            progress.signature,
          );
          return;
        }
        if (progress?.kind === "review") {
          await suspend(
            state,
            "Faltam respostas obrigatórias ou há campos inválidos: " +
              progress.missing.slice(0, 4).join("; ") +
              ". Responda e use Continuar/Avançar; a extensão retomará na próxima página.",
            progress.signature,
          );
          return;
        }
        if (progress?.kind === "final") {
          state.active = false;
          state.message =
            (report?.filled.length
              ? "Preenchido: " + report.filled.join(", ") + ". "
              : "") +
            "Cheguei à etapa final. Revise e envie você mesmo." +
            (report?.needsReview?.some((label) => /^CPF\b/i.test(label)) &&
            !freshPlan.fields.some((field) => field.what === "CPF")
              ? " O CPF não está cadastrado no currículo selecionado; salve-o em Currículo → Preenchimento de candidaturas."
              : "");
          await chrome.action.setBadgeText({
            tabId: state.currentId,
            text: report?.needsReview?.length ? "!" : "✓",
          });
          return;
        }
        if (progress?.kind !== "next") {
          await pause(300);
          continue;
        }
        if (
          state.formSteps >= 20 ||
          state.advanced.includes(progress.signature)
        ) {
          await suspend(
            state,
            "A continuação chegou ao limite de etapas ou repetiu uma página. Continue manualmente.",
            progress.signature,
          );
          return;
        }
        state.message = `Continuando o formulário — etapa ${state.formSteps + 1}…`;
        state.formSteps++;
        state.advanced.push(progress.signature);
        await save(state);
        await clickStep(state, navigation, progress, "progress");
        let changed = false;
        for (let attempt = 0; attempt < 24 && state.active; attempt++) {
          await pause(350);
          const nextTab = await currentPage(state.currentId);
          if (nextTab.status !== "complete") continue;
          try {
            const next = await execute(
              state.currentId,
              inspectApplicationDocument,
              [navigation, null, "progress"],
            );
            if (next?.signature && next.signature !== progress.signature) {
              changed = true;
              break;
            }
            if (next?.kind === "login" || next?.kind === "challenge") {
              await suspend(
                state,
                "Conclua o login ou a verificação. A extensão retomará quando você voltar ao formulário.",
                null,
              );
              return;
            }
            if (next?.kind === "review") {
              await suspend(
                state,
                "O site apontou campos obrigatórios ou inválidos: " +
                  next.missing.slice(0, 4).join("; ") +
                  ". Corrija e continue; a extensão retomará na próxima página.",
                next.signature,
              );
              return;
            }
          } catch {
            /* document still navigating */
          }
        }
        if (!state.active) break;
        if (!changed) {
          await suspend(
            state,
            "A página não avançou. Confira as validações e continue manualmente; a extensão retomará na próxima etapa.",
            progress.signature,
          );
          return;
        }
        continue;
      }
      if (found?.kind !== "navigate") {
        await pause(400);
        continue;
      }
      if (steps >= plan.navigation.maxSteps)
        throw new Error(
          "Limite de quatro redirecionamentos atingido. Continue manualmente até o formulário.",
        );
      const visit = tab.url + "|" + found.key;
      if (visited.has(visit)) {
        if (Date.now() - lastStepAt < 6000) {
          await pause(400);
          continue;
        }
        throw new Error(
          "O botão retornou à mesma etapa. Continue manualmente no site.",
        );
      }
      visited.add(visit);
      steps++;
      lastStepAt = Date.now();
      state.message = `Abrindo etapa ${steps}: ${new URL(tab.url).hostname}…`;
      await save(state);
      await clickStep(state, navigation, found, "discover");
      await pause(400);
    }
    if (state.active) {
      await suspend(
        state,
        "O site demorou para mudar de etapa. Continue manualmente; a extensão retomará quando a página mudar.",
        null,
      );
    }
  } catch (error) {
    if (error.review) {
      await suspend(state, error.message, error.signature);
    } else {
      state.active = false;
      state.message = error.message ?? "Não consegui continuar o formulário.";
    }
  } finally {
    state.running = false;
    await save(state);
  }
}
async function resume(tabId, signature = null) {
  const state = await restore(tabId);
  if (
    !state?.active ||
    state.running ||
    state.currentId !== tabId ||
    state.expiresAt < Date.now()
  )
    return;
  if (signature && signature === state.pauseSignature) return;
  await runFlow(state);
}
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (change.status === "complete") void resume(tabId).catch(() => {});
});
chrome.tabs.onRemoved?.addListener((tabId) => {
  void (async () => {
    const state = await restore(tabId);
    runs.delete(tabId);
    await chrome.storage?.session?.remove(key(tabId));
    if (state?.currentId !== tabId) return;
    if (state.active && state.loginParentId) {
      const parent = state.loginParentId;
      state.loginParentId = null;
      try {
        await chrome.tabs.get(parent);
        state.currentId = parent;
        state.loginReturned = true;
        // Login normally closes only after the workflow has paused for the user.
        for (let wait = 0; state.running && wait < 20; wait++) await pause(100);
        await save(state);
        await chrome.tabs.update(parent, { active: true });
        await resume(parent);
        return;
      } catch {
        /* parent tab has also closed */
      }
    }
    state.active = false;
    state.closed = true;
  })().catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.tab) {
    const localApp = /^http:\/\/(127\.0\.0\.1|localhost):3000\//.test(
      sender.url ?? "",
    );
    const handoff =
      /^http:\/\/127\.0\.0\.1:3333\/form-fill\/chrome\/open\?/.test(
        sender.url ?? "",
      );
    if ((localApp || handoff) && message.type === "ping") {
      reply({ ok: true });
      return;
    }
    if ((localApp || handoff) && message.type === "openRequest") {
      void tabsForApplication()
        .open(message.requestId)
        .then(async (result) => {
          reply(result);
          // Only the disposable local handoff tab can close itself.
          if (handoff && message.handoff && result.tabId !== sender.tab.id)
            await chrome.tabs.remove(sender.tab.id);
        })
        .catch((error) => reply({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "documentChanged")
      void resume(sender.tab.id, message.signature).catch(() => {});
    return;
  }
  if (message.type === "status") {
    if (runs.has(message.tabId)) {
      reply(runs.get(message.tabId));
      return;
    }
    void restore(message.tabId).then(reply);
    return true;
  }
  if (message.type === "stop") {
    void restore(message.tabId).then(async (state) => {
      if (state) {
        state.active = false;
        state.message = "Automação parada por você.";
        await save(state);
      }
      reply({ stopped: true });
    });
    return true;
  }
  if (message.type === "start") {
    if (!runs.get(message.tabId)?.running) {
      const state = {
        requestId: message.requestId,
        currentId: message.tabId,
        active: true,
        running: false,
        hadForm: false,
        formSteps: 0,
        advanced: [],
        expiresAt: Date.now() + 10 * 60_000,
        message: "Procurando o formulário…",
        pauseSignature: null,
      };
      runs.set(message.tabId, state);
      void runFlow(state);
    }
    reply({ started: true });
  }
});
