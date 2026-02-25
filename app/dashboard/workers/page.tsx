import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { deactivateUser, inviteWorker } from "../../actions/admin-actions";
import { UserPlus } from "lucide-react";

export default async function WorkersPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <PanelMessage>Sign in required.</PanelMessage>;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  if (!profile?.company_id) {
    return <PanelMessage>No company found for this user.</PanelMessage>;
  }

  const companyId = profile.company_id;

  const [profilesResult, activeCheckoutCountsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone_number, role, is_external, nuisance_score, is_active")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("assets")
      .select("assigned_user_id")
      .eq("company_id", companyId)
      .in("status", ["on_site", "transfer_pending"])
      .not("assigned_user_id", "is", null),
  ]);

  const workers = (profilesResult.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    phone_number: string | null;
    role: "owner" | "site_manager" | "worker";
    is_external: boolean;
    nuisance_score: number | null;
    is_active: boolean;
  }>;
  const checkoutRows = (activeCheckoutCountsResult.data ?? []) as Array<{ assigned_user_id: string | null }>;

  const checkoutCounts = new Map<string, number>();
  for (const row of checkoutRows) {
    if (!row.assigned_user_id) continue;
    checkoutCounts.set(row.assigned_user_id, (checkoutCounts.get(row.assigned_user_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workforce Control
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            Worker Directory
          </h1>
          <p className="text-sm text-slate-500">
            Invite crews, monitor checkouts, and deactivate access when needed.
          </p>
        </div>
        <InviteWorkerSlideOver />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[72vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3 text-center">Active Checkouts</th>
                <th className="px-5 py-3 text-center">Nuisance Score</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => {
                const nuisance = worker.nuisance_score ?? 0;
                const checkouts = checkoutCounts.get(worker.id) ?? 0;
                const roleLabel =
                  worker.is_external && worker.role === "worker"
                    ? "Subbie"
                    : worker.role === "site_manager"
                      ? "Manager"
                      : worker.role === "owner"
                        ? "Owner"
                        : "Worker";

                return (
                  <tr key={worker.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{worker.full_name ?? "Unnamed"}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {worker.is_active ? "Active" : "Deactivated"}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{worker.phone_number ?? "—"}</td>
                    <td className="px-5 py-3">
                      <RoleBadge roleLabel={roleLabel} />
                    </td>
                    <td className="px-5 py-3 text-center font-semibold text-slate-900">{checkouts}</td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={[
                          "inline-flex min-w-10 justify-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                          nuisance > 3
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-slate-50 text-slate-700",
                        ].join(" ")}
                      >
                        {nuisance}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {worker.role === "owner" ? (
                        <span className="text-xs text-slate-400">Protected</span>
                      ) : worker.is_active ? (
                        <form
                          action={async () => {
                            "use server";
                            await deactivateUser(worker.id);
                          }}
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            Deactivate
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-400">Inactive</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {workers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    No workers found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function InviteWorkerSlideOver() {
  return (
    <details className="group relative">
      <summary className="list-none">
        <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
          <UserPlus className="h-4 w-4" />
          Invite Worker
        </span>
      </summary>

      <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm">
        <div className="absolute inset-y-0 right-0 w-full max-w-md border-l border-slate-200 bg-white shadow-2xl">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Team Access
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Invite Worker</h2>
              </div>
              <span className="text-xs text-slate-500">Close panel by toggling the button</span>
            </div>

            <form
              action={async (formData) => {
                "use server";
                await inviteWorker(
                  String(formData.get("full_name") ?? ""),
                  String(formData.get("phone_number") ?? ""),
                  String(formData.get("role") ?? "worker"),
                );
              }}
              className="flex flex-1 flex-col"
            >
              <div className="space-y-4 overflow-y-auto px-5 py-5">
                <LabeledField label="Name" name="full_name" placeholder="Dave Smith" />
                <LabeledField label="Phone" name="phone_number" placeholder="+447700900456" type="tel" />

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Role</span>
                  <select
                    name="role"
                    defaultValue="worker"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="worker">Worker</option>
                    <option value="site_manager">Site Manager</option>
                  </select>
                </label>

                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Invites create a phone-based OTP login user and profile inside your company.
                </div>
              </div>

              <div className="border-t border-slate-200 px-5 py-4">
                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </details>
  );
}

function LabeledField({
  label,
  name,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
      />
    </label>
  );
}

function RoleBadge({ roleLabel }: { roleLabel: string }) {
  const tone =
    roleLabel === "Owner"
      ? "border-slate-900 bg-slate-900 text-white"
      : roleLabel === "Manager"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : roleLabel === "Subbie"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{roleLabel}</span>;
}

function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
      {children}
    </div>
  );
}

async function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}
