"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type SiteActionResult = { success: boolean; error?: string };
type UserRole = "owner" | "site_manager" | "worker";

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

export async function createSite(name: string, managerId: string): Promise<SiteActionResult> {
  try {
    const { owner, adminClient } = await requireOwnerContext();
    const normalizedName = name.trim();
    const normalizedManagerId = managerId.trim();

    if (!normalizedName || !normalizedManagerId) {
      return { success: false, error: "name and managerId are required" };
    }

    const { data: managerProfile, error: managerError } = await adminClient
      .from("profiles")
      .select("id, is_active")
      .eq("id", normalizedManagerId)
      .eq("company_id", owner.company_id)
      .single<{ id: string; is_active: boolean }>();

    if (managerError || !managerProfile || !managerProfile.is_active) {
      return { success: false, error: "Manager not found or inactive in your company" };
    }

    const { error: insertError } = await adminClient.from("sites").insert({
      company_id: owner.company_id,
      name: normalizedName,
      manager_id: normalizedManagerId,
      status: "active",
    });

    if (insertError) {
      throw new Error(`Failed to create site: ${insertError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/sites");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    const message = error instanceof Error ? error.message : "Create site failed";
    return { success: false, error: message };
  }
}

export async function completeSite(siteId: string): Promise<SiteActionResult> {
  try {
    const { owner, adminClient } = await requireOwnerContext();
    const normalizedSiteId = siteId.trim();

    if (!normalizedSiteId) {
      return { success: false, error: "siteId is required" };
    }

    const { count, error: countError } = await adminClient
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", owner.company_id)
      .eq("current_site_id", normalizedSiteId)
      .neq("status", "retired");

    if (countError) {
      throw new Error(`Failed to check assigned assets: ${countError.message}`);
    }

    const assignedCount = count ?? 0;
    if (assignedCount > 0) {
      return {
        success: false,
        error: `Cannot close site: ${assignedCount} assets are still assigned here. Transfer or return them first.`,
      };
    }

    const { error: updateError } = await adminClient
      .from("sites")
      .update({ status: "completed" })
      .eq("id", normalizedSiteId)
      .eq("company_id", owner.company_id);

    if (updateError) {
      throw new Error(`Failed to complete site: ${updateError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/sites");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    const message = error instanceof Error ? error.message : "Complete site failed";
    return { success: false, error: message };
  }
}

