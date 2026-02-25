"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AdminAssetActionResult = { success: boolean; error?: string };
type UserRole = "owner" | "site_manager" | "worker";
type RetireReason = "sold" | "scrapped" | "lost";
type AssetStatus = "in_yard" | "on_site" | "quarantine" | "lost" | "retired";

class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function createSupabaseUserClient() {
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

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service role env vars are missing");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireOwnerContext() {
  const userClient = await createSupabaseUserClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new UnauthorizedError("Unauthorized");
  }

  const adminClient = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, company_id, is_active")
    .eq("id", user.id)
    .single<{
      id: string;
      role: UserRole;
      company_id: string;
      is_active: boolean;
    }>();

  if (profileError || !profile || !profile.is_active || profile.role !== "owner") {
    throw new UnauthorizedError("Unauthorized");
  }

  return { owner: profile, adminClient };
}

function normalizeOptionalServiceDate(nextServiceDate?: string) {
  if (!nextServiceDate || !nextServiceDate.trim()) {
    return null;
  }

  const parsed = new Date(nextServiceDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid nextServiceDate");
  }

  return parsed.toISOString();
}

export async function registerAsset(
  tagId: string,
  name: string,
  value: number,
  nextServiceDate?: string,
): Promise<AdminAssetActionResult> {
  try {
    const { owner, adminClient } = await requireOwnerContext();

    const normalizedTagId = tagId.trim();
    const normalizedName = name.trim();
    const normalizedValue = Number(value);
    const normalizedNextServiceDate = normalizeOptionalServiceDate(nextServiceDate);

    if (!normalizedTagId || !normalizedName) {
      return { success: false, error: "tagId and name are required" };
    }

    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
      return { success: false, error: "value must be a non-negative number" };
    }

    const { data: existing, error: existingError } = await adminClient
      .from("assets")
      .select("id")
      .eq("company_id", owner.company_id)
      .eq("tag_id", normalizedTagId)
      .maybeSingle<{ id: string }>();

    if (existingError) {
      throw new Error(`Failed to validate tagId: ${existingError.message}`);
    }

    if (existing) {
      return { success: false, error: "tagId is already in use for this company" };
    }

    const { error: insertError } = await adminClient.from("assets").insert({
      company_id: owner.company_id,
      tag_id: normalizedTagId,
      name: normalizedName,
      value: normalizedValue,
      status: "in_yard",
      is_active: true,
      next_service_date: normalizedNextServiceDate,
    });

    if (insertError) {
      throw new Error(`Failed to register asset: ${insertError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/assets");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Asset registration failed";
    return { success: false, error: message };
  }
}

export async function updateAssetDetails(
  assetId: string,
  name: string,
  value: number,
  nextServiceDate?: string,
): Promise<AdminAssetActionResult> {
  try {
    const { owner, adminClient } = await requireOwnerContext();

    const normalizedAssetId = assetId.trim();
    const normalizedName = name.trim();
    const normalizedValue = Number(value);
    const normalizedNextServiceDate = normalizeOptionalServiceDate(nextServiceDate);

    if (!normalizedAssetId || !normalizedName) {
      return { success: false, error: "assetId and name are required" };
    }

    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
      return { success: false, error: "value must be a non-negative number" };
    }

    const { error: updateError } = await adminClient
      .from("assets")
      .update({
        name: normalizedName,
        value: normalizedValue,
        next_service_date: normalizedNextServiceDate,
      })
      .eq("id", normalizedAssetId)
      .eq("company_id", owner.company_id);

    if (updateError) {
      throw new Error(`Failed to update asset: ${updateError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/assets");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Asset update failed";
    return { success: false, error: message };
  }
}

export async function retireAsset(
  assetId: string,
  reason: RetireReason,
): Promise<AdminAssetActionResult> {
  try {
    const { owner, adminClient } = await requireOwnerContext();
    const normalizedAssetId = assetId.trim();

    if (!normalizedAssetId) {
      return { success: false, error: "assetId is required" };
    }

    if (!["sold", "scrapped", "lost"].includes(reason)) {
      return { success: false, error: "Invalid retirement reason" };
    }

    const { data: asset, error: assetError } = await adminClient
      .from("assets")
      .select("id, company_id, current_site_id, assigned_user_id, status")
      .eq("id", normalizedAssetId)
      .eq("company_id", owner.company_id)
      .single<{
        id: string;
        company_id: string;
        current_site_id: string | null;
        assigned_user_id: string | null;
        status: AssetStatus;
      }>();

    if (assetError || !asset) {
      return { success: false, error: "Asset not found in your company" };
    }

    const nextStatus: AssetStatus = reason === "lost" ? "lost" : "retired";

    const { error: updateError } = await adminClient
      .from("assets")
      .update({
        is_active: false,
        status: nextStatus,
        assigned_user_id: null,
        current_site_id: null,
      })
      .eq("id", asset.id)
      .eq("company_id", owner.company_id);

    if (updateError) {
      throw new Error(`Failed to retire asset: ${updateError.message}`);
    }

    const logAction = reason === "lost" ? "mark_lost" : "retire";
    const logNotes =
      reason === "lost"
        ? "Asset marked lost by owner."
        : `Asset retired by owner (${reason}).`;

    const { error: logError } = await adminClient.from("logs").insert({
      asset_id: asset.id,
      user_id: owner.id,
      site_id: null,
      action: logAction,
      condition: "good",
      notes: logNotes,
      company_id: owner.company_id,
    });

    if (logError) {
      throw new Error(`Asset status updated but log insert failed: ${logError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/assets");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Asset retirement failed";
    return { success: false, error: message };
  }
}
