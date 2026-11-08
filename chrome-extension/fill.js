/** Runs on the current section only. Never advances or submits the form. */
export async function fillCurrentDocument(plan) {
  const filled = [],
    skipped = [];
  const fold = (text) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const clean = (text) => text.replace(/\s+/g, " ").trim();
  const brazilStates = {
    ac: "acre",
    al: "alagoas",
    ap: "amapa",
    am: "amazonas",
    ba: "bahia",
    ce: "ceara",
    df: "distrito federal",
    es: "espirito santo",
    go: "goias",
    ma: "maranhao",
    mt: "mato grosso",
    ms: "mato grosso do sul",
    mg: "minas gerais",
    pa: "para",
    pb: "paraiba",
    pr: "parana",
    pe: "pernambuco",
    pi: "piaui",
    rj: "rio de janeiro",
    rn: "rio grande do norte",
    rs: "rio grande do sul",
    ro: "rondonia",
    rr: "roraima",
    sc: "santa catarina",
    sp: "sao paulo",
    se: "sergipe",
    to: "tocantins",
    brasil: "brazil",
  };
  const visible = (el) =>
    !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden";
  const scope =
    [...document.querySelectorAll('[role="dialog"],dialog[open]')]
      .filter(visible)
      .at(-1) ?? document;
  const question = (el) => el.closest('[role="listitem"],.Qr7Oae');
  const heading = (el) =>
    question(el)?.querySelector('[role="heading"]')?.textContent ?? "";
  const labelTexts = (el) =>
    [
      el.getAttribute("aria-label"),
      el.getAttribute("label"),
      el.getAttribute("placeholder"),
      ...(el.labels ?? []),
      ...(el.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)),
      heading(el),
      /(^|\.)gupy\.io$/i.test(location.hostname) &&
      !/^(?:\d+[.)-]\s*)?(?:qual|what)\b/i.test(clean(el.name ?? ""))
        ? el.closest(".form-group")?.parentElement?.querySelector(":scope > h3")
        : null,
      el.name,
      !el.labels?.length
        ? el
            .closest(".ashby-application-form-field-entry")
            ?.querySelector("label")
        : null,
    ]
      .map((t) => clean(typeof t === "string" ? t : (t?.textContent ?? "")))
      .filter(Boolean);
  let controls = [
    ...scope.querySelectorAll(
      'input,textarea,select,[role="textbox"][contenteditable="true"]',
    ),
  ];
  const value = (el) => (el.isContentEditable ? el.textContent : el.value);
  const phonePrefix = (el) =>
    /(^|\.)inhire\.app$/i.test(location.hostname) &&
    el.type === "tel" &&
    el.name === "phone" &&
    /^\+55\s*$/.test(value(el) ?? "");
  const safe = (el) =>
    !el.disabled &&
    !el.readOnly &&
    el.getAttribute("aria-disabled") !== "true" &&
    el.getAttribute("aria-readonly") !== "true" &&
    visible(el) &&
    ![
      "password",
      "hidden",
      "submit",
      "button",
      "checkbox",
      "radio",
      "file",
    ].includes(el.type) &&
    (!value(el)?.trim() || phonePrefix(el));
  const emit = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // These two answers were explicitly configured by the user for Gupy.
  if (/(^|\.)gupy\.io$/i.test(location.hostname)) {
    const groups = new Set();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      const group = radio.closest('fieldset,[role="radiogroup"]');
      const legend =
        group?.querySelector("legend")?.textContent ??
        document.getElementById(group?.getAttribute("aria-labelledby"))
          ?.textContent ??
        "";
      if (
        !group ||
        groups.has(group) ||
        !/^voce trabalha na empresa\b/.test(fold(legend)) ||
        radio.name !== "radioGroupIsCompanyEmployeeTitle"
      )
        continue;
      groups.add(group);
      const options = [...group.querySelectorAll('input[type="radio"]')];
      if (options.some((option) => option.checked)) continue;
      const no = options.filter(
        (option) =>
          option.value === "no" &&
          labelTexts(option).some((label) => fold(label) === "nao"),
      );
      if (
        no.length === 1 &&
        !no[0].disabled &&
        no[0].getAttribute("aria-disabled") !== "true" &&
        (visible(no[0]) || [...no[0].labels].some(visible))
      ) {
        no[0].click();
        if (no[0].checked) filled.push("funcionário da empresa: Não");
      }
    }
    const sources = controls.filter(
      (el) =>
        el.name === "howDidYouHearAboutUs" &&
        labelTexts(el).some((label) =>
          /^onde voce encontrou essa vaga\??(?: \(opcional\))?$/.test(
            fold(label),
          ),
        ) &&
        safe(el),
    );
    if (sources.length === 1) {
      const source = sources[0];
      if (source.tagName === "SELECT") {
        const options = [...source.options].filter(
          (o) => !o.disabled && fold(o.text) === "linkedin",
        );
        if (options.length === 1) {
          source.value = options[0].value;
          emit(source);
          filled.push("origem da vaga: LinkedIn");
        }
      } else if (source.getAttribute("role") === "combobox") {
        source.focus();
        source.click();
        source.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            code: "ArrowDown",
            bubbles: true,
          }),
        );
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const ids = (
            source.getAttribute("aria-controls") ||
            source.getAttribute("aria-owns") ||
            ""
          )
            .split(/\s+/)
            .filter(Boolean);
          const lists = ids.length
            ? ids.map((id) => document.getElementById(id)).filter(Boolean)
            : [...document.querySelectorAll('[role="listbox"]')].filter(
                visible,
              );
          if (lists.length !== 1) continue;
          const options = [
            ...lists[0].querySelectorAll('[role="option"]'),
          ].filter(
            (o) =>
              visible(o) &&
              o.getAttribute("aria-disabled") !== "true" &&
              fold(o.textContent ?? "") === "linkedin",
          );
          if (options.length !== 1) continue;
          options[0].click();
          filled.push("origem da vaga: LinkedIn");
          break;
        }
      }
    }
  }
  // Demographic answers come only from explicit saved choices. Recognize the
  // question first; option text or a field name alone is never sufficient.
  const demographicReview = [];
  const questionText = (el) => {
    if (!el) return "";
    const copy = el.cloneNode(true);
    copy
      .querySelectorAll(
        'input,textarea,select,[role="listbox"],[role="combobox"]',
      )
      .forEach((control) => control.remove());
    return copy.textContent ?? "";
  };
  const questionLabels = (el) => {
    const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "");
    const wrapper = el.closest(
      '.form-group,[data-component-name="Field"],.MuiFormControl-root',
    );
    return [
      el.getAttribute("aria-label"),
      ...[...(el.labels ?? [])].map(questionText),
      ...labelledBy,
      el.matches('fieldset,[role="radiogroup"]')
        ? el.querySelector("legend")?.textContent
        : null,
      questionText(
        wrapper?.querySelector('label:not(:has(input[type="radio"]))'),
      ),
      wrapper?.parentElement?.querySelector(":scope > h3")?.textContent,
    ]
      .filter((label) => typeof label === "string")
      .map((label) =>
        clean(label)
          .replace(/^\d+[.)-]\s*/, "")
          .replace(/\((?:opcional|optional|obrigat[oó]rio|required)\)/gi, "")
          .trim(),
      );
  };
  const choiceText = (el) =>
    el.matches('input[type="radio"]')
      ? [...(el.labels ?? [])].map((label) => label.textContent).join(" ") ||
        el.getAttribute("aria-label") ||
        ""
      : (el.textContent ?? "");
  const choiceValue = (text, kind) => {
    const normalized = fold(text)
      .replace(/\(a\)/g, "")
      .replace(/\s*\*$/, "")
      .trim();
    if (
      /^(?:prefiro nao (?:informar|responder|declarar)|nao (?:desejo|quero) (?:informar|responder)|prefer not to (?:say|answer|disclose)|i do not wish to answer)$/.test(
        normalized,
      )
    )
      return "decline";
    const equivalents = {
      PCD: { sim: "yes", yes: "yes", nao: "no", no: "no" },
      "cor ou raça": {
        branca: "white",
        branco: "white",
        white: "white",
        preta: "black",
        preto: "black",
        black: "black",
        parda: "parda",
        pardo: "parda",
        amarela: "amarela",
        amarelo: "amarela",
        indigena: "indigena",
        indigenous: "indigena",
      },
      sexo: {
        feminino: "female",
        female: "female",
        masculino: "male",
        male: "male",
        intersexo: "intersex",
        intersex: "intersex",
      },
      "identidade de gênero": {
        "nao binario": "nonbinary",
        "nao-binario": "nonbinary",
        "non-binary": "nonbinary",
        nonbinary: "nonbinary",
      },
      "orientação sexual": {
        heterosexual: "heterossexual",
        homosexual: "homossexual",
        bisexual: "bissexual",
        lesbian: "lesbica",
        asexual: "assexual",
      },
    };
    return equivalents[kind]?.[normalized] ?? normalized;
  };
  const placeholderChoice = (text) =>
    /^(?:|selecione(?: uma op[cç][aã]o)?|escolha(?: uma op[cç][aã]o)?|select(?: an option)?|choose(?: an option)?)[.…\s]*$/i.test(
      text.trim(),
    );
  const demographicRoot = (el) =>
    el.matches('input[type="radio"],[role="radio"]')
      ? (el.closest('fieldset,[role="radiogroup"]') ?? el)
      : (el.closest('.react-dropdown-select,[role="combobox"]') ?? el);
  let cidAllowed = true;
  for (const field of plan.fields.filter((item) => item.sensitive)) {
    if (field.what === "CID" && !cidAllowed) {
      skipped.push(field.what);
      continue;
    }
    const labels = new RegExp(field.labels, field.flags);
    let matches = [];
    // PCD selection can reveal the CID control after a render.
    for (
      let attempt = 0;
      attempt < (field.what === "CID" ? 15 : 1);
      attempt++
    ) {
      const widgets = [
        ...scope.querySelectorAll(
          'input,textarea,select,fieldset,[role="radiogroup"],[role="radio"],[role="combobox"],.react-dropdown-select,button[aria-haspopup="listbox"]',
        ),
      ];
      matches = [...new Set(widgets.map(demographicRoot))].filter(
        (el) =>
          visible(el) &&
          !el.disabled &&
          !el.readOnly &&
          el.getAttribute("aria-disabled") !== "true" &&
          el.getAttribute("aria-readonly") !== "true" &&
          questionLabels(el).some((label) => labels.test(label)),
      );
      if (matches.length || field.what !== "CID") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (matches.length !== 1) {
      skipped.push(field.what);
      continue;
    }
    const root = matches[0],
      wanted = choiceValue(field.value, field.what);
    const radios = root.matches('input[type="radio"],[role="radio"]')
      ? [root]
      : [...root.querySelectorAll('input[type="radio"],[role="radio"]')];
    if (radios.length) {
      const answered = radios.find(
        (radio) =>
          radio.checked || radio.getAttribute("aria-checked") === "true",
      );
      if (answered) {
        if (field.what === "PCD")
          cidAllowed = choiceValue(choiceText(answered), field.what) === "yes";
        continue;
      }
      const options = radios.filter(
        (radio) =>
          !radio.disabled &&
          radio.getAttribute("aria-disabled") !== "true" &&
          choiceValue(choiceText(radio), field.what) === wanted,
      );
      if (options.length === 1) {
        options[0].click();
        filled.push(field.what);
      } else {
        if (field.what === "PCD") cidAllowed = false;
        skipped.push(field.what);
        demographicReview.push(field.what);
      }
      continue;
    }
    if (root.tagName === "SELECT") {
      const current = root.selectedOptions[0];
      if (current && !placeholderChoice(current.textContent ?? "")) {
        if (field.what === "PCD")
          cidAllowed =
            choiceValue(current.textContent ?? "", field.what) === "yes";
        continue;
      }
      const options = [...root.options].filter(
        (option) =>
          !option.disabled &&
          choiceValue(option.textContent ?? "", field.what) === wanted,
      );
      if (options.length === 1) {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        ).set.call(root, options[0].value);
        emit(root);
        filled.push(field.what);
      } else {
        skipped.push(field.what);
        demographicReview.push(field.what);
      }
      continue;
    }
    const custom = root.matches(
      '[role="combobox"],.react-dropdown-select,button[aria-haspopup="listbox"]',
    );
    if (custom) {
      const display = root.querySelector(
        '.react-dropdown-select-content,[class*="singleValue"],.react-select__single-value',
      );
      const input = root.matches("input")
        ? root
        : root.querySelector('input:not([type="hidden"])');
      const displayText =
        display?.textContent ?? (!input ? root.textContent : "") ?? "";
      if (
        (input?.value?.trim() && !placeholderChoice(input.value)) ||
        (displayText.trim() && !placeholderChoice(displayText))
      ) {
        if (field.what === "PCD")
          cidAllowed =
            choiceValue(input?.value?.trim() || displayText, field.what) ===
            "yes";
        continue;
      }
      root.click();
      let selected = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const listId =
          root.getAttribute("aria-controls") ||
          root.getAttribute("aria-owns") ||
          input?.getAttribute("aria-controls");
        const linked = listId ? document.getElementById(listId) : null;
        if (listId && (!linked || !visible(linked))) continue;
        const lists = [...document.querySelectorAll('[role="listbox"]')].filter(
          visible,
        );
        const list =
          linked && visible(linked)
            ? linked
            : (root.querySelector(".react-dropdown-select-dropdown") ??
              (lists.length === 1 ? lists[0] : null));
        if (!list) continue;
        const options = [
          ...list.querySelectorAll(
            '[role="option"],.react-dropdown-select-item',
          ),
        ].filter(
          (option) =>
            visible(option) &&
            option.getAttribute("aria-disabled") !== "true" &&
            !option.disabled &&
            choiceValue(choiceText(option), field.what) === wanted,
        );
        if (options.length !== 1) continue;
        options[0].click();
        selected = true;
        filled.push(field.what);
        break;
      }
      if (!selected) {
        skipped.push(field.what);
        demographicReview.push(field.what);
        root.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      }
      continue;
    }
    if (
      root.matches(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),textarea',
      ) &&
      safe(root)
    ) {
      const prototype =
        root.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(
        root,
        field.value,
      );
      emit(root);
      filled.push(field.what);
    }
  }
  for (const field of plan.fields) {
    if (field.sensitive) continue;
    if (
      field.what === "localização" &&
      /(^|\.)inhire\.app$/i.test(location.hostname)
    ) {
      let city = scope.querySelector(
        'input[name="districtBr"],input[name="district"]',
      );
      if (city) {
        const country = scope.querySelector('input[name="country"]');
        if (city.disabled && country && !country.value.trim()) {
          skipped.push(field.what);
          continue;
        }
        for (
          let attempt = 0;
          attempt < 60 && (!city || city.disabled);
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          city = scope.querySelector(
            'input[name="districtBr"],input[name="district"]',
          );
        }
        if (!city || city.disabled) {
          skipped.push(field.what);
          continue;
        }
        const root = city.closest(".react-dropdown-select");
        if (city.name === "districtBr" && root) {
          if (
            city.value.trim() ||
            !visible(root) ||
            root.getAttribute("aria-disabled") === "true"
          ) {
            skipped.push(field.what);
            continue;
          }
          const parts = (text) =>
            fold(text)
              .split(/[,/]|\s+-\s+/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => brazilStates[part] ?? part);
          const wanted = parts(field.value);
          root.click();
          let searched = false,
            selected = false;
          for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const search = root.querySelector(
              '.react-dropdown-select-dropdown input[placeholder="Pesquisar"]',
            );
            if (!searched && search && !search.disabled) {
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              ).set.call(search, field.value.split(/[,/]|\s+-\s+/)[0].trim());
              emit(search);
              searched = true;
              continue;
            }
            if (!searched) continue;
            const options = [
              ...root.querySelectorAll(
                '.react-dropdown-select-dropdown [role="option"]',
              ),
            ].filter((option) => {
              if (
                !visible(option) ||
                option.disabled ||
                option.getAttribute("aria-disabled") === "true"
              )
                return false;
              const candidate = parts(
                option.getAttribute("aria-label") ||
                  option.getAttribute("data-option-value") ||
                  option.textContent ||
                  "",
              );
              return (
                candidate[0] === wanted[0] &&
                (!wanted[1] || candidate[1] === wanted[1]) &&
                wanted
                  .slice(2)
                  .every((part) => part === "brazil" || part === "br")
              );
            });
            if (options.length !== 1) continue;
            options[0].click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const current = scope.querySelector('input[name="districtBr"]');
            selected = !!current?.value.trim();
            if (selected) break;
          }
          if (selected) filled.push(field.what);
          else {
            skipped.push(field.what);
            root.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          }
          continue;
        }
      }
    }
    controls = [
      ...scope.querySelectorAll(
        'input,textarea,select,[role="textbox"][contenteditable="true"]',
      ),
    ];
    if (
      field.what === "país de origem" &&
      /(^|\.)inhire\.app$/i.test(location.hostname)
    ) {
      const inputs = controls.filter(
        (el) =>
          el.name === "country" &&
          el.closest(".react-dropdown-select") &&
          !el.disabled,
      );
      if (inputs.length !== 1 || inputs[0].value.trim()) {
        skipped.push(field.what);
        continue;
      }
      const root = inputs[0].closest(".react-dropdown-select");
      if (!visible(root) || root.getAttribute("aria-disabled") === "true") {
        skipped.push(field.what);
        continue;
      }
      const normalizeCountry = (text) => {
        const name = fold(text).replace(/\s*\([a-z]{2}\)$/, "");
        return ["brasil", "brazil", "br"].includes(name) ? "brasil" : name;
      };
      root.click();
      let selected = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const options = [
          ...root.querySelectorAll(
            '.react-dropdown-select-dropdown [role="option"],.react-dropdown-select-dropdown [data-component-name="Truncate"][title]',
          ),
        ]
          .filter(
            (option) =>
              visible(option) &&
              !option.closest('[aria-disabled="true"]') &&
              normalizeCountry(option.textContent ?? "") ===
                normalizeCountry(field.value),
          )
          .filter(
            (option, _index, matches) =>
              !matches.some(
                (other) => other !== option && other.contains(option),
              ),
          );
        if (options.length !== 1) continue;
        options[0].click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        selected =
          !!inputs[0].value.trim() ||
          normalizeCountry(
            root.querySelector(".react-dropdown-select-content")?.textContent ??
              "",
          ) === normalizeCountry(field.value);
        if (selected) break;
      }
      if (selected) filled.push(field.what);
      else {
        skipped.push(field.what);
        root.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      }
      continue;
    }
    const labels = new RegExp(field.labels, field.flags),
      names = field.names ? new RegExp(field.names, field.flags) : null;
    const blocked = new RegExp(
      field.what === "pretensão salarial"
        ? "carta|cover letter|por que|why do you|disponibilidade|availability|quando pode|notice period|sal[aá]rio atual|current salary|previous salary|sal[aá]rio anterior"
        : field.what === "último salário"
          ? "carta|cover letter|por que|why do you|disponibilidade|availability|quando pode|notice period|pretens|expectativ|expected salary|desired salary|sal[aá]rio atual|current salary"
          : plan.blocked,
      "i",
    );
    let candidates = controls.filter(
      (el) =>
        safe(el) &&
        ![...labelTexts(el), el.name ?? ""].some((t) => blocked.test(t)) &&
        (labelTexts(el).some(
          (t) =>
            labels.test(t) ||
            (field.what === "resumo de experiência" &&
              !plan.presentation?.enabled &&
              /(^|\.)gupy\.io$/i.test(location.hostname) &&
              /^(apresente-se|fale sobre voce)\s*[!:*?]*$/i.test(fold(t))),
        ) ||
          (names && (names.test(el.name) || names.test(el.id))) ||
          (field.what === "CPF" &&
            /(^|\.)inhire\.app$/i.test(location.hostname) &&
            el.name === "document.value" &&
            !document.querySelector('input[name="isNotBrazilian"]')?.checked &&
            /^cpf\s*\*?$/i.test(
              clean(
                el
                  .closest('[data-component-name="Flex"]')
                  ?.querySelector("label")?.textContent ?? "",
              ),
            )) ||
          (field.autocomplete &&
            el.autocomplete?.split(/\s+/).at(-1) === field.autocomplete)),
    );
    if (["último salário", "pretensão salarial"].includes(field.what)) {
      const exactNames = candidates.filter(
        (el) =>
          labels.test(el.name ?? "") || (names && names.test(el.name ?? "")),
      );
      if (exactNames.length === 1) candidates = exactNames;
    }
    if (candidates.length !== 1) {
      skipped.push(field.what);
      continue;
    }
    const el = candidates[0];
    const ashbyLocation =
      field.what === "localização" &&
      location.hostname === "jobs.ashbyhq.com" &&
      el.getAttribute("role") === "combobox" &&
      el.closest('[data-field-path="_systemfield_location"]');
    if (ashbyLocation) el.focus();
    if (el.tagName === "SELECT") {
      const options = [...el.options].filter(
        (o) =>
          !o.disabled &&
          (fold(o.text) === fold(field.value) || o.value === field.value),
      );
      if (options.length !== 1) {
        skipped.push(field.what);
        continue;
      }
      el.value = options[0].value;
    } else if (el.isContentEditable) {
      el.textContent = field.value;
    } else {
      const prototype =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(
        el,
        phonePrefix(el) &&
          field.what === "telefone" &&
          /^\d{10,11}$/.test(field.value.replace(/\D/g, ""))
          ? "+55" + field.value.replace(/\D/g, "")
          : field.value,
      );
    }
    emit(el);
    if (ashbyLocation) {
      const states = brazilStates;
      const wanted = field.value
        .split(/[,/]|\s+-\s+/)
        .map(fold)
        .filter(Boolean)
        .map((part) => states[part] ?? part);
      let selected = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const lists = [...document.querySelectorAll('[role="listbox"]')].filter(
          visible,
        );
        if (lists.length !== 1) continue;
        const options = [
          ...lists[0].querySelectorAll('[role="option"]'),
        ].filter((option) => {
          if (
            !visible(option) ||
            option.getAttribute("aria-disabled") === "true"
          )
            return false;
          const parts = fold(option.textContent ?? "")
            .replace(/\bstate of\s+|\bestado de\s+/g, "")
            .split(",")
            .map((part) => states[part.trim()] ?? part.trim());
          return (
            parts[0] === wanted[0] &&
            wanted.slice(1).every((part) => parts.includes(part))
          );
        });
        if (options.length !== 1) continue;
        options[0].click();
        selected = true;
        break;
      }
      if (!selected) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(el, "");
        emit(el);
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        skipped.push(field.what);
        continue;
      }
    }
    filled.push(field.what);
  }
  // Match only exact skills explicitly present in the saved CV, never guess proficiency.
  const skills = new Set((plan.facts?.skills ?? []).map(fold));
  for (const el of document.querySelectorAll(
    '[role="checkbox"],input[type="checkbox"]',
  )) {
    if (
      !visible(el) ||
      el.disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      el.checked ||
      el.getAttribute("aria-checked") === "true"
    )
      continue;
    const prompt = fold(heading(el));
    if (
      !/tecnolog|ferrament|framework|stack|linguagens? de programa/.test(prompt)
    )
      continue;
    if (
      /\b(?:nao|nunca|gostaria|preferencia|interesse|ultimas|ultimos|avancado|avancada|especialista|expert|anos)\b|sem experiencia|quer aprender|deseja aprender/.test(
        prompt,
      )
    )
      continue;
    const labels = [...labelTexts(el), el.textContent ?? ""].map(fold);
    if (labels.some((label) => skills.has(label))) {
      el.click();
      filled.push("tecnologia: " + labels.find((label) => skills.has(label)));
    }
  }
  if (plan.attachment) {
    const description = (el) => [el.id, el.name, ...labelTexts(el)].join(" ");
    const otherDocument =
      /cover.?letter|carta|photo|foto|passport|passaporte|certificad/i;
    const resumeInputs = () =>
      [...document.querySelectorAll('input[type="file"]')].filter(
        (el) =>
          !el.disabled &&
          /r[eé]sum[eé]|curr[ií]culo|\bcv\b/i.test(description(el)) &&
          !otherDocument.test(description(el)),
      );
    let inputs = resumeInputs();
    if (!inputs.length) {
      const upload =
        /^(?:(?:carregar|anexar|selecionar|adicionar)(?: (?:o|um|seu))? curr[ií]culo|(?:upload|attach|choose|add)(?: (?:your|a))? (?:resume|résumé|cv))\s*\*?$/i;
      const resumeButton = (el) => {
        const text = clean(
          el.getAttribute("aria-label") || el.textContent || "",
        );
        const full = clean(el.textContent || "");
        const action = clean(
          el.getAttribute("aria-label") ||
            el.querySelector("p")?.textContent ||
            text,
        );
        return (
          upload.test(text) ||
          (/^adicionar arquivo$/i.test(action) &&
            /arquivo do curr[ií]culo\b/i.test(full) &&
            !otherDocument.test(full))
        );
      };
      const buttons = [
        ...document.querySelectorAll('button,a,[role="button"]'),
      ].filter(
        (el) =>
          visible(el) &&
          !el.disabled &&
          el.getAttribute("aria-disabled") !== "true" &&
          el.type !== "submit" &&
          !el.hasAttribute("formaction") &&
          resumeButton(el),
      );
      if (buttons.length === 1) {
        // Prefer the mounted input associated with this resume card. This also
        // works in Chrome's isolated world without opening the OS file picker.
        const nearbyInputs = () => {
          let parent = buttons[0].parentElement;
          for (
            let level = 0;
            parent && level < 6;
            level++, parent = parent.parentElement
          ) {
            if (["FORM", "BODY", "HTML"].includes(parent.tagName)) break;
            const files = [...parent.querySelectorAll('input[type="file"]')];
            if (files.length > 1) return [];
            if (files.length === 1) {
              const input = files[0];
              return !input.disabled &&
                !otherDocument.test(description(input)) &&
                (!input.accept ||
                  /\.pdf|application\/pdf|application\/\*|\*\/\*/i.test(
                    input.accept,
                  ))
                ? [input]
                : [];
            }
          }
          return [];
        };
        inputs = nearbyInputs();
        if (!inputs.length) {
          let captured = null;
          const prototype = HTMLInputElement.prototype;
          const clickDescriptor = Object.getOwnPropertyDescriptor(
            prototype,
            "click",
          );
          const originalClick = prototype.click;
          const pickerDescriptor = Object.getOwnPropertyDescriptor(
            prototype,
            "showPicker",
          );
          const originalPicker = prototype.showPicker;
          // Capture the upload button's file input without opening the OS chooser.
          prototype.click = function (...args) {
            if (this.type === "file") {
              captured = this;
              return;
            }
            return originalClick.apply(this, args);
          };
          if (originalPicker)
            prototype.showPicker = function (...args) {
              if (this.type === "file") {
                captured = this;
                return;
              }
              return originalPicker.apply(this, args);
            };
          try {
            buttons[0].click();
            for (let attempt = 0; attempt < 15; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              inputs = resumeInputs();
              if (!inputs.length) inputs = nearbyInputs();
              if (inputs.length || captured) break;
            }
            if (
              !inputs.length &&
              captured &&
              !captured.disabled &&
              !otherDocument.test(description(captured))
            )
              inputs = [captured];
          } finally {
            if (clickDescriptor)
              Object.defineProperty(prototype, "click", clickDescriptor);
            else delete prototype.click;
            if (pickerDescriptor)
              Object.defineProperty(prototype, "showPicker", pickerDescriptor);
          }
        }
      }
    }
    if (inputs.length === 1 && !inputs[0].files?.length) {
      const bytes = Uint8Array.from(atob(plan.attachment.base64), (c) =>
        c.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], plan.attachment.fileName, {
          type: "application/pdf",
        }),
      );
      inputs[0].files = transfer.files;
      emit(inputs[0]);
      filled.push("currículo PDF");
    } else skipped.push("currículo PDF");
  }
  const needsReview = [
    ...new Set([
      ...demographicReview,
      ...controls
        .filter(
          (el) =>
            visible(el) &&
            !el.disabled &&
            !el.readOnly &&
            ["text", "email", "tel", "url", "number", "textarea"].includes(
              el.type,
            ) &&
            !value(el)?.trim(),
        )
        .map(
          (el) =>
            heading(el) ||
            el
              .closest(".ashby-application-form-field-entry")
              ?.querySelector("label")?.textContent ||
            labelTexts(el)[0],
        )
        .filter(Boolean),
    ]),
  ];
  return { filled, skipped, needsReview, submitted: false };
}
