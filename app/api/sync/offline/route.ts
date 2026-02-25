import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OfflineAction =
  | {
      action: "checkout";
      tagId: string;
      siteId: string;
      offlineTimestamp: string;
    }
  | {
      action: "return";
      tagId: string;
      isDamaged?: boolean;
      photoUrl?: string;
      notes?: string;
      offlineTimestamp: string;
    }
  | {
      action: "transfer";
      tagId: string;
      targetUserId: string;
      offlineTimestamp: string;
    };

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

function isOfflineAction(value: unknown): value is OfflineAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.action !== "string" || typeof v.tagId !== "string") return false;
  if (typeof v.offlineTimestamp !== "string") return false;
  if (v.action === "checkout") return typeof v.siteId === "string";
  if (v.action === "transfer") return typeof v.targetUserId === "string";
  return v.action === "return";
}

function parseIsoOrThrow(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid offlineTimestamp: ${value}`);
  }
  return date;
}

export async function POST(request: Request) {
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
      .select("id, is_active")
      .eq("id", user.id)
      .single<{ id: string; is_active: boolean }>();

    if (profileError || !profile || !profile.is_active) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const payload = await request.json();
    if (!Array.isArray(payload)) {
      return NextResponse.json({ error: "Payload must be an array of actions" }, { status: 400 });
    }

    const parsed: OfflineAction[] = [];
    for (const item of payload) {
      if (!isOfflineAction(item)) {
        return NextResponse.json({ error: "Invalid offline action payload item" }, { status: 400 });
      }
      parsed.push(item);
    }

    parsed.sort(
      (a, b) =>
        parseIsoOrThrow(a.offlineTimestamp).getTime() - parseIsoOrThrow(b.offlineTimestamp).getTime(),
    );

    const results: Array<{ index: number; success: boolean; error?: string; action: string; tagId: string }> =
      [];

    for (let index = 0; index < parsed.length; index += 1) {
      const item = parsed[index];

      try {
        const offlineAt = parseIsoOrThrow(item.offlineTimestamp).toISOString();

        if (item.action === "checkout") {
          const { error } = await supabase.rpc("checkout_asset_by_tag", {
            p_tag_id: item.tagId,
            p_site_id: item.siteId,
            p_event_at: offlineAt,
            p_offline_timestamp: offlineAt,
          });
          if (error) throw new Error(error.message);
        } else if (item.action === "return") {
          const { error } = await supabase.rpc("return_asset_by_tag", {
            p_tag_id: item.tagId,
            p_is_damaged: item.isDamaged ?? false,
            p_photo_url: item.photoUrl ?? null,
            p_notes: item.notes ?? null,
            p_event_at: offlineAt,
            p_offline_timestamp: offlineAt,
          });
          if (error) throw new Error(error.message);
        } else if (item.action === "transfer") {
          const { error } = await supabase.rpc("request_asset_transfer_by_tag", {
            p_tag_id: item.tagId,
            p_target_user_id: item.targetUserId,
            p_event_at: offlineAt,
            p_offline_timestamp: offlineAt,
          });
          if (error) throw new Error(error.message);
        }

        results.push({
          index,
          success: true,
          action: item.action,
          tagId: item.tagId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync item failed";
        results.push({
          index,
          success: false,
          action: item.action,
          tagId: item.tagId,
          error: message,
        });
      }
    }

    const failed = results.filter((r) => !r.success);

    return NextResponse.json({
      success: failed.length === 0,
      processed: results.length,
      failed: failed.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Offline sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

