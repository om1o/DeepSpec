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
        variant === "primary" && "bg-white text-neutral-950 shadow-[0_12px_40px_rgba(255,255,255,0.18)]",
        variant === "ghost" && "bg-white/10 text-white backdrop-blur-md active:bg-white/15",
        className,
      )}
      {...props}
    />
  );
}
