import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export default function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cx(
        "min-h-12 rounded-full px-5 text-sm font-bold transition duration-200 disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" && "bg-[var(--ds-accent)] text-white shadow-[var(--ds-shadow-primary)] active:bg-[var(--ds-accent-pressed)]",
        variant === "ghost" && "bg-white/10 text-white backdrop-blur-md active:bg-white/15",
        className,
      )}
      {...props}
    />
  );
}
