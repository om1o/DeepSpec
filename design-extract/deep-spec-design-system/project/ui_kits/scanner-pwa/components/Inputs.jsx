// Deep Spec — Form input primitives

function FieldLabel({ children, htmlFor }) {
  return (
    <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">{children}</span>
  );
}

function TextInput({ className = "", ...props }) {
  return (
    <input
      className={
        "mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50 " +
        className
      }
      {...props}
    />
  );
}

function TextArea({ className = "", ...props }) {
  return (
    <textarea
      className={
        "mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/28 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50 " +
        className
      }
      {...props}
    />
  );
}

function SelectField({ className = "", children, ...props }) {
  return (
    <select
      className={
        "mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none focus:border-[#FACC15]/50 " +
        className
      }
      {...props}
    >
      {children}
    </select>
  );
}

Object.assign(window, { FieldLabel, TextInput, TextArea, SelectField });
