
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parse } from 'https://deno.land/std@0.168.0/encoding/csv.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface YouTubeVideo {
  id: string
  snippet: {
    channelId: string
    publishedAt: string
    title: string
  }
  statistics: {
    viewCount: string
  }
  contentDetails: {
    duration: string
  }
}

interface TrendingRow {
  video_id: string
  trending_date: string
  categoryId: string
  [key: string]: string
}

// Helper function to convert ISO 8601 duration to seconds
function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  
  return hours * 3600 + minutes * 60 + seconds
}

// Helper function to get yesterday's date in YYYY-MM-DD format
function getYesterdayDate(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}

// Helper function to batch array into chunks
function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize))
  }
  return batches
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🚀 Starting seedTrending function')
    
    // Get environment variables
    const ytApiKey = Deno.env.get('YT_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!ytApiKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables')
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Step 1: Fetch CSV data
    console.log('📥 Fetching CSV data from Google Cloud Storage')
    const csvResponse = await fetch('https://storage.googleapis.com/yb-datasets-us-trending/US_youtube_trending_data.csv')
    if (!csvResponse.ok) {
      throw new Error(`Failed to fetch CSV: ${csvResponse.status} ${csvResponse.statusText}`)
    }
    
    const csvText = await csvResponse.text()
    const csvData = parse(csvText, { skipFirstRow: true }) as TrendingRow[]
    
    // Step 2: Filter for yesterday's music videos
    const yesterdayDate = getYesterdayDate()
    console.log(`🎵 Filtering for music videos from ${yesterdayDate}`)
    
    const musicVideos = csvData.filter(row => 
      row.trending_date === yesterdayDate && 
      row.categoryId === '10'
    )
    
    console.log(`Found ${musicVideos.length} music videos from yesterday`)
    
    // Step 3: Deduplicate video IDs
    const uniqueVideoIds = [...new Set(musicVideos.map(row => row.video_id))]
    console.log(`Unique video IDs: ${uniqueVideoIds.length}`)
    
    if (uniqueVideoIds.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, skipped: 0, message: 'No videos found for yesterday' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Step 4: Batch video IDs and fetch from YouTube API
    const batches = batchArray(uniqueVideoIds, 50)
    let totalInserted = 0
    let totalSkipped = 0
    
    console.log(`📊 Processing ${batches.length} batches of video IDs`)
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} videos)`)
      
      // Fetch video details from YouTube API
      const ytUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
      ytUrl.searchParams.set('part', 'snippet,statistics,contentDetails')
      ytUrl.searchParams.set('id', batch.join(','))
      ytUrl.searchParams.set('key', ytApiKey)
      
      const ytResponse = await fetch(ytUrl.toString())
      if (!ytResponse.ok) {
        console.error(`YouTube API error for batch ${i + 1}: ${ytResponse.status} ${ytResponse.statusText}`)
        continue
      }
      
      const ytData = await ytResponse.json()
      const videos: YouTubeVideo[] = ytData.items || []
      
      console.log(`YouTube API returned ${videos.length} videos for batch ${i + 1}`)
      
      // Step 5: Upsert videos into database
      for (const video of videos) {
        try {
          const duration = parseISO8601Duration(video.contentDetails.duration)
          const initViews = parseInt(video.statistics.viewCount || '0', 10)
          
          const { error } = await supabase
            .from('videos')
            .upsert({
              youtube_id: video.id,
              channel_id: video.snippet.channelId,
              publish_time: video.snippet.publishedAt,
              title: video.snippet.title,
              duration: duration,
              init_views: initViews,
              created_at: new Date().toISOString()
            }, {
              onConflict: 'youtube_id',
              ignoreDuplicates: true
            })
          
          if (error) {
            console.error(`Error upserting video ${video.id}:`, error)
            totalSkipped++
          } else {
            totalInserted++
          }
          
        } catch (error) {
          console.error(`Error processing video ${video.id}:`, error)
          totalSkipped++
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    
    const result = {
      inserted: totalInserted,
      skipped: totalSkipped,
      date: yesterdayDate,
      totalProcessed: uniqueVideoIds.length
    }
    
    console.log('✅ Seeding completed:', result)
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('❌ Error in seedTrending function:', error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        inserted: 0,
        skipped: 0
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
