import { createHmac } from "crypto";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not fully configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function signPayload(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function triggerWebhooks(
  companyId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { data: hooks, error } = await supabase
    .from("outbound_webhooks")
    .select("id, endpoint_url, secret_key")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .contains("event_types", [eventType]);

  if (error) {
    throw new Error(`Failed to query outbound webhooks: ${error.message}`);
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    companyId,
    eventType,
    occurredAt: timestamp,
    payload,
  });

  await Promise.all(
    (hooks ?? []).map(async (hook) => {
      const signature = signPayload(hook.secret_key, timestamp, body);

      try {
        const res = await fetch(hook.endpoint_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Onyx-Tether-Event": eventType,
            "X-Onyx-Tether-Timestamp": timestamp,
            "X-Onyx-Tether-Signature": signature,
          },
          body,
        });

        if (!res.ok) {
          console.warn("Outbound webhook non-2xx response", {
            webhookId: hook.id,
            status: res.status,
          });
        }
      } catch (err) {
        console.warn("Outbound webhook delivery failed", {
          webhookId: hook.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

