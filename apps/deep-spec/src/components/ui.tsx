import type { PropsWithChildren, ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  children,
  className,
  variant = "primary",
  disabled,
  type = "button",
  ...rest
}: PropsWithChildren<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
  }
>) {
  const base =
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-4 text-[15px] font-medium tracking-tight transition-opacity disabled:opacity-40";
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-ds-primary text-white hover:opacity-90 active:opacity-80",
    ghost: "bg-transparent text-neutral-900 hover:bg-neutral-100 dark:text-ds-text dark:hover:bg-neutral-800/80",
    danger: "bg-ds-danger text-white hover:opacity-90",
  };

  return (
    <button
      type={type}
      className={[base, styles[variant], className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-xl border border-ds-border-light bg-white p-4 shadow-sm dark:border-ds-border dark:bg-ds-card",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
