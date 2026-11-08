/** Executes only inside the authorized Gupy page. Does not click or submit. */
export function presentationDocument(text = null) {
  if (!/(^|\.)gupy\.io$/i.test(location.hostname)) return { kind: "missing" };
  const visible = (el) =>
    !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden";
  const scope =
    [...document.querySelectorAll('[role="dialog"],dialog[open]')]
      .filter(visible)
      .at(-1) ?? document;
  const fields = [...scope.querySelectorAll("textarea")].filter((el) => {
    if (
      !visible(el) ||
      el.disabled ||
      el.readOnly ||
      el.getAttribute("aria-readonly") === "true" ||
      el.getAttribute("aria-disabled") === "true"
    )
      return false;
    if (el.id === "personalization-step-text-area") return true;
    const labels = [...(el.labels ?? [])]
      .map((label) => label.textContent)
      .join(" ");
    return /^\s*(?:Apresente-se|Fale sobre voc[êe])\s*[!:*?]*\s*$/i.test(
      labels,
    );
  });
  if (fields.length !== 1) return { kind: "missing" };
  const field = fields[0];
  if (field.value.trim()) return { kind: "filled" };
  const maxChars = field.maxLength > 0 ? Math.min(field.maxLength, 4000) : 1500;
  if (maxChars < 50) return { kind: "missing" };
  if (text === null) return { kind: "empty", maxChars };
  if (typeof text !== "string" || !text.trim() || text.length > maxChars)
    return { kind: "invalid" };
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  ).set.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return { kind: "filled", generated: true };
}
