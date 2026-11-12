/** Design-system primitives (docs/superpowers/specs/2026-11-12-ui-design.md). Server- and client-safe. */
import type { CSSProperties, ReactNode } from "react";

type Tone = "paper" | "lavender" | "peach" | "mint" | "rose" | "ink";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`eyebrow ${className}`.trim()}>{children}</span>;
}

export function Sticker({
  children,
  tone = "paper",
  tilt,
  className = "",
  as: As = "div",
}: {
  children: ReactNode;
  tone?: Tone;
  /** Degrees; disabled under prefers-reduced-motion. */
  tilt?: number;
  className?: string;
  as?: "div" | "section" | "aside" | "li";
}) {
  const style = tilt ? ({ "--tilt": `${tilt}deg` } as CSSProperties) : undefined;
  return (
    <As className={`sticker tone-${tone}${tilt ? " tilted" : ""} ${className}`.trim()} style={style}>
      {children}
    </As>
  );
}

export function Button({
  children,
  variant = "primary",
  href,
  onClick,
  disabled,
  download,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "dark";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  download?: string;
}) {
  const cls = `btn btn-${variant}`;
  if (href)
    return (
      <a className={cls} href={href} download={download}>
        {children}
      </a>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Chip({ children, tone = "paper" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Ticket({
  label,
  value,
  unit,
  tone = "paper",
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  note?: string;
}) {
  return (
    <div
      className={`ticket tone-${tone}`}
      role="group"
      aria-label={[label, value, unit].filter(Boolean).join(" ")}
    >
      <span className="eyebrow">{label}</span>
      <span className="ticket-value">
        <span>{value}</span>
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="ticket-note">{note}</span>}
    </div>
  );
}

const STEPS = ["Upload", "Quote", "Vote", "Status"] as const;

/** 1-based current step. */
export function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="steps" aria-label="Progress">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={s} data-state={state} aria-current={n === current ? "step" : undefined}>
            <span className="step-n">{String(n).padStart(2, "0")}</span>
            <span>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}
