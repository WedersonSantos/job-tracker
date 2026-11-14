/**
 * Ícones em SVG inline, sem dependência externa.
 *
 * Nenhum deles sabe o que é um Profile ou uma Application — por isso vivem em
 * `components/` e não numa feature. O `iconProps` compartilhado é o que mantém
 * espessura e tamanho ópticos consistentes: sem ele, o próximo ícone desenhado
 * em outro arquivo diverge sem ninguém notar.
 *
 * Um arquivo só é intencional. Vinte arquivos de seis linhas seria mais atrito
 * que ajuda; quando passar de ~25 ícones, aí vale quebrar.
 */

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconInstall() {
  return <svg {...iconProps}><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>;
}

export function IconList() {
  return (
    <svg {...iconProps}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function IconBriefcase() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

export function IconDocument() {
  return (
    <svg {...iconProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </svg>
  );
}

export function IconMail() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

export function IconChart() {
  return (
    <svg {...iconProps}>
      <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
    </svg>
  );
}

export function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconEye() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconPencil() {
  return (
    <svg {...iconProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconBookmark() {
  return (
    <svg {...iconProps}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconExternalLink() {
  return (
    <svg {...iconProps}>
      <path d="M15 3h6v6M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconX() {
  return (
    <svg {...iconProps}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconUpload() {
  return (
    <svg {...iconProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8 12 3 7 8M12 3v13" />
    </svg>
  );
}
