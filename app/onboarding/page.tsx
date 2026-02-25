"use client";

import type { ReactNode } from "react";
import { useActionState, useMemo, useState } from "react";
import { Building2, ChevronRight, Mail, Phone, ShieldCheck, User } from "lucide-react";
import { completeOwnerOnboarding, type OnboardingState } from "./actions";

const initialState: OnboardingState = {};

export default function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [state, formAction, pending] = useActionState(completeOwnerOnboarding, initialState);

  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState("Europe/London");

  const canContinue = useMemo(
    () => Boolean(fullName.trim() && phoneNumber.trim() && businessEmail.trim()),
    [fullName, phoneNumber, businessEmail],
  );

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Onyx Tether
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                Owner Onboarding
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Set up your company workspace and billing identity for the owner portal.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
              Step {step} / 2
            </div>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-3">
            <StepPill active={step === 1} done={step === 2} label="Owner Identity" />
            <StepPill active={step === 2} done={false} label="Company Setup" />
          </div>

          <form action={formAction} className="space-y-6">
            <input type="hidden" name="full_name" value={fullName} />
            <input type="hidden" name="phone_number" value={phoneNumber} />
            <input type="hidden" name="business_email" value={businessEmail} />
            <input type="hidden" name="company_name" value={companyName} />
            <input type="hidden" name="timezone" value={timezone} />

            {step === 1 ? (
              <div className="space-y-4">
                <Field
                  icon={<User className="h-4 w-4" />}
                  label="Full name"
                  value={fullName}
                  onChange={setFullName}
                  placeholder="Jane Smith"
                />
                <Field
                  icon={<Phone className="h-4 w-4" />}
                  label="Phone number (OTP login)"
                  value={phoneNumber}
                  onChange={setPhoneNumber}
                  placeholder="+447700900123"
                  type="tel"
                />
                <Field
                  icon={<Mail className="h-4 w-4" />}
                  label="Business email (Stripe billing)"
                  value={businessEmail}
                  onChange={setBusinessEmail}
                  placeholder="ops@smithgroundworks.co.uk"
                  type="email"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <Field
                  icon={<Building2 className="h-4 w-4" />}
                  label="Company name"
                  value={companyName}
                  onChange={setCompanyName}
                  placeholder="Smith Groundworks"
                />
                <Field
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Timezone"
                  value={timezone}
                  onChange={setTimezone}
                  placeholder="Europe/London"
                />
              </div>
            )}

            {state.error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {state.error}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={step === 1 || pending}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Back
              </button>

              {step === 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!canContinue}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {pending ? "Creating workspace..." : "Create Workspace"}
                </button>
              )}
            </div>
          </form>
        </section>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-slate-100 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Industrial Enterprise Setup
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Build your control tower
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Onyx Tether configures your owner portal, fleet tenancy boundary, and billing identity
            in one setup flow.
          </p>

          <div className="mt-8 space-y-3">
            <ChecklistItem title="Tenant isolation" subtitle="Your company gets its own secure data boundary." />
            <ChecklistItem title="Owner profile" subtitle="Phone OTP login + business billing identity linked." />
            <ChecklistItem title="Billing ready" subtitle="Redirect to Stripe checkout once the workspace is created." />
          </div>
        </aside>
      </div>
    </main>
  );
}

function StepPill({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div
      className={[
        "rounded-xl border px-3 py-2 text-sm font-medium transition",
        done
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : active
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-slate-50 text-slate-500",
      ].join(" ")}
    >
      {label}
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm ring-0 transition focus-within:border-slate-900">
        <span className="text-slate-400">{icon}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          required
        />
      </span>
    </label>
  );
}

function ChecklistItem({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">{subtitle}</p>
    </div>
  );
}
