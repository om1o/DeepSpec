import Button from "../ui/Button";

type IdentifyButtonProps = {
  isVisible: boolean;
  isDisabled: boolean;
  onIdentify: () => void;
};

export default function IdentifyButton({ isVisible, isDisabled, onIdentify }: IdentifyButtonProps) {
  return (
    <div
      className={[
        "fixed inset-x-0 bottom-[max(24px,env(safe-area-inset-bottom))] z-20 px-4 transition duration-300",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      ].join(" ")}
      aria-hidden={!isVisible}
    >
      <Button className="h-14 w-full text-base" disabled={!isVisible || isDisabled} onClick={onIdentify}>
        Identify
      </Button>
    </div>
  );
}
