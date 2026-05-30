// Deep Spec — Early Access (waitlist + feedback) screen

const { useState: useStateEA } = React;

function EarlyAccessScreen({ go }) {
  const [email, setEmail] = useStateEA("");
  const [userType, setUserType] = useStateEA("car_owner");
  const [mainProblem, setMainProblem] = useStateEA("");
  const [waitlistStatus, setWaitlistStatus] = useStateEA("");

  function saveWaitlistEntry(e) {
    e.preventDefault();
    const entry = { email, mainProblem, savedAt: new Date().toISOString(), userType };
    try {
      const existing = JSON.parse(localStorage.getItem("deepSpecWaitlist") || "[]");
      const waitlist = Array.isArray(existing) ? existing : [];
      localStorage.setItem("deepSpecWaitlist", JSON.stringify([...waitlist, entry]));
      setEmail("");
      setMainProblem("");
      setWaitlistStatus("Saved locally.");
    } catch {
      setWaitlistStatus("Could not save locally in this browser.");
    }
  }

  return (
    <main
      className="min-h-full bg-[#0A0A0A] px-4 pb-8 text-white"
      style={{ paddingTop: "max(18px, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto w-full max-w-md">
        <ScreenHeader
          title="Early access"
          actions={[{ label: "Scan", onClick: () => go("/") }]}
        />

        <section className="mt-2 rounded-[24px] border border-white/10 bg-[#171717] p-5">
          <p className="text-sm font-bold text-[#FACC15]">Business experiment</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Prove people want this before charging.</h2>
          <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
            Deep Spec is testing demand with waitlist signups, feedback, saved scan reports, and mechanic escalation CTAs.
            Payments, accounts, domains, and legal docs need parent review later.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <NestedRow label="Local waitlist entries" value="14" />
            <NestedRow label="Feedback notes" value="6" />
            <NestedRow label="Cloud sync" value="Off" />
          </div>
        </section>

        <form className="mt-4 rounded-[24px] border border-white/10 bg-[#171717] p-5" onSubmit={saveWaitlistEntry}>
          <h2 className="text-lg font-extrabold tracking-tight">Join the waitlist</h2>
          <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
            This saves locally right now. A real launch waitlist needs parent-approved privacy terms and backend storage.
          </p>
          <label className="mt-4 block">
            <FieldLabel>Email</FieldLabel>
            <TextInput
              inputMode="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <label className="mt-4 block">
            <FieldLabel>I am a</FieldLabel>
            <SelectField onChange={(e) => setUserType(e.target.value)} value={userType}>
              <option value="car_owner">Car owner</option>
              <option value="van_life">Van life owner</option>
              <option value="used_car_buyer">Used car buyer</option>
              <option value="weekend_wrencher">Weekend wrenching beginner</option>
              <option value="other">Other</option>
            </SelectField>
          </label>
          <label className="mt-4 block">
            <FieldLabel>What problem should Deep Spec solve?</FieldLabel>
            <TextArea
              maxLength={240}
              onChange={(e) => setMainProblem(e.target.value)}
              placeholder="Example: I want to know if a used car leak is serious before buying."
              value={mainProblem}
            />
          </label>
          <Button className="mt-4 w-full" type="submit">Save waitlist entry</Button>
          {waitlistStatus ? <p className="mt-3 text-sm font-semibold text-[#FACC15]">{waitlistStatus}</p> : null}
        </form>

        <button
          onClick={() => go("/history")}
          className="mt-5 block w-full rounded-full bg-white/10 px-5 py-3 text-center text-sm font-bold text-white"
        >
          View saved scans
        </button>
      </div>
    </main>
  );
}

Object.assign(window, { EarlyAccessScreen });
