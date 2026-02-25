import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { ShieldCheck } from "lucide-react";
import { SyncIndicator } from "../../../lib/offline-sync";
import MyGearTransferList from "../../../components/MyGearTransferList";

export default async function MyGearPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-200">
          Sign in required.
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  const companyId = profile?.company_id ?? "";

  const [myAssetsResult, workersResult] = await Promise.all([
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        tag_id,
        current_site:sites!assets_current_site_id_fkey (name)
      `,
      )
      .eq("company_id", companyId)
      .eq("assigned_user_id", user.id)
      .in("status", ["on_site", "transfer_pending"])
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("role", "worker")
      .neq("id", user.id)
      .order("full_name", { ascending: true }),
  ]);

  const items = (myAssetsResult.data ?? []).map((asset) => ({
    id: asset.id,
    name: asset.name,
    tagId: asset.tag_id,
    siteName: (asset.current_site as { name: string | null } | null)?.name ?? null,
  }));
  const workers = (workersResult.data ?? []).map((worker) => ({
    id: worker.id,
    fullName: worker.full_name ?? "Unnamed",
  }));

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <SyncIndicator />
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h1 className="text-xl font-black tracking-tight">My Gear</h1>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Tools and kit currently assigned to you. Transfer responsibly before handoff.
          </p>
        </div>

        <MyGearTransferList items={items} workers={workers} />
      </div>
    </main>
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

