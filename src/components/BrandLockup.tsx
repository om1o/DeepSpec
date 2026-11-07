type BrandLockupProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "horizontal" | "mark";
};

const sizes = { sm: "w-[112px]", md: "w-[140px] sm:w-[178px]", lg: "w-[178px]" } as const;

/** White is the primary identity. The logo artwork stays static in every variant. */
export function BrandLockup({ className = "", size = "md", variant = "horizontal" }: BrandLockupProps) {
  const mark = variant === "mark";
  return (
    <span role="img" aria-label="DeepSpec" className={`inline-flex shrink-0 items-center ${className}`}>
      <img
        src={mark ? "/brand/deepspec-mark.svg" : "/brand/deepspec-logo-horizontal.svg"}
        alt=""
        width={mark ? 64 : 260}
        height={mark ? 64 : 62}
        className={`ds-primary-logo block h-auto object-contain ${mark ? "size-11" : sizes[size]}`}
        draggable={false}
      />
    </span>
  );
}
