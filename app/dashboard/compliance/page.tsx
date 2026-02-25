import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  startOfDay,
} from "date-fns";
import { AlertTriangle, CalendarClock } from "lucide-react";

export default async function CompliancePage() {
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
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const { data: assets } = await supabase
    .from("assets")
    .select("id, name, status, next_service_date")
    .eq("company_id", companyId)
    .not("next_service_date", "is", null)
    .lte("next_service_date", addMonths(monthEnd, 2).toISOString())
    .order("next_service_date", { ascending: true });

  const rows = (assets ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    next_service_date: string | null;
  }>;

  const dueByDay = new Map<string, typeof rows>();
  for (const asset of rows) {
    if (!asset.next_service_date) continue;
    const key = format(startOfDay(new Date(asset.next_service_date)), "yyyy-MM-dd");
    const bucket = dueByDay.get(key) ?? [];
    bucket.push(asset);
    dueByDay.set(key, bucket);
  }

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = startOfDay(new Date());

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Safety Calendar
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              Compliance & Service Due Dates
            </h1>
            <p className="text-sm text-slate-500">
              Monthly service schedule with critical alerts for unserviced assets still in operation.
            </p>
          </div>
          <CalendarClock className="h-5 w-5 text-slate-400" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="px-2 py-3">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = dueByDay.get(key) ?? [];

            return (
              <div
                key={key}
                className={[
                  "min-h-[150px] border-b border-r border-slate-100 p-2",
                  !isSameMonth(day, monthStart) ? "bg-slate-50/60" : "bg-white",
                ].join(" ")}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={[
                      "grid h-7 w-7 place-items-center rounded-full text-xs font-semibold",
                      isToday(day)
                        ? "bg-slate-900 text-white"
                        : isSameMonth(day, monthStart)
                          ? "text-slate-900"
                          : "text-slate-400",
                    ].join(" ")}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {items.slice(0, 3).map((asset) => {
                    const isCritical =
                      isBefore(startOfDay(day), today) && asset.status !== "quarantine";
                    return (
                      <div
                        key={asset.id}
                        className={[
                          "rounded-lg border px-2 py-1.5 text-xs",
                          isCritical
                            ? "border-rose-200 bg-rose-50 text-rose-800"
                            : "border-amber-200 bg-amber-50 text-amber-800",
                        ].join(" ")}
                      >
                        <div className="font-semibold leading-4">{asset.name}</div>
                        <div className="mt-0.5 leading-4">
                          {isCritical ? "CRITICAL: UNSERVICED" : "Service Due"}
                        </div>
                      </div>
                    );
                  })}

                  {items.length > 3 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      +{items.length - 3} more
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <p>
            <span className="font-semibold">Critical rule:</span> past-due service dates are flagged
            as critical unless the asset is already in quarantine.
          </p>
        </div>
      </section>
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
