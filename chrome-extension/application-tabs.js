// Serialize opens so two cards/clicks cannot both create a tab for the same job.
export function applicationTabs(browser, pendingRequests) {
  let opening = Promise.resolve();
  const storageKey = "jobtracker:applicationTabs";
  const normalized = (raw) => {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("Abra uma vaga HTTPS.");
    return url.href;
  };
  async function open(requestId) {
    // Resolve only a request created and validated by the local backend.
    const request = (await pendingRequests()).find(
      (item) => item.id === requestId,
    );
    if (!request)
      throw new Error(
        "Pedido expirou. Clique em Preencher formulário novamente.",
      );
    const url = normalized(request.url);
    const saved =
      (await browser.storage.session.get(storageKey))[storageKey] ?? {};
    let tab;
    if (Number.isInteger(saved[url])) {
      try {
        tab = await browser.tabs.get(saved[url]);
      } catch {
        delete saved[url];
      }
    }
    if (!tab) {
      const tabs = await browser.tabs.query({});
      tab = tabs.find(
        (candidate) => candidate.url === url || candidate.pendingUrl === url,
      );
    }
    const reused = !!tab;
    if (tab) {
      // Do not set url or reload: keep answers and the company's current step.
      await browser.tabs.update(tab.id, { active: true });
    } else {
      tab = await browser.tabs.create({ url, active: true });
    }
    saved[url] = tab.id;
    await browser.storage.session.set({ [storageKey]: saved });
    await browser.windows.update(tab.windowId, { focused: true });
    return { ok: true, reused, tabId: tab.id };
  }
  return {
    open(requestId) {
      const next = opening.then(() => open(requestId));
      opening = next.catch(() => {});
      return next;
    },
    move(oldId, newId) {
      const next = opening.then(async () => {
        const saved =
          (await browser.storage.session.get(storageKey))[storageKey] ?? {};
        for (const url of Object.keys(saved))
          if (saved[url] === oldId) saved[url] = newId;
        await browser.storage.session.set({ [storageKey]: saved });
      });
      opening = next.catch(() => {});
      return next;
    },
  };
}
