const CONFIG = window.STAC_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const THEME_KEY = "stac-theme";
const previewMode = new URLSearchParams(location.search).get("preview") === "1";

let supabaseClient = null;
let currentUser = null;
let myStreamers = [];
let allVideos = [];

if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.supabase) {
  supabaseClient = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_PUBLISHABLE_KEY,
  );
}

function idToEmail(id) {
  return `${id.toLowerCase()}@stac.local`;
}

function scheduledAt(video) {
  return video.scheduled_at || video.scheduled_start_at || video.published_at;
}

function platformOf(video) {
  const source = String(video.source || video.platform || "").toLowerCase();
  const url = String(video.url || "").toLowerCase();
  if (source.includes("twitch") || url.includes("twitch.tv")) return "twitch";
  if (
    source.includes("x") ||
    url.includes("x.com") ||
    url.includes("twitter.com")
  )
    return "x";
  return "youtube";
}

function platformMark(video) {
  const platform = platformOf(video);
  if (platform === "twitch")
    return '<span class="platform-mark twitch">T</span>';
  if (platform === "x")
    return '<span class="platform-mark" style="background:#111">X</span>';
  return '<span class="platform-mark">▶</span>';
}

function fmtClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function timeSlot(value) {
  const hour = new Date(value).getHours();
  if (hour < 6) return "00:00 - 06:00";
  if (hour < 12) return "06:00 - 12:00";
  if (hour < 18) return "12:00 - 18:00";
  return "18:00 - 00:00";
}

function openUrl(url, videoId = "") {
  let target = String(url || "").trim();

  if (!target && videoId) {
    target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  if (!target) return;

  window.open(target, "_blank", "noopener,noreferrer");
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "light" ? "#eceef2" : "#111214";
  const toggle = $("#themeToggle");
  if (toggle) toggle.textContent = next === "light" ? "ダーク" : "ライト";
  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeValue === next);
  });
}

applyTheme(currentTheme());

$("#themeToggle")?.addEventListener("click", () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
});

document.querySelectorAll("[data-theme-value]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeValue));
});

/* Auth */
function showAuthMessage(message) {
  const el = $("#authMessage");
  if (el) el.textContent = message || "";
}

async function login() {
  if (!supabaseClient)
    return showAuthMessage("Supabaseの設定を確認してください。");
  const id = $("#authId")?.value.trim();
  const password = $("#authPassword")?.value || "";
  if (!id || !password)
    return showAuthMessage("IDとパスワードを入力してください。");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: idToEmail(id),
      password,
    });
    if (error) throw error;
    currentUser = data.user;
    await startApp();
  } catch (error) {
    console.error(error);
    showAuthMessage(
      "ログインできませんでした。IDまたはパスワードを確認してください。",
    );
  }
}

async function signup() {
  if (!supabaseClient)
    return showAuthMessage("Supabaseの設定を確認してください。");
  const id = $("#authId")?.value.trim();
  const password = $("#authPassword")?.value || "";
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(id)) {
    return showAuthMessage("IDは3〜24文字の英数字・_・-で入力してください。");
  }
  if (password.length < 6)
    return showAuthMessage("パスワードは6文字以上にしてください。");
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: idToEmail(id),
      password,
      options: { data: { username: id } },
    });
    if (error) throw error;
    if (data.user) {
      currentUser = data.user;
      await startApp();
    }
  } catch (error) {
    console.error(error);
    const already = String(error.message || "")
      .toLowerCase()
      .includes("already registered");
    showAuthMessage(
      already
        ? "そのIDはすでに使われています。"
        : error.message || "作成できませんでした。",
    );
  }
}

async function startApp() {
  $("#authScreen")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
  const username =
    currentUser?.user_metadata?.username ||
    currentUser?.email?.split("@")[0] ||
    "---";
  if ($("#userName")) $("#userName").textContent = username;
  if ($("#userMark"))
    $("#userMark").textContent = username.charAt(0).toUpperCase();
  if ($("#settingsUserId")) $("#settingsUserId").textContent = username;
  applyTheme(currentTheme());
  await loadStreamers();
  await loadData();
}

async function loadStreamers() {
  if (!supabaseClient || !currentUser || previewMode) return;
  try {
    const { data, error } = await supabaseClient
      .from("user_streamers")
      .select(
        "streamer_id, enabled, streamers ( id, name, channel_id, thumbnail, enabled )",
      )
      .eq("user_id", currentUser.id)
      .eq("enabled", true);
    if (error) throw error;
    myStreamers = (data || [])
      .map((row) => row.streamers)
      .filter((streamer) => streamer && streamer.enabled !== false);
    renderStreamers();
  } catch (error) {
    console.error(error);
    const list = $("#myStreamers");
    if (list)
      list.innerHTML =
        '<div class="empty">ストリーマー情報を取得できませんでした。</div>';
  }
}

async function loadData() {
  if (previewMode) return;
  if (!supabaseClient || !currentUser) return;

  if (!myStreamers.length) {
    allVideos = [];
    renderAll();

    if ($("#lastSync")) {
      $("#lastSync").textContent = "ストリーマー未登録";
    }

    return;
  }

  try {
    const ids = myStreamers.map((streamer) => streamer.id);

    const { data, error } = await supabaseClient
      .from("videos")
      .select("*")
      .in("streamer_id", ids)
      .order("published_at", {
        ascending: false,
      })
      .limit(300);

    if (error) throw error;

    const streamerMap = new Map(
      myStreamers.map((streamer) => [streamer.id, streamer]),
    );

    allVideos = (data || []).map((video) => {
      const streamer = streamerMap.get(video.streamer_id);

      return {
        ...video,

        // videosテーブルにない情報を
        // streamersテーブルから補完
        streamer_name: streamer?.name || "不明なストリーマー",

        // DBにthumbnailがないので
        // YouTubeのvideo_idから直接生成
        thumbnail: video.video_id
          ? `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`
          : "",

        // DBにurlがないので生成
        url: video.video_id
          ? `https://www.youtube.com/watch?v=${video.video_id}`
          : "",
      };
    });

    renderAll();

    if ($("#lastSync")) {
      $("#lastSync").textContent = `最終確認 ${new Date().toLocaleTimeString(
        "ja-JP",
        {
          hour: "2-digit",
          minute: "2-digit",
        },
      )}`;
    }
  } catch (error) {
    console.error(error);

    if ($("#lastSync")) {
      $("#lastSync").textContent = "接続エラー";
    }
  }
}

function buckets() {
  const now = Date.now();

  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const live = allVideos.filter((video) => video.status === "live");

  const upcoming = allVideos
    .filter((video) => video.status === "upcoming")
    .sort((a, b) => new Date(scheduledAt(a)) - new Date(scheduledAt(b)));

  const latest = allVideos
    .filter((video) => {
      if (video.status !== "video" && video.status !== "archive") {
        return false;
      }

      const date = new Date(video.published_at || 0).getTime();

      return Number.isFinite(date) && date >= sevenDaysAgo;
    })
    .sort(
      (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
    );

  return {
    live,
    upcoming,
    latest,
  };
}

function liveCard(video) {
  return `
    <article
      class="live-card"
      data-url="${esc(video.url)}"
      data-video-id="${esc(video.video_id)}"
    >
      <div
        class="live-thumb"
        style="background-image:url('${esc(video.thumbnail || "")}')"
      >
        <span class="live-badge">LIVE</span>
        ${platformMark(video)}
      </div>

      <div class="live-body">
        <div class="live-streamer">${esc(video.streamer_name)}</div>
        <div class="live-title">${esc(video.title)}</div>
      </div>
    </article>
  `;
}

function schedCard(video) {
  const live = video.status === "live";

  return `
    <article
      class="sched-card${live ? " is-live" : ""}"
      data-url="${esc(video.url)}"
      data-video-id="${esc(video.video_id)}"
    >
      <div
        class="sched-thumb"
        style="background-image:url('${esc(video.thumbnail || "")}')"
      >
        <span class="sched-badge${live ? "" : " upcoming"}">
          ${live ? "LIVE" : "Upcoming"}
        </span>

        ${platformMark(video)}
      </div>

      <div class="sched-meta">
        <div class="sched-title">${esc(video.title)}</div>
        <div class="sched-name">${esc(video.streamer_name)}</div>
        <div class="sched-time">${esc(fmtClock(scheduledAt(video)))}〜</div>
      </div>
    </article>
  `;
}

function latestItem(video) {
  return `
    <article
      class="latest-item"
      data-url="${esc(video.url)}"
      data-video-id="${esc(video.video_id)}"
    >
      <div class="latest-thumb">
        ${
          video.thumbnail
            ? `<img src="${esc(video.thumbnail)}" alt="" loading="lazy">`
            : ""
        }
      </div>

      <div>
        <div class="latest-streamer">
          ${esc(video.streamer_name)}
        </div>

        <div class="latest-title">
          ${esc(video.title)}
        </div>
      </div>

      <div class="latest-date">
        ${esc(fmtDay(video.published_at))}
      </div>
    </article>
  `;
}

function renderLive(rows, selector) {
  const root = $(selector);
  if (!root) return;
  root.innerHTML = rows.length
    ? rows.map(liveCard).join("")
    : '<div class="empty" style="grid-column:1/-1">現在、配信中のストリーマーはいません。</div>';
  bindOpens(root);
}

function renderSchedule(rows, selector, limit = 0) {
  const root = $(selector);
  if (!root) return;
  const items = limit ? rows.slice(0, limit) : rows;
  if (!items.length) {
    root.innerHTML = '<div class="empty">配信予定はありません。</div>';
    return;
  }
  const byDay = new Map();
  for (const video of items) {
    const key = dayKey(scheduledAt(video));
    if (!byDay.has(key))
      byDay.set(key, { label: fmtDay(scheduledAt(video)), videos: [] });
    byDay.get(key).videos.push(video);
  }
  root.innerHTML = [...byDay.values()]
    .map((day) => {
      const slots = new Map();
      for (const video of day.videos) {
        const slot = timeSlot(scheduledAt(video));
        if (!slots.has(slot)) slots.set(slot, []);
        slots.get(slot).push(video);
      }
      const slotHtml = [...slots.entries()]
        .map(
          ([slot, videos]) => `
            <div class="schedule-slot">
              <div class="schedule-slot-head">${esc(slot)}</div>
              <div class="schedule-cards">${videos.map(schedCard).join("")}</div>
            </div>
          `,
        )
        .join("");
      return `<section><div class="schedule-day-head">${esc(day.label)}</div>${slotHtml}</section>`;
    })
    .join("");
  bindOpens(root);
}

function renderLatest(rows, selector, limit = 8) {
  const root = $(selector);
  if (!root) return;
  const items = rows.slice(0, limit);
  root.innerHTML = items.length
    ? items.map(latestItem).join("")
    : '<div class="empty">まだ最新情報がありません。</div>';
  bindOpens(root);
}

function bindOpens(root) {
  root.querySelectorAll("[data-url]").forEach((el) => {
    el.addEventListener("click", () => {
      openUrl(el.dataset.url, el.dataset.videoId || "");
    });
  });
}

function renderStreamers() {
  const list = $("#myStreamers");
  if (!list) return;
  if (!myStreamers.length) {
    list.innerHTML =
      '<div class="empty">登録中のストリーマーはいません。</div>';
    return;
  }
  list.innerHTML = myStreamers
    .map(
      (streamer) => `
        <div class="streamer-row">
          <div class="streamer-main">
            <div class="streamer-avatar">${streamer.thumbnail ? `<img src="${esc(streamer.thumbnail)}" alt="" loading="lazy">` : ""}</div>
            <div>${esc(streamer.name)}</div>
          </div>
          <button class="streamer-action" type="button" data-remove="${esc(streamer.id)}">削除</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () =>
      removeStreamer(button.dataset.remove),
    );
  });
}

function renderAll() {
  const { live, upcoming, latest } = buckets();
  renderLive(live, "#liveList");
  renderLive(live, "#livePageList");
  renderSchedule(
    [...live, ...upcoming].sort(
      (a, b) => new Date(scheduledAt(a)) - new Date(scheduledAt(b)),
    ),
    "#upcomingList",
    8,
  );
  renderSchedule(upcoming, "#upcomingPageList");
  renderLatest(latest, "#latestList", 8);
  renderLatest(latest, "#latestPageList", 80);
}

async function requestAddStreamer(url) {
  const value = String(url || "").trim();
  const message = $("#addStreamerMessage");
  const button = $("#addStreamerButton");
  if (!value) {
    if (message)
      message.textContent =
        "YouTube / Twitch のURL、または @ハンドルを入力してください。";
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "追加中…";
  }
  if (message) message.textContent = "";
  try {
    const functionUrl = CONFIG.ADD_STREAMER_FUNCTION_URL;
    if (!functionUrl || !supabaseClient)
      throw new Error("追加用の設定がありません。");
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({ url: value }),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
    if (!response.ok) throw new Error(payload.error || payload.message || text);
    if (payload.success === false)
      throw new Error(payload.message || "追加できませんでした。");
    if ($("#streamerUrl")) $("#streamerUrl").value = "";
    if (message) {
      message.style.color = "var(--text-muted)";
      message.textContent = `${payload.streamer?.name || payload.name || "ストリーマー"}を追加しました。`;
    }
    await loadStreamers();
    await loadData();
  } catch (error) {
    console.error(error);
    if (message) {
      message.style.color = "var(--live)";
      message.textContent =
        error.message || "ストリーマーを追加できませんでした。";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "追加";
    }
  }
}

async function removeStreamer(streamerId) {
  if (!supabaseClient || !currentUser || !streamerId) return;
  try {
    const { error } = await supabaseClient
      .from("user_streamers")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("streamer_id", streamerId);
    if (error) throw error;
    await loadStreamers();
    await loadData();
  } catch (error) {
    alert(error.message || "削除できませんでした。");
  }
}

function setView(view) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `${view}View`);
  });
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  closeMobile();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach((el) => {
  el.addEventListener("click", () => setView(el.dataset.view));
});

const sidebar = $("#sidebar");
$("#collapseMenu")?.addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("collapsed");
  document
    .querySelector(".main")
    ?.classList.toggle("sidebar-collapsed", collapsed);
  $("#collapseMenu").textContent = collapsed ? "›" : "‹";
});

function openMobile() {
  sidebar?.classList.add("open");
  $("#sidebarOverlay")?.classList.add("show");
}

function closeMobile() {
  sidebar?.classList.remove("open");
  $("#sidebarOverlay")?.classList.remove("show");
}

$("#mobileMenu")?.addEventListener("click", openMobile);
$("#sidebarOverlay")?.addEventListener("click", closeMobile);

function updateClock() {
  const clock = $("#clock");
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

updateClock();
setInterval(updateClock, 1000);

$("#logoutButton")?.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  location.reload();
});

$("#loginButton")?.addEventListener("click", login);
$("#signupButton")?.addEventListener("click", signup);
$("#authPassword")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
$("#addStreamerButton")?.addEventListener("click", () =>
  requestAddStreamer($("#streamerUrl")?.value),
);
$("#streamerUrl")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    requestAddStreamer($("#streamerUrl").value);
  }
});

function startPreview() {
  currentUser = { id: "preview-user", user_metadata: { username: "preview" } };
  $("#authScreen")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
  $("#userName").textContent = "preview";
  $("#userMark").textContent = "P";
  $("#settingsUserId").textContent = "preview";
  myStreamers = [
    { id: "a", name: "夜乃くろむ", thumbnail: "" },
    { id: "b", name: "藍沢エマ", thumbnail: "" },
  ];
  const hour = (n) => new Date(Date.now() + n * 60 * 60 * 1000).toISOString();
  allVideos = [
    {
      status: "live",
      streamer_name: "夜乃くろむ",
      title: "【雑談】ゆっくりおはなし",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      url: "https://www.youtube.com/",
      scheduled_at: hour(-1),
      source: "youtube",
    },
    {
      status: "live",
      streamer_name: "藍沢エマ",
      title: "【ARK】今夜もサバイバル",
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg",
      url: "https://www.twitch.tv/",
      scheduled_at: hour(-2),
      source: "twitch",
    },
    {
      status: "upcoming",
      streamer_name: "夜乃くろむ",
      title: "【配信予定】夜の雑談配信",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      url: "https://www.youtube.com/",
      scheduled_at: hour(2),
      source: "youtube",
    },
    {
      status: "upcoming",
      streamer_name: "藍沢エマ",
      title: "【Apex Legends】ランクやります",
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg",
      url: "https://www.twitch.tv/",
      scheduled_at: hour(5),
      source: "twitch",
    },
    {
      status: "video",
      streamer_name: "夜乃くろむ",
      title: "【切り抜き】最近あったことを話す",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: hour(-6),
    },
    {
      status: "archive",
      streamer_name: "藍沢エマ",
      title: "【アーカイブ】昨日の配信",
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: hour(-20),
    },
  ];
  renderStreamers();
  renderAll();
  if ($("#lastSync")) $("#lastSync").textContent = "デザインプレビュー";
}

async function init() {
  if (previewMode) {
    startPreview();
    return;
  }
  if (!supabaseClient) {
    showAuthMessage("Supabaseの設定が読み込めていません。");
    return;
  }
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await startApp();
  }
}

setInterval(async () => {
  if (!previewMode && currentUser && !$("#app")?.classList.contains("hidden")) {
    await loadStreamers();
    await loadData();
  }
}, 60000);

init();
