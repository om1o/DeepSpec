type BrandLockupProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: { mark: "size-8", text: "text-lg" },
  md: { mark: "size-10", text: "text-[22px]" },
  lg: { mark: "size-13", text: "text-[28px]" },
} as const;

export function BrandLockup({ className = "", size = "md" }: BrandLockupProps) {
  const classes = sizes[size];

  return (
    <span role="img" aria-label="DeepSpec" className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src="/brand/deepspec-symbol-v2.webp"
        alt=""
        width="192"
        height="192"
        className={`${classes.mark} shrink-0 object-contain`}
      />
      <span aria-hidden="true" className={`${classes.text} whitespace-nowrap font-semibold tracking-[-0.045em] leading-none text-white`}>
        DeepSpec
      </span>
    </span>
  );
}
