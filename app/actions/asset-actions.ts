"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type ActionResult = { success: boolean; error?: string };

type AssetLookup = {
  id: string;
  status:
    | "in_yard"
    | "on_site"
    | "quarantine"
    | "lost"
    | "retired"
    | "transfer_pending";
  assigned_user_id: string | null;
  current_site_id: string | null;
  next_service_date: string | null;
  pending_transfer_user_id: string | null;
};

type RpcError = { message: string };

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
    .select(
      "id, status, assigned_user_id, current_site_id, next_service_date, pending_transfer_user_id",
    )
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

    const { supabase } = await requireAuthenticatedUser();
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
    const { error: rpcError } = await supabase.rpc("checkout_asset_by_tag", {
      p_tag_id: tagId,
      p_site_id: siteId,
      p_event_at: now,
      p_offline_timestamp: null,
    });

    if (rpcError) {
      const err = rpcError as RpcError;
      throw new Error(err.message || "Failed to check out asset");
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

    const { error: rpcError } = await supabase.rpc("return_asset_by_tag", {
      p_tag_id: tagId,
      p_is_damaged: isDamaged,
      p_photo_url: photoUrl ?? null,
      p_notes: notes ?? null,
      p_event_at: new Date().toISOString(),
      p_offline_timestamp: null,
    });

    if (rpcError) {
      const err = rpcError as RpcError;
      throw new Error(err.message || "Failed to return asset");
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Return failed";
    return { success: false, error: message };
  }
}

export async function transferAsset(tagId: string, targetUserId: string): Promise<ActionResult> {
  try {
    if (!tagId || !targetUserId) {
      return { success: false, error: "tagId and targetUserId are required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.assigned_user_id !== user.id) {
      return { success: false, error: "You are not currently assigned to this asset" };
    }

    if (!asset.current_site_id) {
      return { success: false, error: "Asset is not currently assigned to a site" };
    }

    if (asset.status !== "on_site") {
      return { success: false, error: "Asset must be on site to start a transfer" };
    }

    const { error: rpcError } = await supabase.rpc("request_asset_transfer_by_tag", {
      p_tag_id: tagId,
      p_target_user_id: targetUserId,
      p_event_at: new Date().toISOString(),
      p_offline_timestamp: null,
    });

    if (rpcError) {
      const err = rpcError as RpcError;
      throw new Error(err.message || "Failed to transfer asset");
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed";
    return { success: false, error: message };
  }
}

export async function acceptTransfer(tagId: string): Promise<ActionResult> {
  try {
    if (!tagId) {
      return { success: false, error: "tagId is required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.status !== "transfer_pending") {
      return { success: false, error: "Asset is not awaiting transfer acceptance" };
    }

    if (asset.pending_transfer_user_id !== user.id) {
      return { success: false, error: "You are not the pending transfer recipient" };
    }

    if (!asset.current_site_id) {
      return { success: false, error: "Asset is missing a site assignment" };
    }

    const { error: rpcError } = await supabase.rpc("accept_asset_transfer_by_tag", {
      p_tag_id: tagId,
      p_event_at: new Date().toISOString(),
      p_offline_timestamp: null,
    });

    if (rpcError) {
      const err = rpcError as RpcError;
      throw new Error(err.message || "Failed to accept transfer");
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Accept transfer failed";
    return { success: false, error: message };
  }
}

export async function rejectTransfer(tagId: string): Promise<ActionResult> {
  try {
    if (!tagId) {
      return { success: false, error: "tagId is required" };
    }

    const { supabase, user } = await requireAuthenticatedUser();
    const asset = await findAssetByTag(tagId, supabase);

    if (asset.status !== "transfer_pending") {
      return { success: false, error: "Asset is not awaiting transfer acceptance" };
    }

    if (asset.pending_transfer_user_id !== user.id) {
      return { success: false, error: "You are not the pending transfer recipient" };
    }

    const { error: rpcError } = await supabase.rpc("reject_asset_transfer_by_tag", {
      p_tag_id: tagId,
    });

    if (rpcError) {
      const err = rpcError as RpcError;
      throw new Error(err.message || "Failed to reject transfer");
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reject transfer failed";
    return { success: false, error: message };
  }
}
