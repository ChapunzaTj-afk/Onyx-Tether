import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { resolveQuarantine } from "../../actions/admin-asset-actions";
import { AlertTriangle, Hammer, ShieldX } from "lucide-react";

export default async function QuarantinePage() {
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

  const { data: quarantineAssets } = await supabase
    .from("assets")
    .select("id, name, value, tag_id")
    .eq("company_id", companyId)
    .eq("status", "quarantine")
    .order("created_at", { ascending: false });

  const assets = (quarantineAssets ?? []) as Array<{
    id: string;
    name: string;
    value: number | null;
    tag_id: string;
  }>;

  const logSnapshots = await Promise.all(
    assets.map(async (asset) => {
      const { data } = await supabase
        .from("logs")
        .select(
          `
          id,
          action,
          condition,
          damage_photo_url,
          created_at,
          notes,
          user:profiles!logs_user_id_fkey (full_name)
        `,
        )
        .eq("asset_id", asset.id)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(5);

      const rows = (data ?? []) as Array<{
        id: string;
        action: string;
        condition: string | null;
        damage_photo_url: string | null;
        created_at: string;
        notes: string | null;
        user: { full_name: string | null } | null;
      }>;

      const flagLog = rows.find((row) => row.condition === "damaged" || row.action === "flag_damaged") ?? rows[0];
      const previousUserRow =
        rows.find((row) => row.id !== flagLog?.id && row.user?.full_name) ?? null;

      return {
        assetId: asset.id,
        flagLog,
        previousUserRow,
      };
    }),
  );

  const byAssetId = new Map(logSnapshots.map((snapshot) => [snapshot.assetId, snapshot]));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-amber-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
          Dispute Inbox
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
          Quarantine Resolution Queue
        </h1>
        <p className="text-sm text-slate-700">
          Resolve damaged gear fast to reduce downtime and close the accountability loop.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {assets.map((asset) => {
          const snapshot = byAssetId.get(asset.id);
          const flagLog = snapshot?.flagLog;
          const previousUser = snapshot?.previousUserRow?.user?.full_name ?? "Unknown";
          const flaggedBy = flagLog?.user?.full_name ?? "Unknown";
          const photoUrl = flagLog?.damage_photo_url;

          return (
            <article
              key={asset.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{asset.name}</h2>
                    <p className="mt-0.5 text-xs font-mono text-slate-500">{asset.tag_id}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Quarantine
                  </span>
                </div>
              </div>

              <div className="p-4">
                <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  {photoUrl ? (
                    <details className="group">
                      <summary className="list-none cursor-zoom-in">
                        <img
                          src={photoUrl}
                          alt={`${asset.name} damage evidence`}
                          className="h-44 w-full object-cover"
                        />
                      </summary>
                      <div className="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/90 p-6 group-open:flex">
                        <img
                          src={photoUrl}
                          alt={`${asset.name} damage evidence enlarged`}
                          className="max-h-[85vh] rounded-xl border border-slate-700 object-contain shadow-2xl"
                        />
                      </div>
                    </details>
                  ) : (
                    <div className="grid h-44 place-items-center text-sm text-slate-500">
                      No damage photo uploaded
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <InfoRow label="Flagged By" value={flaggedBy} />
                  <InfoRow label="Last Known User" value={previousUser} />
                  <InfoRow
                    label="Reported At"
                    value={
                      flagLog?.created_at
                        ? new Date(flagLog.created_at).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Unknown"
                    }
                  />
                </div>

                {flagLog?.notes ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {flagLog.notes}
                  </div>
                ) : null}

                <form
                  action={async (formData) => {
                    "use server";
                    const repairCost = Number(formData.get("repair_cost") ?? 0);
                    const notes = String(formData.get("notes") ?? "");
                    const intent = String(formData.get("intent") ?? "repair");
                    await resolveQuarantine(asset.id, repairCost, notes, intent === "scrap");
                  }}
                  className="mt-4 space-y-3"
                >
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">Repair Cost (£)</span>
                    <input
                      name="repair_cost"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">Resolution Notes</span>
                    <textarea
                      name="notes"
                      rows={3}
                      placeholder="Repair completed, casing replaced, tested and returned to yard."
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="submit"
                      name="intent"
                      value="repair"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      <Hammer className="h-4 w-4" />
                      Save Repair & Return
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="scrap"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <ShieldX className="h-4 w-4" />
                      Scrap Asset
                    </button>
                  </div>
                </form>
              </div>
            </article>
          );
        })}

        {assets.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center text-sm text-emerald-700">
            No quarantine items right now.
          </div>
        ) : null}
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
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
