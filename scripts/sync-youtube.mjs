import { XMLParser } from "fast-xml-parser";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !YOUTUBE_API_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / YOUTUBE_API_KEY",
  );
}

const SUPABASE_REST = `${SUPABASE_URL}/rest/v1`;

const SUPABASE_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

const youtubeParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// ==================================================
// 設定
// ==================================================

const VIDEO_RETENTION_DAYS = 7;

const VIDEO_RETENTION_MS = VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ==================================================
// Supabase
// ==================================================

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_REST}${path}`, {
    ...options,
    headers: {
      ...SUPABASE_HEADERS,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

// ==================================================
// YouTube RSS
// ==================================================

async function getRSS(channelId) {
  const url =
    `https://www.youtube.com/feeds/videos.xml?channel_id=` +
    encodeURIComponent(channelId);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`YouTube RSS ${response.status}`);
  }

  const xml = await response.text();

  const parsed = youtubeParser.parse(xml);

  return toArray(parsed?.feed?.entry);
}

// ==================================================
// 配列化
// ==================================================

function toArray(value) {
  if (!value) return [];

  return Array.isArray(value) ? value : [value];
}

// ==================================================
// YouTube videos.list
//
// Search APIは使用しない
// ==================================================

async function getVideoDetails(videoIds) {
  const result = new Map();

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);

    if (!batch.length) {
      continue;
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");

    url.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");

    url.searchParams.set("id", batch.join(","));

    url.searchParams.set("key", YOUTUBE_API_KEY);

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `YouTube API ${response.status}: ${JSON.stringify(data)}`,
      );
    }

    for (const video of data.items || []) {
      result.set(video.id, video);
    }
  }

  return result;
}

// ==================================================
// 配信状態判定
// ==================================================

function getStatus(video) {
  const live = video.liveStreamingDetails || {};

  // 現在配信中
  if (live.actualStartTime && !live.actualEndTime) {
    return "live";
  }

  // 配信予定
  if (live.scheduledStartTime && !live.actualStartTime && !live.actualEndTime) {
    return "upcoming";
  }

  // 配信終了
  if (live.actualEndTime) {
    return "archive";
  }

  // 通常動画
  return "video";
}

// ==================================================
// ISO 8601 duration → 秒
// ==================================================

function durationToSeconds(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1] || 0);

  const minutes = Number(match[2] || 0);

  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

// ==================================================
// 7日以内か判定
//
// LIVE / UPCOMING は別扱いで必ず保存。
// 通常動画は publishedAt。
// 終了配信は actualStartTime を基準にする。
// ==================================================

function isWithinSevenDays(video, status) {
  // 現在配信中
  if (status === "live") {
    return true;
  }

  // 配信予定
  if (status === "upcoming") {
    return true;
  }

  const live = video.liveStreamingDetails || {};

  const snippet = video.snippet || {};

  let baseTime = null;

  if (status === "archive") {
    // 終了配信は配信開始日時を基準
    baseTime = live.actualStartTime || snippet.publishedAt || null;
  } else {
    // 通常動画は公開日時を基準
    baseTime = snippet.publishedAt || null;
  }

  if (!baseTime) {
    return false;
  }

  const timestamp = new Date(baseTime).getTime();

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const age = Date.now() - timestamp;

  return age >= 0 && age <= VIDEO_RETENTION_MS;
}

// ==================================================
// メイン
// ==================================================

async function main() {
  console.log("========================================");

  console.log("STAC YouTube Sync 開始");

  console.log("========================================");

  console.log("Supabase URL:", SUPABASE_URL.replace(/^https?:\/\//, ""));

  console.log(`保存対象期間: ${VIDEO_RETENTION_DAYS}日`);

  // ------------------------------------------------
  // ストリーマー取得
  // ------------------------------------------------

  const streamers = await supabase(
    "/streamers?select=id,name,channel_id&enabled=eq.true",
  );

  console.log(`ストリーマー数: ${streamers.length}`);

  if (!streamers.length) {
    console.log("有効なストリーマーがありません。");

    return;
  }

  // ------------------------------------------------
  // RSS取得
  // ------------------------------------------------

  const rawEntries = [];

  for (const streamer of streamers) {
    try {
      console.log("");
      console.log(`[${streamer.name}] RSS取得開始`);

      const entries = await getRSS(streamer.channel_id);

      console.log(`[${streamer.name}] RSS取得完了: ${entries.length}件`);

      for (const entry of entries) {
        rawEntries.push({
          streamer,
          entry,
        });
      }
    } catch (error) {
      console.error(`[${streamer.name}] RSS取得失敗:`, error.message);
    }
  }

  // ------------------------------------------------
  // Video ID一覧
  // ------------------------------------------------

  const videoIds = [
    ...new Set(
      rawEntries.map(({ entry }) => entry["yt:videoId"]).filter(Boolean),
    ),
  ];

  console.log("");
  console.log(`YouTube動画ID数: ${videoIds.length}`);

  // ------------------------------------------------
  // YouTube API詳細取得
  // ------------------------------------------------

  let videoMap = new Map();

  if (videoIds.length) {
    try {
      videoMap = await getVideoDetails(videoIds);

      console.log(`YouTube詳細取得: ${videoMap.size}件`);
    } catch (error) {
      console.error("YouTube詳細取得失敗:", error.message);
    }
  }

  // ------------------------------------------------
  // Supabase保存用データ
  // ------------------------------------------------

  const rows = [];

  let liveCount = 0;
  let upcomingCount = 0;
  let videoCount = 0;
  let archiveCount = 0;
  let skippedOldCount = 0;

  for (const { streamer, entry } of rawEntries) {
    const videoId = entry["yt:videoId"];

    if (!videoId) {
      continue;
    }

    const video = videoMap.get(videoId);

    if (!video) {
      continue;
    }

    const live = video.liveStreamingDetails || {};

    const snippet = video.snippet || {};

    const currentStatus = getStatus(video);

    // ------------------------------------------------
    // 7日制限
    // ------------------------------------------------

    if (!isWithinSevenDays(video, currentStatus)) {
      skippedOldCount++;

      console.log(
        `⏭️ SKIP OLD  ${streamer.name} | ${videoId} | ${snippet.title || entry.title || "無題"}`,
      );

      continue;
    }

    // ------------------------------------------------
    // 現在の videos テーブルに存在する列だけ
    // ------------------------------------------------

    const thumbnail =
      snippet.thumbnails?.maxres?.url ??
      snippet.thumbnails?.standard?.url ??
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url ??
      null;

    const row = {
      video_id: videoId,

      thumbnail: thumbnail,

      streamer_id: streamer.id,

      status: currentStatus,

      title: snippet.title || entry.title || "無題",

      description: snippet.description || null,

      published_at: snippet.publishedAt || entry.published || null,

      scheduled_at: live.scheduledStartTime || null,

      actual_start_at: live.actualStartTime || null,

      actual_end_at: live.actualEndTime || null,

      duration: durationToSeconds(video.contentDetails?.duration),
    };

    rows.push(row);

    // ------------------------------------------------
    // ログ
    // ------------------------------------------------

    if (currentStatus === "live") {
      liveCount++;

      console.log(`🔴 LIVE  ${streamer.name} | ${videoId} | ${row.title}`);
    } else if (currentStatus === "upcoming") {
      upcomingCount++;

      console.log(`🟡 UPCOMING  ${streamer.name} | ${videoId} | ${row.title}`);
    } else if (currentStatus === "archive") {
      archiveCount++;
    } else {
      videoCount++;
    }
  }

  // ------------------------------------------------
  // Supabase UPSERT
  // ------------------------------------------------

  if (rows.length) {
    try {
      console.log("");
      console.log(`Supabase保存開始: ${rows.length}件`);

      const response = await fetch(
        `${SUPABASE_REST}/videos?on_conflict=video_id`,
        {
          method: "POST",

          headers: {
            ...SUPABASE_HEADERS,

            "Content-Type": "application/json",

            Prefer: "resolution=merge-duplicates,return=minimal",
          },

          body: JSON.stringify(rows),
        },
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Supabase UPSERT ${response.status}: ${text}`);
      }

      console.log(`Supabase保存成功: ${rows.length}件`);
    } catch (error) {
      console.error("Supabase UPSERT失敗:", error.message);

      throw error;
    }
  } else {
    console.log("");
    console.log("保存対象の動画はありません。");
  }

  // ------------------------------------------------
  // 結果
  // ------------------------------------------------

  console.log("");

  console.log("========================================");

  console.log("STAC YouTube Sync 完了");

  console.log("========================================");

  console.log(`RSS取得動画: ${rawEntries.length}`);

  console.log(`詳細取得動画: ${videoMap.size}`);

  console.log(`保存対象: ${rows.length}`);

  console.log(`LIVE: ${liveCount}`);

  console.log(`UPCOMING: ${upcomingCount}`);

  console.log(`通常動画: ${videoCount}`);

  console.log(`ARCHIVE: ${archiveCount}`);

  console.log(`古い動画として除外: ${skippedOldCount}`);

  console.log("========================================");
}

// ==================================================
// 実行
// ==================================================

main().catch((error) => {
  console.error("");

  console.error("STAC YouTube Sync 致命的エラー");

  console.error(error);

  process.exit(1);
});
