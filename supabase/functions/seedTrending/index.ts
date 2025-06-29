
import { serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { google } from "https://esm.sh/@googleapis/youtube@3.0.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const apiKey = Deno.env.get("YT_API_KEY")!;
const yt = google.youtube({ version: "v3", auth: apiKey });

serve(async () => {
  // ── 1. hit the YouTube "mostPopular" endpoint (Music, US)
  const res = await yt.videos.list({
    part: ["snippet", "statistics", "contentDetails"],
    chart: "mostPopular",
    regionCode: "US",
    videoCategoryId: "10",
    maxResults: 50,
  });

  if (!res.data.items?.length) {
    return new Response(
      JSON.stringify({ error: "No items returned" }),
      { status: 500 }
    );
  }

  // ── 2. build rows
  const rows = res.data.items.map((it) => ({
    youtube_id:  it.id!,
    channel_id:  it.snippet?.channelId ?? null,
    publish_time: it.snippet?.publishedAt
      ? new Date(it.snippet.publishedAt).toISOString()
      : null,
    title:       it.snippet?.title ?? "",
    duration:    isoToSeconds(it.contentDetails?.duration),
    init_views:  Number(it.statistics?.viewCount ?? 0),
    created_at:  new Date().toISOString(),
  }));

  // ── 3. upsert into videos
  const { data, error } = await supabase
    .from("videos")
    .upsert(rows, { onConflict: "youtube_id" });

  if (error) {
    console.error("DB upsert error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ inserted: data?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } }
  );
});

// ── helper
function isoToSeconds(iso?: string | null): number | null {
  if (!iso) return null;
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!match) return null;
  const [, h = "0", m = "0", s = "0"] = match;
  return (+h) * 3600 + (+m) * 60 + (+s);
}
