/** Runs in the selected tab; does not submit forms or enter credentials. */
export function inspectApplicationDocument(
  navigation,
  clickKey = null,
  phase = "discover",
) {
  const gupy = /(^|\.)gupy\.io$/i.test(location.hostname);
  const visible = (e) =>
    !!e.getClientRects().length &&
    getComputedStyle(e).visibility !== "hidden" &&
    !e.disabled;
  const gupyWelcome = () => {
    if (
      !gupy ||
      !/^\/candidates\/applications\/\d+\/steps\/\d+\/curriculum\/?$/.test(
        location.pathname,
      )
    )
      return false;
    const text = document.body.innerText.replace(/\s+/g, " ");
    if (!/vamos continuar sua candidatura/i.test(text)) return false;
    if (
      [
        ...document.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]),textarea,select,[role="textbox"],[role="combobox"]',
        ),
      ].some(visible)
    )
      return false;
    const labels = [...document.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .map((e) => (e.getAttribute("aria-label") || e.innerText || "").trim());
    return (
      labels.filter((label) => /^continuar$/i.test(label)).length === 1 &&
      !labels.some((label) =>
        /^(finalizar candidatura|enviar candidatura|submit application|candidatar-se)$/i.test(
          label,
        ),
      )
    );
  };
  const prompt = (e) => {
    const q = e.closest('[role="listitem"],.Qr7Oae');
    return (
      q?.querySelector('[role="heading"]')?.textContent ||
      e.getAttribute("aria-label") ||
      [...(e.labels ?? [])].map((l) => l.textContent).join(" ") ||
      e.closest(".ashby-application-form-field-entry")?.querySelector("label")
        ?.textContent ||
      e.name ||
      e.id ||
      "Campo obrigatório"
    )
      .replace(/\s+/g, " ")
      .trim();
  };
  const signature = () => {
    const controls = [
      ...document.querySelectorAll(
        'input,textarea,select,[role="checkbox"],[role="radiogroup"],[role="listbox"]',
      ),
    ]
      .filter(visible)
      .map((e) => [
        e.name || e.id,
        e.getAttribute("type") || e.getAttribute("role"),
        prompt(e),
      ]);
    const titles = [
      ...document.querySelectorAll('[role="heading"],h1,h2,h3,legend'),
    ]
      .filter(visible)
      .map((e) => e.textContent.trim());
    const progress =
      document.body.innerText.match(
        /(?:p[aá]gina|etapa|page|step)\s*\d+\s*(?:de|of|\/)\s*\d+/i,
      )?.[0] ?? "";
    return JSON.stringify([
      location.origin + location.pathname,
      titles,
      controls,
      progress,
      [...document.querySelectorAll('button,[role="button"]')]
        .filter(visible)
        .map((e) => (e.getAttribute("aria-label") || e.innerText || "").trim()),
    ]);
  };
  const googleLogin = new RegExp(
    navigation.google ??
      "^(?:(?:entrar|continuar|acessar|cadastrar(?:-se)?)(?: (?:com|usando)) (?:o )?google|(?:sign in|log in|continue|sign up) with google)$",
    "i",
  );
  const googleButtons = () =>
    [
      ...document.querySelectorAll('a,button,[role="button"],[role="link"]'),
    ].filter(
      (e) =>
        visible(e) &&
        e.getAttribute("aria-disabled") !== "true" &&
        !/^(submit|image)$/i.test(e.getAttribute("type") ?? "") &&
        googleLogin.test(
          (e.getAttribute("aria-label") || e.innerText || "")
            .replace(/\s+/g, " ")
            .trim(),
        ),
    );
  if (phase === "watch") {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage)
      return { kind: "watch-unavailable" };
    if (globalThis.__jobTrackerProgressWatcher) return { kind: "watching" };
    let previous = signature(),
      timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = signature();
        if (next === previous) return;
        previous = next;
        void chrome.runtime
          .sendMessage({ type: "documentChanged", signature: next })
          .catch(() => {});
      }, 700);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "class",
        "style",
        "disabled",
        "aria-disabled",
        "aria-hidden",
      ],
    });
    globalThis.__jobTrackerProgressWatcher = observer;
    return { kind: "watching" };
  }
  if (
    location.hostname === "accounts.google.com" ||
    ([...document.querySelectorAll("input[type=password]")].some(visible) &&
      (phase === "progress" || !googleButtons().length))
  )
    return { kind: "login" };
  if (
    /just a moment|access denied|attention required/i.test(document.title) ||
    [...document.querySelectorAll("#challenge-running,#challenge-stage")].some(
      visible,
    )
  )
    return { kind: "challenge" };
  // Only the preparation screens of the behavioral assessment are automated.
  // Keep this ahead of generic form/Next detection so questions are never filled.
  const behavioral =
    location.hostname === "assessments.gupy.io" &&
    /^\/behavioral\/[^/]+\/?$/.test(location.pathname);
  const foldAssessment = (text) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const assessmentButtons = [
    ...document.querySelectorAll('a,button,[role="button"]'),
  ].filter((el) => visible(el) && el.getAttribute("aria-disabled") !== "true");
  const assessmentLabel = (el) =>
    foldAssessment(el.getAttribute("aria-label") || el.innerText || "");
  let preparation = null;
  if (behavioral) {
    const text = foldAssessment(document.body.innerText);
    const questions = [
      ...document.querySelectorAll(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]),textarea,select,[role="radio"],[role="checkbox"],[role="textbox"],[role="combobox"]',
      ),
    ].some(visible);
    if (
      assessmentButtons.some(
        (el) => assessmentLabel(el) === "comecar a responder",
      )
    )
      return { kind: "assessment-ready", reason: "ready" };
    if (
      text.includes("ordene os itens de acordo com suas preferencias") &&
      /1 (?:muito|mais) importante/.test(text) &&
      /3 menos importante/.test(text)
    ) {
      const controls = [
        ...new Set(
          [
            ...document.querySelectorAll(
              'select,[role="combobox"],button[aria-haspopup="listbox"]',
            ),
          ]
            .filter(visible)
            .map((el) => el.closest('[role="combobox"]') ?? el),
        ),
      ];
      const items =
        controls.length === 3
          ? controls.map((control) => {
              const raw =
                control.tagName === "SELECT"
                  ? (control.selectedOptions[0]?.textContent ?? "")
                  : control.getAttribute("aria-valuenow") ||
                    control.value ||
                    control.textContent ||
                    "";
              const rank = /^[123]$/.test(raw.trim())
                ? Number(raw.trim())
                : null;
              let statement = "";
              for (
                let row = control.parentElement, depth = 0;
                row && row !== document.body && depth < 6;
                row = row.parentElement, depth++
              ) {
                if (
                  controls.filter((other) => row.contains(other)).length !== 1
                )
                  break;
                const copy = row.cloneNode(true);
                copy
                  .querySelectorAll(
                    'select,input,button,svg,[role="listbox"],[role="combobox"]',
                  )
                  .forEach((el) => el.remove());
                const candidate = (copy.textContent ?? "")
                  .replace(/\s+/g, " ")
                  .trim();
                if (candidate) {
                  statement = candidate;
                  break;
                }
              }
              return { statement, rank };
            })
          : [];
      const assigned = items
        .map((item) => item.rank)
        .filter((rank) => rank !== null);
      const distinct = new Set(assigned);
      const duplicate = distinct.size !== assigned.length;
      const question = text.match(/questao\s+(\d+)\s+de\s+(\d+)/);
      return {
        kind: "assessment-ready",
        reason: "ranking",
        ranking: {
          question: question ? Number(question[1]) : null,
          total: question ? Number(question[2]) : null,
          items,
          complete:
            items.length === 3 && assigned.length === 3 && distinct.size === 3,
          duplicate,
          remainingRank:
            assigned.length === 2 && distinct.size === 2
              ? [1, 2, 3].find((rank) => !distinct.has(rank))
              : null,
        },
      };
    }
    if (questions) return { kind: "assessment-ready", reason: "questions" };
    const stages = [
      ["intro", "vamos mapear o seu perfil", "iniciar teste"],
      ["tip-1", "encontre seu lugar calmo", "proximo"],
      ["tip-2", "a internet esta okay", "proximo"],
      ["tip-3", "reserve 15 minutinhos", "proximo"],
    ];
    const stage = stages.find(([, heading]) => text.includes(heading));
    if (stage) {
      const buttons = assessmentButtons.filter(
        (el) => assessmentLabel(el) === stage[2],
      );
      if (buttons.length === 1)
        preparation = { element: buttons[0], stage: stage[0] };
      if (!buttons.length) return { kind: "waiting" };
    }
    if (!preparation)
      return {
        kind:
          text.length < 20 || /^(?:carregando|loading)[.…\s]*$/.test(text)
            ? "waiting"
            : "assessment-ready",
      };
  } else if (
    gupy &&
    /^\/candidates\/applications\/\d+(?:\/|$)/.test(location.pathname)
  ) {
    const starts = assessmentButtons.filter(
      (el) => assessmentLabel(el) === "iniciar teste",
    );
    const relevant = starts.filter((el) => {
      for (
        let parent = el.parentElement, depth = 0;
        parent && parent !== document.body && depth < 7;
        parent = parent.parentElement, depth++
      ) {
        const text = foldAssessment(parent.innerText);
        if (text.length > 5000) break;
        if (/teste (?:tecnico|de (?:logica|ingles|conhecimentos))/.test(text))
          return false;
        const headings = [
          ...parent.querySelectorAll('h1,h2,h3,h4,[role="heading"]'),
        ].filter(visible);
        if (
          headings.length &&
          !headings.some((heading) =>
            /mapeamento comportamental|fit cultural|perfil comportamental/.test(
              foldAssessment(heading.textContent ?? ""),
            ),
          )
        )
          return false;
        if (
          /mapeamento comportamental|fit cultural|perfil comportamental/.test(
            text,
          ) &&
          starts.filter((button) => parent.contains(button)).length === 1
        )
          return true;
      }
      return false;
    });
    if (relevant.length === 1)
      preparation = { element: relevant[0], stage: "entry" };
  }
  if (preparation) {
    const element = preparation.element;
    const raw = element.getAttribute("href");
    let href = null;
    if (raw && !raw.startsWith("#")) {
      try {
        const target = new URL(raw, location.href);
        if (
          target.protocol !== "https:" ||
          target.username ||
          target.password ||
          !(
            (target.hostname === "assessments.gupy.io" &&
              target.pathname.startsWith("/behavioral/")) ||
            target.hostname === location.hostname
          )
        )
          return { kind: "assessment-ready" };
        href = target.href;
      } catch {
        return { kind: "assessment-ready" };
      }
    }
    const stamp = JSON.stringify([
      location.origin + location.pathname,
      preparation.stage,
      assessmentLabel(element),
      href,
    ]);
    if (clickKey !== null) {
      if (clickKey !== stamp) return { kind: "changed", signature: stamp };
      element.click();
      return { kind: "clicked", signature: stamp };
    }
    return {
      kind: "assessment-step",
      key: stamp,
      signature: stamp,
      href,
      stage: preparation.stage,
    };
  }
  if (phase === "progress") {
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"],dialog[open]'),
    ].filter(visible);
    const scope = dialogs.at(-1) ?? document;
    const stamp = signature(),
      missing = [];
    const all = [
      ...scope.querySelectorAll(
        'input,textarea,select,[role="textbox"],[role="checkbox"],[role="radiogroup"],[role="listbox"]',
      ),
    ].filter(visible);
    const required = (e) =>
      e.required ||
      e.getAttribute("aria-required") === "true" ||
      /required/i.test(
        e.closest(".ashby-application-form-field-entry")?.querySelector("label")
          ?.className ?? "",
      ) ||
      [...(e.labels ?? [])].some((label) =>
        /\*/.test(label.textContent ?? ""),
      ) ||
      /\*|obrigat[oó]ri|required/i.test(
        e
          .closest('[role="listitem"],.Qr7Oae')
          ?.querySelector('[role="heading"]')?.textContent ?? "",
      );
    for (const e of all) {
      if (
        e.disabled ||
        ["hidden", "button", "submit", "image"].includes(e.type)
      )
        continue;
      if (
        (e.willValidate && !e.validity.valid) ||
        e.getAttribute("aria-invalid") === "true"
      ) {
        missing.push(prompt(e));
        continue;
      }
      const q = e.closest('[role="listitem"],.Qr7Oae');
      if (e.type === "checkbox" || e.getAttribute("role") === "checkbox") {
        if (
          required(e) &&
          !(q
            ? [
                ...q.querySelectorAll('[role="checkbox"],input[type=checkbox]'),
              ].some(
                (c) => c.checked || c.getAttribute("aria-checked") === "true",
              )
            : e.checked || e.getAttribute("aria-checked") === "true")
        )
          missing.push(prompt(e));
      } else if (e.type === "radio") {
        if (
          required(e) &&
          ![...document.querySelectorAll("input[type=radio]")].some(
            (c) => c.name === e.name && c.checked,
          )
        )
          missing.push(prompt(e));
      } else if (e.getAttribute("role") === "radiogroup") {
        if (required(e) && !e.querySelector('[aria-checked="true"]'))
          missing.push(prompt(e));
      } else if (e.getAttribute("role") === "listbox") {
        if (
          required(e) &&
          !e.querySelector(
            '[role=option][aria-selected="true"][data-value]:not([data-value=""])',
          )
        )
          missing.push(prompt(e));
      } else {
        const value = e.isContentEditable ? e.textContent : e.value;
        if (
          (required(e) && !value?.trim()) ||
          (e.willValidate && !e.validity.valid) ||
          e.getAttribute("aria-invalid") === "true"
        )
          missing.push(prompt(e));
      }
    }
    if (/(^|\.)inhire\.app$/i.test(location.hostname)) {
      const manual = {
        "document.value": "CPF",
        country: "País de origem",
        district: "Cidade",
        districtBr: "Cidade",
        phone: "Celular com DDD",
        salaryExpectation: "Pretensão salarial",
        "questionsDiversity.peopleWithDisability":
          "Pergunta sobre deficiência (resposta pessoal)",
      };
      for (const [name, label] of Object.entries(manual)) {
        const input = [...scope.querySelectorAll("input")].find(
          (e) => e.name === name && visible(e),
        );
        if (
          input &&
          (!input.value.trim() ||
            (name === "phone" && /^\+55\s*$/.test(input.value)))
        )
          missing.push(label);
      }
      const file = scope.querySelector(
        "input[type=file][name=resume][required]",
      );
      if (file && !file.files?.length) missing.push("Currículo PDF");
      const pendingCity = scope.querySelector('input[name="district"]');
      if (pendingCity?.disabled && pendingCity.getClientRects().length)
        missing.push(
          "Cidade: aguardando o site liberar o campo após selecionar o país",
        );
    }
    if (missing.length)
      return {
        kind: "review",
        signature: stamp,
        missing: [...new Set(missing)],
      };
    const position = document.body.innerText.match(
      /(?:p[aá]gina|etapa|page|step)\s*(\d+)\s*(?:de|of|\/)\s*(\d+)/i,
    );
    if (position && Number(position[1]) >= Number(position[2]))
      return { kind: "final", signature: stamp };
    const nextPattern =
      /^(?:continuar|avan[cç]ar|pr[oó]xim[oa](?: etapa| p[aá]gina)?|continue|next(?: step| page)?|salvar e continuar|save and continue|responder agora)\s*[→»]?$/i;
    const candidates = [
      ...scope.querySelectorAll(
        'button,a,input[type="button"],input[type="submit"],[role="button"]',
      ),
    ].filter(
      (e) =>
        e.getClientRects().length &&
        getComputedStyle(e).visibility !== "hidden" &&
        (nextPattern.test(
          (e.getAttribute("aria-label") || e.innerText || e.value || "")
            .replace(/\s+/g, " ")
            .trim(),
        ) ||
          (gupy &&
            /^personalizar candidatura$/i.test(
              (e.getAttribute("aria-label") || e.innerText || "").trim(),
            ))),
    );
    if (!candidates.length) {
      const finalPattern =
        /^(?:enviar|concluir|finalizar(?: candidatura)?|submit(?: application)?|send(?: application)?|apply(?: now)?|candidatar-se|candidatar|enviar candidatura)\s*[!→»]?$/i;
      const terminal = [
        ...scope.querySelectorAll('button,input[type=submit],[role="button"]'),
      ].some(
        (e) =>
          e.getClientRects().length &&
          getComputedStyle(e).visibility !== "hidden" &&
          (finalPattern.test(
            (
              e.getAttribute("aria-label") ||
              e.innerText ||
              e.value ||
              ""
            ).trim(),
          ) ||
            (/(^|\.)inhire\.app$/i.test(location.hostname) &&
              /^continuar inscri[cç][aã]o$/i.test((e.innerText || "").trim()))),
      );
      return { kind: terminal ? "final" : "pending", signature: stamp };
    }
    if (candidates.length !== 1)
      return {
        kind: "review",
        signature: stamp,
        missing: [
          "Há mais de um botão de continuação. Escolha a próxima etapa manualmente.",
        ],
      };
    const next = candidates[0];
    if (next.disabled || next.getAttribute("aria-disabled") === "true")
      return { kind: "pending", signature: stamp };
    const google =
      location.hostname === "docs.google.com" &&
      location.pathname.startsWith("/forms/") &&
      document.querySelector('form[action*="/formResponse"]');
    if (
      (next.type === "submit" ||
        (next.tagName === "BUTTON" &&
          !next.getAttribute("type") &&
          next.closest("form"))) &&
      !google &&
      !position &&
      !(
        gupy &&
        /^(salvar e continuar|responder agora|personalizar candidatura)$/i.test(
          (next.getAttribute("aria-label") || next.innerText || "").trim(),
        )
      ) &&
      !(
        gupyWelcome() &&
        /^continuar$/i.test(
          (next.getAttribute("aria-label") || next.innerText || "").trim(),
        )
      )
    )
      return {
        kind: "review",
        signature: stamp,
        missing: [
          "Confirme manualmente esta continuação; o site usa um botão de envio sem indicar as etapas.",
        ],
      };
    const href = next.getAttribute("href");
    let url = null;
    if (href && !href.startsWith("#")) {
      try {
        const u = new URL(href, location.href);
        if (u.protocol !== "https:" || u.username || u.password)
          return {
            kind: "review",
            signature: stamp,
            missing: ["Link de continuação não permitido."],
          };
        url = u.href;
      } catch {
        return {
          kind: "review",
          signature: stamp,
          missing: ["Link de continuação inválido."],
        };
      }
    }
    const key = JSON.stringify([
      stamp,
      next.getAttribute("aria-label") || next.innerText || next.value,
      url,
    ]);
    if (clickKey !== null) {
      if (clickKey !== key) return { kind: "changed", signature: stamp };
      next.click();
      return { kind: "clicked", signature: stamp };
    }
    return { kind: "next", signature: stamp, key, href: url };
  }
  for (const element of googleButtons()) {
    const label = (
      element.getAttribute("aria-label") ||
      element.innerText ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (
      !visible(element) ||
      element.getAttribute("aria-disabled") === "true" ||
      /^(submit|image)$/i.test(element.getAttribute("type") ?? "") ||
      !googleLogin.test(label)
    )
      continue;
    let href = null;
    const raw = element.getAttribute("href");
    if (raw && !raw.startsWith("#")) {
      try {
        const url = new URL(raw, location.href);
        if (url.protocol !== "https:" || url.username || url.password) continue;
        href = url.href;
      } catch {
        continue;
      }
    }
    const key = JSON.stringify([label, href]);
    if (clickKey !== null) {
      if (clickKey !== key) continue;
      element.click();
      return { kind: "clicked" };
    }
    return { kind: "navigate", key, href, loginAction: true };
  }
  // Later Google Forms sections contain questions, not the initial name/email pair.
  if (gupyWelcome()) return { kind: "form", multiStep: true };
  if (
    location.hostname === "jobs.ashbyhq.com" &&
    [
      ...document.querySelectorAll(
        ".ashby-application-form-field-entry input,.ashby-application-form-field-entry textarea,.ashby-application-form-field-entry select",
      ),
    ].some(visible)
  )
    return { kind: "form", multiStep: true };
  if (
    gupy &&
    [...document.querySelectorAll('button,[role="button"]')].some(
      (e) =>
        visible(e) &&
        /^(salvar e continuar|responder agora|personalizar candidatura|finalizar candidatura)$/i.test(
          (e.getAttribute("aria-label") || e.innerText || "").trim(),
        ),
    )
  )
    return { kind: "form", multiStep: true };
  if (
    /(^|\.)gupy\.io$/i.test(location.hostname) &&
    [
      ...document.querySelectorAll(
        'input[name="howDidYouHearAboutUs"],select[name="howDidYouHearAboutUs"]',
      ),
    ].some(visible)
  )
    return { kind: "form" };
  if (
    [...document.querySelectorAll("fieldset legend")].some(
      (e) =>
        visible(e) &&
        /^Voc[eê] trabalha na empresa\b/i.test(e.textContent.trim()),
    ) &&
    document.querySelector('input[name="radioGroupIsCompanyEmployeeTitle"]')
  )
    return { kind: "form" };
  if (
    [...document.querySelectorAll('form button,[role="form"] button')].some(
      (e) =>
        visible(e) &&
        /^responder agora$/i.test(
          (e.getAttribute("aria-label") || e.textContent).trim(),
        ),
    )
  )
    return { kind: "form" };
  if (
    location.hostname === "docs.google.com" &&
    location.pathname.startsWith("/forms/") &&
    document.querySelector('form[action*="/formResponse"]')
  )
    return { kind: "form", multiStep: true };
  const inputs = [...document.querySelectorAll("input,textarea")].filter(
    visible,
  );
  if (
    navigation.followingForm &&
    document.querySelector('form,[role="form"]') &&
    [
      ...document.querySelectorAll(
        'form input:not([type=hidden]),form textarea,form select,[role="form"] input,[role="form"] textarea,[role="form"] [role="checkbox"],[role="form"] [role="listbox"]',
      ),
    ].some(visible)
  )
    return { kind: "form", multiStep: true };
  const labels = (e) =>
    [
      e.getAttribute("aria-label"),
      e.getAttribute("placeholder"),
      ...(e.labels ?? []),
      ...(e.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)),
    ]
      .map((t) => (typeof t === "string" ? t : (t?.textContent ?? "")))
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const hasName = inputs.some(
    (e) =>
      e.autocomplete === "name" ||
      labels(e).some((label) =>
        /^(nome completo|full name|nome|first name|name)\s*[:*]*$/i.test(label),
      ) ||
      /^(name|full[_-]?name|first[_-]?name|nome_completo)$/i.test(
        e.name || e.id,
      ),
  );
  if (
    (hasName &&
      inputs.some(
        (e) =>
          e.type === "email" ||
          labels(e).some((label) =>
            /^e-?mail(?: address)?\s*[:*]*$/i.test(label),
          ),
      )) ||
    [...document.querySelectorAll("input[type=file]")].some((e) =>
      /resume|curr[ií]culo|\bcv\b/i.test(
        [e.name, e.id, ...labels(e)].join(" "),
      ),
    )
  )
    return { kind: "form" };
  if (
    [...document.querySelectorAll('button,a,[role="button"]')].some(
      (e) =>
        visible(e) &&
        e.type !== "submit" &&
        (/^(?:(?:carregar|anexar|selecionar|adicionar)(?: (?:o|um|seu))? curr[ií]culo|(?:upload|attach|choose|add)(?: (?:your|a))? (?:resume|résumé|cv))\s*\*?$/i.test(
          (e.getAttribute("aria-label") || e.textContent || "")
            .replace(/\s+/g, " ")
            .trim(),
        ) ||
          (/^adicionar arquivo$/i.test(
            (
              e.getAttribute("aria-label") ||
              e.querySelector("p")?.textContent ||
              e.textContent ||
              ""
            ).trim(),
          ) &&
            /arquivo do curr[ií]culo\b/i.test(e.textContent || "") &&
            !/cover.?letter|carta|photo|foto|passport|passaporte|certificad/i.test(
              e.textContent || "",
            ))),
    )
  )
    return { kind: "form" };
  const pattern = new RegExp(navigation.apply, "i");
  for (const element of document.querySelectorAll(
    "a,button,[role=link],[role=button]",
  )) {
    if (
      !visible(element) ||
      element.closest("form") ||
      element.hasAttribute("form") ||
      element.hasAttribute("formaction") ||
      /^(submit|image)$/i.test(element.getAttribute("type") ?? "") ||
      element.getAttribute("aria-disabled") === "true"
    )
      continue;
    const label = (
      element.getAttribute("aria-label") ||
      element.innerText ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!pattern.test(label)) continue;
    const raw = element.getAttribute("href");
    let href = null;
    if (raw && !raw.startsWith("#")) {
      try {
        const u = new URL(raw, location.href);
        if (u.protocol !== "https:" || u.username || u.password) continue;
        href = u.href;
      } catch {
        continue;
      }
    }
    const key = JSON.stringify([label, href]);
    if (clickKey !== null) {
      if (key !== clickKey) continue;
      element.click();
      return { kind: "clicked" };
    }
    return { kind: "navigate", href, key };
  }
  return { kind: clickKey === null ? "waiting" : "missing" };
}
