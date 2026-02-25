import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OverdueAssetRow = {
  id: string;
  company_id: string;
  name: string;
  assigned_user: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
    nuisance_score: number | null;
  } | null;
  current_site: {
    name: string | null;
  } | null;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_FROM_PHONE_NUMBER;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase service credentials are not fully configured" },
      { status: 500 },
    );
  }

  if (!twilioSid || !twilioAuthToken || !twilioFromNumber) {
    return NextResponse.json(
      { error: "Twilio credentials are not fully configured" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const twilioClient = twilio(twilioSid, twilioAuthToken);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);

  const { data, error } = await supabase
    .from("assets")
    .select(
      `
      id,
      company_id,
      name,
      assigned_user:profiles!assets_assigned_user_id_fkey (
        id,
        full_name,
        phone_number,
        nuisance_score
      ),
      current_site:sites!assets_current_site_id_fkey (
        name
      )
    `,
    )
    .eq("status", "on_site")
    .lt("last_checkout_date", cutoff.toISOString());

  if (error) {
    return NextResponse.json(
      { error: "Failed to query overdue assets", details: error.message },
      { status: 500 },
    );
  }

  const overdueAssets = (data ?? []) as OverdueAssetRow[];
  const overdueAssetsByCompany = new Map<string, OverdueAssetRow[]>();

  for (const asset of overdueAssets) {
    const bucket = overdueAssetsByCompany.get(asset.company_id) ?? [];
    bucket.push(asset);
    overdueAssetsByCompany.set(asset.company_id, bucket);
  }

  let processed = 0;
  let smsSent = 0;
  let penaltiesApplied = 0;
  let skipped = 0;
  const failures: Array<{ assetId: string; reason: string }> = [];
  const companySummaries: Array<{
    companyId: string;
    overdueAssets: number;
    processed: number;
  }> = [];

  for (const [companyId, companyAssets] of overdueAssetsByCompany.entries()) {
    let companyProcessed = 0;

    // Future tenant-specific branching can live here
    // (e.g. subscription-tier rules, weekend SMS opt-outs, quiet hours).
    for (const asset of companyAssets) {
      processed += 1;
      companyProcessed += 1;

      const worker = asset.assigned_user;
      const site = asset.current_site;

      if (!worker?.id || !worker.phone_number) {
        skipped += 1;
        failures.push({
          assetId: asset.id,
          reason: "Missing assigned worker or phone number",
        });
        continue;
      }

      const workerName = worker.full_name?.trim() || "there";
      const siteName = site?.name?.trim() || "the assigned site";
      const assetName = asset.name;

      const body = `Onyx Tether: Hi ${workerName}, the ${assetName} has been at ${siteName} for over 14 days. Please return it to the yard today or transfer it via the app to avoid penalties.`;

      try {
        await twilioClient.messages.create({
          body,
          from: twilioFromNumber,
          to: worker.phone_number,
        });

        smsSent += 1;

        const nextNuisanceScore = (worker.nuisance_score ?? 0) + 1;
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ nuisance_score: nextNuisanceScore })
          .eq("id", worker.id)
          .eq("company_id", companyId);

        if (updateError) {
          failures.push({
            assetId: asset.id,
            reason: `SMS sent but nuisance_score update failed: ${updateError.message}`,
          });
          continue;
        }

        penaltiesApplied += 1;
      } catch (smsError) {
        const message =
          smsError instanceof Error ? smsError.message : "Unknown Twilio error";
        failures.push({ assetId: asset.id, reason: `SMS failed: ${message}` });
        continue;
      }
    }

    companySummaries.push({
      companyId,
      overdueAssets: companyAssets.length,
      processed: companyProcessed,
    });
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    cutoffDate: cutoff.toISOString(),
    totals: {
      overdueAssets: overdueAssets.length,
      processed,
      smsSent,
      penaltiesApplied,
      skipped,
      failures: failures.length,
    },
    companies: {
      totalCompanies: overdueAssetsByCompany.size,
      summaries: companySummaries,
    },
    failures,
  });
}
