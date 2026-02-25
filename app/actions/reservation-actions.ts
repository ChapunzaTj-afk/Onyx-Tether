"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type ReservationActionResult = { success: boolean; error?: string };

async function createSupabaseServerActionClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase env vars are missing");
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

export async function createReservation(
  assetId: string,
  siteId: string,
  startDate: string,
  endDate: string,
): Promise<ReservationActionResult> {
  try {
    if (!assetId || !siteId || !startDate || !endDate) {
      return { success: false, error: "assetId, siteId, startDate, and endDate are required" };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return { success: false, error: "Invalid reservation date range" };
    }

    const supabase = await createSupabaseServerActionClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: "Unauthorized" };
    }

    const { data: overlap, error: overlapError } = await supabase
      .from("reservations")
      .select("id")
      .eq("asset_id", assetId)
      .in("status", ["pending", "active"])
      .lt("start_date", end.toISOString())
      .gt("end_date", start.toISOString())
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (overlapError) {
      throw new Error(`Failed to validate reservation conflicts: ${overlapError.message}`);
    }

    if (overlap) {
      return { success: false, error: "Scheduling Conflict: This asset is already reserved for overlapping dates." };
    }

    const { error: insertError } = await supabase.from("reservations").insert({
      asset_id: assetId,
      site_id: siteId,
      reserved_by_user_id: user.id,
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      status: "pending",
    });

    if (insertError) {
      throw new Error(`Failed to create reservation: ${insertError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/reservations");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create reservation failed";
    return { success: false, error: message };
  }
}

