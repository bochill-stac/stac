import { XMLParser } from "fast-xml-parser";

function required(k) {
  if (!process.env[k]) {
    throw new Error(`${k} が未設定です`);
  }
  return process.env[k];
}

const env = {
  supabaseUrl: required("SUPABASE_URL"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  youtubeApiKey: required("YOUTUBE_API_KEY"),
};

const parser = new XMLParser({
  removeNSPrefix: true,
});

const iso = (v) => {
  if (!v) return null;

  const d = new Date(v);

  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const hms = (v) => {
  const m = String(v || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);

  if (!m) return "";

  return [m?.[1] || 0, m?.[2] || 0, m?.[3] || 0]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
};

/* =========================================================
   Supabase
========================================================= */

async function supabaseGet(path, params = {}) {
  const u = new URL(`${env.supabaseUrl}/rest/v1/${path}`);

  for (const [key, value] of Object.entries(params)) {
    u.searchParams.set(key, value);
  }

  const r = await fetch(u, {
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
  });

  if (!r.ok) {
    throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  }

  return r.json();
}

/* =========================================================
   登録ストリーマー取得
========================================================= */

async function getStreamers() {
  return supabaseGet("streamers", {
    select: "id,name,channel_id",
    enabled: "eq.true",
    order: "created_at.asc",
  });
}

/* =========================================================
   YouTube RSS
   ※ RSSはYouTube Data APIのQuotaを消費しない
========================================================= */

async function rss(channelId) {
  const r = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    {
      headers: {
        "User-Agent": "STAC/1.0",
      },
    },
  );

  if (!r.ok) {
    throw new Error(`RSS ${r.status}`);
  }

  const x = parser.parse(await r.text());

  const e = x.feed?.entry;
  const a = Array.isArray(e) ? e : e ? [e] : [];

  return a
    .slice(0, 5)
    .map((v) => ({
      videoId: v.videoId,
      title: v.title || "",
      publishedAt: iso(v.published),
      updatedAt: iso(v.updated),
      description: v.group?.description || "",
    }))
    .filter((v) => v.videoId);
}

/* =========================================================
   既存動画取得
========================================================= */

async function dbGet(ids) {
  if (!ids.length) {
    return [];
  }

  return supabaseGet("videos", {
    select: "video_id,status",
    video_id: `in.(${ids.join(",")})`,
  });
}

/* =========================================================
   YouTube Data API
   videos.list は1回につき1 quota
========================================================= */

async function yt(ids) {
  if (!ids.length) {
    return [];
  }

  const u = new URL("https://www.googleapis.com/youtube/v3/videos");

  u.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");

  u.searchParams.set("id", ids.join(","));

  u.searchParams.set("key", env.youtubeApiKey);

  const r = await fetch(u);

  if (!r.ok) {
    throw new Error(`YouTube API ${r.status}: ${await r.text()}`);
  }

  const data = await r.json();

  return data.items || [];
}

/* =========================================================
   ステータス判定
========================================================= */

function status(i) {
  const broadcast = i.snippet?.liveBroadcastContent || "none";

  const live = i.liveStreamingDetails;

  if (broadcast === "live") {
    return "live";
  }

  if (broadcast === "upcoming") {
    return "upcoming";
  }

  if (live) {
    return live.actualEndTime ? "archive" : "canceled";
  }

  return "video";
}

/* =========================================================
   Supabase保存用データ
========================================================= */

function row(i, rssItem, streamer) {
  const s = status(i);

  const thumbnails = i.snippet?.thumbnails || {};

  const live = i.liveStreamingDetails || {};

  return {
    video_id: i.id,

    streamer_id: streamer.id,
    streamer_name: streamer.name,

    status: s,

    title: i.snippet?.title || rssItem.title || "",

    description: i.snippet?.description || rssItem.description || "",

    published_at: iso(i.snippet?.publishedAt || rssItem.publishedAt),

    scheduled_at: iso(live.scheduledStartTime),

    actual_start_at: ["live", "archive"].includes(s)
      ? iso(live.actualStartTime)
      : null,

    duration: hms(i.contentDetails?.duration),

    thumbnail:
      thumbnails.maxres?.url ||
      thumbnails.standard?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      "",

    url: `https://www.youtube.com/watch?v=${i.id}`,

    updated_at: new Date().toISOString(),
  };
}

/* =========================================================
   Upsert
========================================================= */

async function upsert(rows) {
  if (!rows.length) {
    return;
  }

  const r = await fetch(
    `${env.supabaseUrl}/rest/v1/videos?on_conflict=video_id`,
    {
      method: "POST",

      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,

        "Content-Type": "application/json",

        Prefer: "resolution=merge-duplicates,return=minimal",
      },

      body: JSON.stringify(rows),
    },
  );

  if (!r.ok) {
    throw new Error(`Supabase UPSERT ${r.status}: ${await r.text()}`);
  }
}

/* =========================================================
   1ストリーマー同期
========================================================= */

async function syncStreamer(streamer) {
  console.log(`\n[${streamer.name}] RSS取得開始`);

  const feed = await rss(streamer.channel_id);

  if (!feed.length) {
    console.log(`[${streamer.name}] RSSにデータなし`);

    return {
      rss: 0,
      api: 0,
      saved: 0,
    };
  }

  const old = await dbGet(feed.map((x) => x.videoId));

  const map = new Map(old.map((x) => [x.video_id, x]));

  /*
   * APIを使う条件
   *
   * 1. DBに存在しない → 新しい動画
   * 2. upcoming → 配信開始などで状態が変わる可能性あり
   * 3. live → 配信終了を検知する必要あり
   *
   * archive / video は基本的に再取得しない
   * → YouTube API quota節約
   */
  const candidates = feed.filter((x) => {
    const existing = map.get(x.videoId);

    if (!existing) {
      return true;
    }

    if (existing.status === "upcoming" || existing.status === "live") {
      return true;
    }

    return false;
  });

  const items = await yt(candidates.map((x) => x.videoId));

  const itemMap = new Map(items.map((x) => [x.id, x]));

  const rows = candidates
    .map((x) => {
      const item = itemMap.get(x.videoId);

      if (!item) {
        return null;
      }

      return row(item, x, streamer);
    })
    .filter(Boolean);

  await upsert(rows);

  console.log(
    `[${streamer.name}] RSS=${feed.length} API=${candidates.length} 保存=${rows.length}`,
  );

  return {
    rss: feed.length,
    api: candidates.length,
    saved: rows.length,
  };
}

/* =========================================================
   メイン
========================================================= */

async function main() {
  console.log("STAC YouTube Sync 開始");

  const streamers = await getStreamers();

  if (!streamers.length) {
    console.log("有効なストリーマーがありません");

    return;
  }

  console.log(`ストリーマー数: ${streamers.length}`);

  let totalRss = 0;
  let totalApi = 0;
  let totalSaved = 0;

  for (const streamer of streamers) {
    try {
      const result = await syncStreamer(streamer);

      totalRss += result.rss;
      totalApi += result.api;
      totalSaved += result.saved;
    } catch (e) {
      console.error(`[${streamer.name}] 同期失敗:`, e);

      /*
       * 1人のストリーマーで失敗しても
       * 他のストリーマーは続行
       */
    }
  }

  console.log(
    `\nSTAC YouTube Sync 完了 RSS=${totalRss} API=${totalApi} 保存=${totalSaved}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
