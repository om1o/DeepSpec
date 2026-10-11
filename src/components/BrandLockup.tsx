type BrandLockupProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: { mark: "size-9", text: "text-xl" },
  md: { mark: "size-11", text: "text-2xl" },
  lg: { mark: "size-14", text: "text-3xl" },
} as const;

export function BrandLockup({ className = "", size = "md" }: BrandLockupProps) {
  const classes = sizes[size];

  return (
    <span role="img" aria-label="DeepSpec" className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src="/brand/deepspec-symbol.png"
        alt=""
        width="1254"
        height="1254"
        className={`${classes.mark} shrink-0 object-contain`}
      />
      <span aria-hidden="true" className={`${classes.text} whitespace-nowrap font-extrabold leading-none text-white`}>
        Deep<span className="text-[#55d9ff]">Spec</span>
      </span>
    </span>
  );
}
