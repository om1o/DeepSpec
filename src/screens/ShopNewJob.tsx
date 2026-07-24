import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import { createShopJob } from "../services/shop";
import type { ShopJobInput } from "../services/shop";

const emptyForm: ShopJobInput = {
  bayOrRo: "",
  customerName: "",
  engine: "",
  make: "",
  mileage: "",
  model: "",
  notes: "",
  plate: "",
  symptom: "",
  technicianName: "",
  title: "",
  vin: "",
  year: "",
};

export default function ShopNewJob() {
  const navigate = useNavigate();
  const [form, setForm] = useState<ShopJobInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  function updateField(field: keyof ShopJobInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = createShopJob(form);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (!result.value) {
      setError("DeepSpec could not create this shop job.");
      return;
    }

    navigate(`/scan?jobId=${encodeURIComponent(result.value.id)}`);
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Shop intake</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">New job</h1>
          </div>
          <Link to="/shop" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
            Queue
          </Link>
        </header>

        {error ? (
          <div role="alert" className="mt-4 rounded-[8px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-4 py-3 text-sm font-bold text-[var(--ds-warn-ink)]">
            {error}
          </div>
        ) : null}

        <form className="mt-6 rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleSubmit}>
          <section>
            <h2 className="text-lg font-black tracking-tight">Required before scan</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField label="Job title" required value={form.title} onChange={(value) => updateField("title", value)} />
              <TextField label="Technician" required value={form.technicianName} onChange={(value) => updateField("technicianName", value)} />
              <TextField label="Year" required value={form.year} onChange={(value) => updateField("year", value)} />
              <TextField label="Make" required value={form.make} onChange={(value) => updateField("make", value)} />
              <TextField label="Model" required value={form.model} onChange={(value) => updateField("model", value)} />
              <TextField label="Symptom / complaint" required value={form.symptom} onChange={(value) => updateField("symptom", value)} />
            </div>
          </section>

          <section className="mt-7 border-t border-slate-100 pt-5">
            <h2 className="text-lg font-black tracking-tight">Promoted context</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">VIN is optional, but missing context keeps fitment confidence in a needs-vehicle-context state.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField label="VIN" value={form.vin} onChange={(value) => updateField("vin", value)} />
              <TextField label="Mileage" value={form.mileage} onChange={(value) => updateField("mileage", value)} />
              <TextField label="Engine" value={form.engine} onChange={(value) => updateField("engine", value)} />
              <TextField label="Customer name" value={form.customerName} onChange={(value) => updateField("customerName", value)} />
              <TextField label="Plate" value={form.plate} onChange={(value) => updateField("plate", value)} />
              <TextField label="Bay / RO number" value={form.bayOrRo} onChange={(value) => updateField("bayOrRo", value)} />
            </div>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-slate-700">Notes</span>
              <textarea
                className="mt-1 min-h-28 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--ds-accent)]"
                onChange={(event) => updateField("notes", event.target.value)}
                value={form.notes}
              />
            </label>
          </section>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <Link to="/shop" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
              Cancel
            </Link>
            <Button type="submit">
              Start scan
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

function TextField({
  label,
  onChange,
  required = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-700">
        {label}
        {required ? <span className="text-[var(--ds-warn-ink)]"> *</span> : null}
      </span>
      <input
        className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--ds-accent)]"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value ?? ""}
      />
    </label>
  );
}
