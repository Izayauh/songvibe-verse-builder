
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get("YT_API_KEY");
    if (!apiKey) {
      throw new Error("YT_API_KEY environment variable is required");
    }

    console.log("Fetching trending videos from YouTube API...");

    // Fetch directly from YouTube API using fetch
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=US&videoCategoryId=10&maxResults=50&key=${apiKey}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("YouTube API error:", errorText);
      throw new Error(`YouTube API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.items?.length) {
      console.log("No items returned from YouTube API");
      return new Response(
        JSON.stringify({ error: "No items returned", count: 0 }),
        { 
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`Retrieved ${data.items.length} videos from YouTube`);

    // Build rows for database insertion
    const rows = data.items.map((item: any) => ({
      youtube_id: item.id,
      channel_id: item.snippet?.channelId || null,
      publish_time: item.snippet?.publishedAt
        ? new Date(item.snippet.publishedAt).toISOString()
        : null,
      title: item.snippet?.title || "",
      duration: isoToSeconds(item.contentDetails?.duration),
      init_views: Number(item.statistics?.viewCount || 0),
      created_at: new Date().toISOString(),
    }));

    console.log("Upserting videos to database...");

    // Upsert into videos table
    const { data: upsertData, error } = await supabase
      .from("videos")
      .upsert(rows, { onConflict: "youtube_id" });

    if (error) {
      console.error("DB upsert error:", error.message);
      return new Response(
        JSON.stringify({ error: error.message }), 
        { 
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`Successfully processed ${rows.length} videos`);

    return new Response(
      JSON.stringify({ 
        success: true,
        processed: rows.length,
        message: `Successfully processed ${rows.length} trending videos`
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Function error:", error.message);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

// Helper function to convert ISO 8601 duration to seconds
function isoToSeconds(iso?: string | null): number | null {
  if (!iso) return null;
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!match) return null;
  const [, h = "0", m = "0", s = "0"] = match;
  return (+h) * 3600 + (+m) * 60 + (+s);
}
