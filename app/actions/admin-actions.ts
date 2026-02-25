"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

type AdminActionResult = { success: boolean; error?: string };
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

  if (profileError || !profile) {
    throw new UnauthorizedError("Unauthorized");
  }

  if (!profile.is_active || profile.role !== "owner") {
    throw new UnauthorizedError("Unauthorized");
  }

  return { owner: profile, adminClient };
}

function normalizeInvitedRole(role: string): UserRole {
  const value = role.trim() as UserRole;
  if (value !== "worker" && value !== "site_manager" && value !== "owner") {
    throw new Error("Invalid role. Expected 'worker', 'site_manager', or 'owner'.");
  }
  return value;
}

export async function inviteWorker(
  phoneNumber: string,
  fullName: string,
  role: string,
): Promise<AdminActionResult> {
  const { owner, adminClient } = await requireOwnerContext();

  try {
    const normalizedPhone = phoneNumber.trim();
    const normalizedName = fullName.trim();
    const normalizedRole = normalizeInvitedRole(role);

    if (!normalizedPhone || !normalizedName) {
      return { success: false, error: "phoneNumber and fullName are required" };
    }

    const { data: createdUser, error: createUserError } =
      await adminClient.auth.admin.createUser({
        phone: normalizedPhone,
        phone_confirm: false,
        user_metadata: {
          full_name: normalizedName,
          phone_number: normalizedPhone,
          company_id: owner.company_id,
        },
      });

    if (createUserError || !createdUser.user) {
      throw new Error(createUserError?.message || "Failed to create auth user");
    }

    const newUserId = createdUser.user.id;

    const { error: profileInsertError } = await adminClient.from("profiles").insert({
      id: newUserId,
      full_name: normalizedName,
      phone_number: normalizedPhone,
      role: normalizedRole,
      company_id: owner.company_id,
      is_active: true,
    });

    if (profileInsertError) {
      // Best-effort cleanup to avoid orphaned auth users if profile insert fails.
      await adminClient.auth.admin.deleteUser(newUserId);
      throw new Error(`Failed to create profile: ${profileInsertError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/team");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Invite failed";
    return { success: false, error: message };
  }
}

export async function deactivateUser(userId: string): Promise<AdminActionResult> {
  const { owner, adminClient } = await requireOwnerContext();

  try {
    const targetUserId = userId.trim();
    if (!targetUserId) {
      return { success: false, error: "userId is required" };
    }

    if (targetUserId === owner.id) {
      return { success: false, error: "Owners cannot deactivate themselves" };
    }

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", targetUserId)
      .eq("company_id", owner.company_id)
      .single<{ id: string }>();

    if (targetProfileError || !targetProfile) {
      return { success: false, error: "User not found in your company" };
    }

    const { error: deactivateProfileError } = await adminClient
      .from("profiles")
      .update({ is_active: false })
      .eq("id", targetUserId)
      .eq("company_id", owner.company_id);

    if (deactivateProfileError) {
      throw new Error(`Failed to deactivate user: ${deactivateProfileError.message}`);
    }

    const { error: quarantineAssetsError } = await adminClient
      .from("assets")
      .update({
        status: "quarantine",
        assigned_user_id: null,
      })
      .eq("company_id", owner.company_id)
      .eq("assigned_user_id", targetUserId);

    if (quarantineAssetsError) {
      throw new Error(`Failed to quarantine assigned assets: ${quarantineAssetsError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/team");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Deactivation failed";
    return { success: false, error: message };
  }
}

export async function addSubcontractor(
  fullName: string,
  phoneNumber: string,
  companyName: string,
): Promise<AdminActionResult> {
  const { owner, adminClient } = await requireOwnerContext();

  try {
    const normalizedName = fullName.trim();
    const normalizedPhone = phoneNumber.trim();
    const normalizedCompanyName = companyName.trim();

    if (!normalizedName || !normalizedPhone || !normalizedCompanyName) {
      return { success: false, error: "fullName, phoneNumber, and companyName are required" };
    }

    const syntheticEmail = `subcontractor+${randomUUID()}@onyx-tether.invalid`;
    const syntheticPassword = randomUUID();

    const { data: createdUser, error: createUserError } =
      await adminClient.auth.admin.createUser({
        email: syntheticEmail,
        password: syntheticPassword,
        email_confirm: false,
        user_metadata: {
          full_name: normalizedName,
          phone_number: normalizedPhone,
          company_name: normalizedCompanyName,
          company_id: owner.company_id,
          is_external: true,
          login_disabled_reason: "external_subcontractor",
        },
      });

    if (createUserError || !createdUser.user) {
      throw new Error(createUserError?.message || "Failed to create subcontractor auth record");
    }

    const subcontractorId = createdUser.user.id;

    const { error: insertProfileError } = await adminClient.from("profiles").insert({
      id: subcontractorId,
      full_name: normalizedName,
      phone_number: normalizedPhone,
      role: "worker",
      company_id: owner.company_id,
      is_active: true,
      is_external: true,
    });

    if (insertProfileError) {
      await adminClient.auth.admin.deleteUser(subcontractorId);
      throw new Error(`Failed to create subcontractor profile: ${insertProfileError.message}`);
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/team");
    return { success: true };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Add subcontractor failed";
    return { success: false, error: message };
  }
}
