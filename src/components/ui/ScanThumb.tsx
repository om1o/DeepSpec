import { useState } from "react";
import { cx } from "../../lib/utils";

type ScanThumbProps = {
  src?: string | null;
  alt?: string;
  className?: string;
};

export default function ScanThumb({ src, alt = "", className }: ScanThumbProps) {
  // Track which src failed (not a sticky boolean) so a new src self-recovers.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt || "Photo unavailable"}
        className={cx(
          "grid place-items-center bg-neutral-100 px-2 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400",
          className,
        )}
      >
        Photo unavailable
      </div>
    );
  }

  return <img alt={alt} className={className} src={src} onError={() => setFailedSrc(src)} />;
}
