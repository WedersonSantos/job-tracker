import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  defaultValue?: string;
  type?: "text" | "url" | "date" | "month" | "email" | "tel";
  error?: string;
  /** Textarea no lugar do input, para textos longos. */
  multiline?: boolean;
  /** Select no lugar do input; as opções vêm daqui. */
  children?: ReactNode;
  /** Modo controlado. Sem isto o campo é não-controlado, por `defaultValue`. */
  value?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Campo de formulário compartilhado.
 *
 * Subiu de dentro do `profile-modal.tsx` quando o formulário de candidatura
 * virou o segundo consumidor. O modo controlado nasceu do terceiro, o currículo,
 * que edita listas aninhadas onde `FormData` seria sofrimento — cada variante
 * veio de um caso real, e não de palpite sobre o que seria útil.
 */
export function Field({
  label,
  name,
  error,
  multiline,
  children,
  value,
  onValueChange,
  ...rest
}: FieldProps) {
  const className =
    "rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-zinc-900 aria-[invalid]:border-red-500 dark:border-zinc-700 dark:focus:border-zinc-100";

  const controlled =
    value !== undefined
      ? {
          value,
          onChange: (event: { target: { value: string } }) =>
            onValueChange?.(event.target.value),
        }
      : {};

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>

      {children ? (
        <select
          name={name}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          className={className}
          defaultValue={value === undefined ? rest.defaultValue : undefined}
          {...controlled}
        >
          {children}
        </select>
      ) : multiline ? (
        <textarea
          name={name}
          rows={3}
          aria-invalid={error ? true : undefined}
          className={`${className} resize-y`}
          {...rest}
          {...controlled}
        />
      ) : (
        <input
          name={name}
          aria-invalid={error ? true : undefined}
          className={className}
          {...rest}
          {...controlled}
        />
      )}

      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}
