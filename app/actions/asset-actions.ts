"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type ActionResult = { success: boolean; error?: string };

type AssetLookup = {
  id: string;
  status: "in_yard" | "on_site" | "quarantine" | "lost" | "retired";
  assigned_user_id: string | null;
  current_site_id: string | null;
  next_service_date: string | null;
};

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

async function requireAuthenticatedUser() {
  const supabase = await createSupabaseServerActionClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("You must be signed in to perform this action");
  }

  return { supabase, user };
}

async function findAssetByTag(
  tagId: string,
  supabase: Awaited<ReturnType<typeof createSupabaseServerActionClient>>,
) {
  const { data, error } = await supabase
    .from("assets")
    .select("id, status, assigned_user_id, current_site_id, next_service_date")
    .eq("tag_id", tagId)
    .single<AssetLookup>();

  if (error || !data) {
    throw new Error("Asset not found");
  }

  return data;
}

export async function checkoutAsset(tagId: string, siteId: string): Promise<ActionResult> {
  try {
    if (!tagId || !siteId) {
      return { success: false, error: "tagId and siteId are required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.status !== "in_yard") {
      return { success: false, error: "Asset is not currently in the yard" };
    }

    if (asset.next_service_date) {
      const nextServiceDate = new Date(asset.next_service_date);
      if (!Number.isNaN(nextServiceDate.getTime()) && nextServiceDate < new Date()) {
        throw new Error(
          "Safety Lockout: This asset is overdue for servicing and cannot be checked out.",
        );
      }
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("assets")
      .update({
        status: "on_site",
        current_site_id: siteId,
        assigned_user_id: user.id,
        last_checkout_date: now,
      })
      .eq("id", asset.id)
      .eq("status", "in_yard");

    if (updateError) {
      throw new Error(`Failed to update asset: ${updateError.message}`);
    }

    const { error: logError } = await supabase.from("logs").insert({
      asset_id: asset.id,
      user_id: user.id,
      site_id: siteId,
      action: "checkout",
      condition: "good",
    });

    if (logError) {
      throw new Error(`Asset checked out but log insert failed: ${logError.message}`);
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed";
    return { success: false, error: message };
  }
}

export async function returnAsset(
  tagId: string,
  isDamaged: boolean,
  photoUrl?: string,
  notes?: string,
): Promise<ActionResult> {
  try {
    if (!tagId) {
      return { success: false, error: "tagId is required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.assigned_user_id && asset.assigned_user_id !== user.id) {
      return { success: false, error: "You are not assigned to this asset" };
    }

    const nextStatus = isDamaged ? "quarantine" : "in_yard";

    const { error: updateError } = await supabase
      .from("assets")
      .update({
        status: nextStatus,
        current_site_id: null,
        assigned_user_id: null,
      })
      .eq("id", asset.id);

    if (updateError) {
      throw new Error(`Failed to update asset: ${updateError.message}`);
    }

    const { error: logError } = await supabase.from("logs").insert({
      asset_id: asset.id,
      user_id: user.id,
      site_id: null,
      action: "return",
      condition: isDamaged ? "damaged" : "good",
      damage_photo_url: isDamaged ? photoUrl ?? null : null,
      notes: notes?.trim() ? notes.trim() : null,
    });

    if (logError) {
      throw new Error(`Asset returned but log insert failed: ${logError.message}`);
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Return failed";
    return { success: false, error: message };
  }
}

export async function transferAsset(tagId: string, newWorkerId: string): Promise<ActionResult> {
  try {
    if (!tagId || !newWorkerId) {
      return { success: false, error: "tagId and newWorkerId are required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.assigned_user_id !== user.id) {
      return { success: false, error: "You are not currently assigned to this asset" };
    }

    if (!asset.current_site_id) {
      return { success: false, error: "Asset is not currently assigned to a site" };
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("assets")
      .update({
        assigned_user_id: newWorkerId,
        last_checkout_date: now,
      })
      .eq("id", asset.id)
      .eq("assigned_user_id", user.id);

    if (updateError) {
      throw new Error(`Failed to transfer asset: ${updateError.message}`);
    }

    const { error: logError } = await supabase.from("logs").insert({
      asset_id: asset.id,
      user_id: user.id,
      site_id: asset.current_site_id,
      action: "transfer",
      condition: "good",
    });

    if (logError) {
      throw new Error(`Asset transferred but log insert failed: ${logError.message}`);
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed";
    return { success: false, error: message };
  }
}
