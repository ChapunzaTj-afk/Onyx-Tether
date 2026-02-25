import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserRole = "owner" | "site_manager" | "worker";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "asset_id,tag_id,name,value,status,is_active,next_service_date,last_checkout_date,assigned_user_name,assigned_user_phone,site_name,created_at\n";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

async function createSupabaseRouteClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase public env vars are missing");
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

export async function GET() {
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, company_id, is_active")
      .eq("id", user.id)
      .single<{ role: UserRole; company_id: string; is_active: boolean }>();

    if (profileError || !profile || !profile.is_active || profile.role !== "owner") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select(
        `
        id,
        tag_id,
        name,
        value,
        status,
        is_active,
        next_service_date,
        last_checkout_date,
        created_at,
        assigned_user:profiles!assets_assigned_user_id_fkey (
          full_name,
          phone_number
        ),
        current_site:sites!assets_current_site_id_fkey (
          name
        )
      `,
      )
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: true });

    if (assetsError) {
      throw new Error(`Failed to export inventory: ${assetsError.message}`);
    }

    const rows = (assets ?? []).map((asset) => ({
      asset_id: asset.id,
      tag_id: asset.tag_id,
      name: asset.name,
      value: asset.value,
      status: asset.status,
      is_active: asset.is_active,
      next_service_date: asset.next_service_date,
      last_checkout_date: asset.last_checkout_date,
      assigned_user_name: asset.assigned_user?.full_name ?? "",
      assigned_user_phone: asset.assigned_user?.phone_number ?? "",
      site_name: asset.current_site?.name ?? "",
      created_at: asset.created_at,
    }));

    const csv = toCsv(rows);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="onyx-tether-inventory.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
