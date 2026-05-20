import Button from "../ui/Button";

type MotionPermissionModalProps = {
  error: string | null;
  onAllow: () => void;
};

export default function MotionPermissionModal({ error, onAllow }: MotionPermissionModalProps) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/72 px-5 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#171717] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-[#FACC15]/12 text-2xl text-[#FACC15]">
          DS
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">Allow motion sensing</h1>
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
          Deep Spec uses motion sensing to detect when you are holding the phone steady.
        </p>
        {error ? <p className="mt-3 text-xs font-semibold text-[#F59E0B]">{error}</p> : null}
        <Button className="mt-6 w-full" onClick={onAllow}>
          Allow
        </Button>
      </div>
    </div>
  );
}
