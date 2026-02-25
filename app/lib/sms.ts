import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

export type SmsSendResult = {
  sent: boolean;
  suppressed: boolean;
  reason?: string;
};

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

function getTwilioConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_PHONE_NUMBER;

  if (!sid || !token || !from) {
    throw new Error("Twilio credentials are not fully configured");
  }

  return { sid, token, from };
}

export async function sendRateLimitedSms(
  phoneNumber: string,
  message: string,
  type: string,
): Promise<SmsSendResult> {
  const normalizedPhone = phoneNumber.trim();
  if (!normalizedPhone) {
    return { sent: false, suppressed: true, reason: "missing_phone_number" };
  }

  const supabase = getSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("sms_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", normalizedPhone)
    .eq("message_type", type)
    .gte("sent_at", cutoff);

  if (countError) {
    throw new Error(`Failed to check SMS rate limit: ${countError.message}`);
  }

  if ((count ?? 0) >= 3) {
    console.warn("SMS suppressed by rate limit", { phoneNumber: normalizedPhone, type });
    return { sent: false, suppressed: true, reason: "rate_limited" };
  }

  const { sid, token, from } = getTwilioConfig();
  const client = twilio(sid, token);

  await client.messages.create({
    body: message,
    from,
    to: normalizedPhone,
  });

  const { error: insertError } = await supabase.from("sms_rate_limits").insert({
    phone_number: normalizedPhone,
    message_type: type,
    sent_at: new Date().toISOString(),
  });

  if (insertError) {
    console.warn("SMS sent but rate-limit audit insert failed", {
      phoneNumber: normalizedPhone,
      type,
      error: insertError.message,
    });
  }

  return { sent: true, suppressed: false };
}

