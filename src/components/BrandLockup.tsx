type BrandLockupProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "horizontal" | "mark";
};

const sizes = {
  sm: { mark: "size-8", text: "text-lg" },
  md: { mark: "size-10", text: "text-[22px]" },
  lg: { mark: "size-13", text: "text-[28px]" },
} as const;

/** The electric D is static; scan motion stays outside the primary identity. */
export function BrandLockup({ className = "", size = "md", variant = "horizontal" }: BrandLockupProps) {
  const mark = variant === "mark";
  const classes = sizes[size];

  return (
    <span role="img" aria-label="DeepSpec" className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
      <img
        src="/brand/deepspec-symbol.webp"
        alt=""
        width="168"
        height="168"
        className={`ds-primary-logo block shrink-0 object-contain ${classes.mark}`}
        draggable={false}
      />
      {mark ? null : (
        <span aria-hidden="true" className={`${classes.text} whitespace-nowrap font-extrabold leading-none tracking-normal text-white`}>
          Deep<span className="text-[#55d9ff]">Spec</span>
        </span>
      )}
    </span>
  );
}
