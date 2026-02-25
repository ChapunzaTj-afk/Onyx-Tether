import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import MobileConfirmClient from "../../../../components/MobileConfirmClient";

type PageProps = {
  params: Promise<{ tagId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MobileConfirmPage({ params, searchParams }: PageProps) {
  const { tagId } = await params;
  const qs = searchParams ? await searchParams : {};
  const mode = (Array.isArray(qs.mode) ? qs.mode[0] : qs.mode) === "out" ? "out" : "in";

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

  const [assetResult, sitesResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, tag_id, status")
      .eq("tag_id", decodeURIComponent(tagId))
      .maybeSingle<{ id: string; name: string; tag_id: string; status: string }>(),
    supabase
      .from("sites")
      .select("id, name")
      .eq("company_id", profile?.company_id ?? "")
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  const childAssetsResult = assetResult.data
    ? await supabase
        .from("assets")
        .select("id, name, tag_id, status")
        .eq("parent_asset_id", assetResult.data.id)
        .order("name", { ascending: true })
    : { data: [] as Array<{ id: string; name: string; tag_id: string; status: string }> };

  return (
    <MobileConfirmClient
      mode={mode}
      tagId={decodeURIComponent(tagId)}
      asset={
        assetResult.data
          ? {
              id: assetResult.data.id,
              name: assetResult.data.name,
              tagId: assetResult.data.tag_id,
              status: assetResult.data.status,
            }
          : null
      }
      sites={(sitesResult.data ?? []) as Array<{ id: string; name: string }>}
      childAssets={(childAssetsResult.data ?? []).map((child) => ({
        id: child.id,
        name: child.name,
        tagId: child.tag_id,
        status: child.status,
      }))}
    />
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
