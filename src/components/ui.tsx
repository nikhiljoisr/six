import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "link" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-stone-900 text-stone-50 px-4 py-3 text-[15px] font-medium hover:opacity-90 active:opacity-80",
  secondary:
    "border border-stone-300 bg-transparent text-stone-900 px-4 py-3 text-[15px] font-medium hover:bg-stone-100",
  link: "text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900 px-1 py-1",
  quiet: "text-xs text-stone-400 hover:text-stone-600 px-1 py-1",
};

export function Button({
  variant = "primary",
  full = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-control transition-opacity duration-150 disabled:cursor-default disabled:opacity-40 ${VARIANTS[variant]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>;
}

/** Serif numeral 1–6: the visual anchor of the app. */
export function Numeral({
  n,
  size = "md",
  tone = "ink",
  className = "",
}: {
  n: number;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "ink" | "muted" | "dim";
  className?: string;
}) {
  const sizes = { sm: "text-lg", md: "text-xl", lg: "text-3xl", xl: "text-4xl" }[size];
  const tones = { ink: "text-stone-900", muted: "text-stone-500", dim: "text-stone-300" }[tone];
  return (
    <span className={`font-serif leading-none tabular-nums ${sizes} ${tones} ${className}`} aria-hidden>
      {n}
    </span>
  );
}

export function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

export function FlameIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.5c.6 3.2 2.3 4.6 3.9 6.3 1.7 1.8 3.1 3.9 3.1 6.4A7 7 0 0 1 5 15.2c0-2 .8-3.5 1.9-4.9.3 1.2 1 2.1 2 2.6-.4-3.4.7-7.7 3.1-10.4Z" />
    </svg>
  );
}

export function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {direction === "up" ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

export function Cross() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** A hairline separator between sections. */
export function Rule({ className = "" }: { className?: string }) {
  return <hr className={`border-0 border-t border-stone-200 ${className}`} />;
}
