const CONFIG = window.STAC_CONFIG || {};

const $ = (selector) => document.querySelector(selector);

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

/* =========================
   SUPABASE
========================= */

let supabaseClient = null;
let currentUser = null;

if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.supabase) {
  supabaseClient = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_PUBLISHABLE_KEY,
  );
}

/* =========================
   DATA
========================= */

let myStreamers = [];
let allStreamers = [];

let allVideos = [];

let liveRows = [];
let upcomingRows = [];
let latestRows = [];

/* =========================
   HELPERS
========================= */

function idToEmail(id) {
  return `${id.toLowerCase()}@stac.local`;
}

function fmtDate(value) {
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

function fmtTime(value) {
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "--:--";

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function openUrl(url) {
  if (!url) return;

  window.open(url, "_blank", "noopener,noreferrer");
}

/* =========================
   AUTH UI
========================= */

function showAuthMessage(message) {
  const el = $("#authMessage");

  if (el) {
    el.textContent = message || "";
  }
}

function setAuthLoading(loading) {
  const login = $("#loginButton");
  const signup = $("#signupButton");

  if (login) {
    login.disabled = loading;
    login.textContent = loading ? "処理中…" : "ログイン";
  }

  if (signup) {
    signup.disabled = loading;
  }
}

/* =========================
   LOGIN
========================= */

async function login() {
  if (!supabaseClient) {
    showAuthMessage("Supabaseの設定を確認してください。");
    return;
  }

  const id = $("#authId").value.trim();
  const password = $("#authPassword").value;

  if (!id || !password) {
    showAuthMessage("IDとパスワードを入力してください。");
    return;
  }

  setAuthLoading(true);
  showAuthMessage("");

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: idToEmail(id),
      password,
    });

    if (error) {
      throw error;
    }

    currentUser = data.user;

    await startApp();
  } catch (error) {
    console.error(error);

    showAuthMessage(
      "ログインできませんでした。IDまたはパスワードを確認してください。",
    );
  } finally {
    setAuthLoading(false);
  }
}

/* =========================
   SIGN UP
========================= */

async function signup() {
  if (!supabaseClient) {
    showAuthMessage("Supabaseの設定を確認してください。");
    return;
  }

  const id = $("#authId").value.trim();
  const password = $("#authPassword").value;

  console.log("SIGNUP ID:", JSON.stringify(id));
  console.log("SIGNUP PASSWORD LENGTH:", password.length);

  if (!id || !password) {
    showAuthMessage("IDとパスワードを入力してください。");
    return;
  }

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(id)) {
    showAuthMessage("IDは3〜24文字の英数字・_・-で入力してください。");
    return;
  }

  if (password.length < 6) {
    showAuthMessage("パスワードは6文字以上にしてください。");
    return;
  }

  setAuthLoading(true);
  showAuthMessage("");

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: idToEmail(id),
      password,

      options: {
        data: {
          username: id,
        },
      },
    });

    if (error) {
      throw error;
    }

    if (data.user) {
      currentUser = data.user;

      showAuthMessage("");

      await startApp();
    }
  } catch (error) {
    console.error(error);

    if (
      String(error.message || "")
        .toLowerCase()
        .includes("already registered")
    ) {
      showAuthMessage("そのIDはすでに使われています。");
    } else {
      showAuthMessage("アカウントを作成できませんでした。");
    }
  } finally {
    setAuthLoading(false);
  }
}

/* =========================
   START APP
========================= */

async function startApp() {
  $("#authScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  const username =
    currentUser?.user_metadata?.username ||
    currentUser?.email?.split("@")[0] ||
    "---";

  $("#userName").textContent = username;
  $("#userMark").textContent = username.charAt(0).toUpperCase();

  $("#settingsUserId").textContent = username;

  await loadStreamers();
  await loadData();
}

/* =========================
   STREAMERS
========================= */

async function loadStreamers() {
  if (!supabaseClient || !currentUser) return;

  try {
    const { data, error } = await supabaseClient
      .from("user_streamers")
      .select(
        `
          streamer_id,
          enabled,
          streamers (
            id,
            name,
            channel_id,
            thumbnail,
            enabled
          )
        `,
      )
      .eq("user_id", currentUser.id)
      .eq("enabled", true);

    if (error) throw error;

    myStreamers = (data || []).map((row) => row.streamers).filter(Boolean);

    const { data: allData, error: allError } = await supabaseClient
      .from("streamers")
      .select("*")
      .eq("enabled", true)
      .order("name");

    if (allError) throw allError;

    allStreamers = allData || [];

    renderStreamers();
  } catch (error) {
    console.error("streamer load error:", error);

    $("#myStreamers").innerHTML =
      `<div class="empty">ストリーマー情報を取得できませんでした。</div>`;
  }
}

/* =========================
   ADD STREAMER
========================= */

async function addStreamer(streamerId) {
  if (!currentUser) return;

  try {
    const { error } = await supabaseClient.from("user_streamers").insert({
      user_id: currentUser.id,
      streamer_id: streamerId,
      enabled: true,
    });

    if (error) throw error;

    await loadStreamers();
    await loadData();
  } catch (error) {
    console.error(error);

    alert("ストリーマーを追加できませんでした。");
  }
}

/* =========================
   REMOVE STREAMER
========================= */

async function removeStreamer(streamerId) {
  if (!currentUser) return;

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
    console.error(error);

    alert("ストリーマーを削除できませんでした。");
  }
}

/* =========================
   RENDER STREAMERS
========================= */

function streamerRow(streamer, action) {
  return `
    <div class="streamer-row">

      <div class="streamer-main">

        <div class="streamer-avatar">

          ${
            streamer.thumbnail
              ? `<img
                  src="${esc(streamer.thumbnail)}"
                  alt=""
                >`
              : ""
          }

        </div>

        <div class="streamer-name">
          ${esc(streamer.name)}
        </div>

      </div>

      <button
        class="streamer-action"
        data-streamer-action="${action}"
        data-streamer-id="${esc(streamer.id)}"
      >
        ${action === "add" ? "追加" : "削除"}
      </button>

    </div>
  `;
}

function renderStreamers() {
  const mine = $("#myStreamers");
  const available = $("#availableStreamers");

  if (!myStreamers.length) {
    mine.innerHTML = `
      <div class="empty">
        まだストリーマーが登録されていません。
      </div>
    `;
  } else {
    mine.innerHTML = myStreamers.map((s) => streamerRow(s, "remove")).join("");
  }

  const myIds = new Set(myStreamers.map((s) => s.id));

  const notAdded = allStreamers.filter((s) => !myIds.has(s.id));

  if (!notAdded.length) {
    available.innerHTML = `
      <div class="empty">
        追加できるストリーマーはありません。
      </div>
    `;
  } else {
    available.innerHTML = notAdded.map((s) => streamerRow(s, "add")).join("");
  }

  document.querySelectorAll("[data-streamer-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.streamerId;

      if (button.dataset.streamerAction === "add") {
        addStreamer(id);
      } else {
        removeStreamer(id);
      }
    });
  });
}

/* =========================
   VIDEO DATA
========================= */

async function loadData() {
  if (!supabaseClient || !currentUser) return;

  if (!myStreamers.length) {
    liveRows = [];
    upcomingRows = [];
    latestRows = [];

    renderAll();

    $("#lastSync").textContent = "ストリーマー未登録";

    return;
  }

  try {
    const ids = myStreamers.map((s) => s.id);

    const { data, error } = await supabaseClient
      .from("videos")
      .select("*")
      .in("streamer_id", ids)
      .order("published_at", {
        ascending: false,
      })
      .limit(200);

    if (error) throw error;

    allVideos = data || [];

    liveRows = allVideos.filter((x) => x.status === "live");

    upcomingRows = allVideos
      .filter((x) => x.status === "upcoming")
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    latestRows = allVideos
      .filter((x) => x.status === "video" || x.status === "archive")
      .sort(
        (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
      );

    renderAll();

    $("#lastSync").textContent = `最終確認 ${new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())}`;
  } catch (error) {
    console.error("video load error:", error);

    $("#lastSync").textContent = "接続エラー";
  }
}

/* =========================
   LIVE
========================= */

function liveCard(x) {
  return `
    <article
      class="live-card"
      data-url="${esc(x.url)}"
    >

      <div
        class="live-thumb"
        style="
          background-image:
            url('${esc(x.thumbnail)}');
        "
      >

        <span class="live-badge">
          LIVE NOW
        </span>

      </div>

      <div class="live-body">

        <div class="live-streamer">
          ${esc(x.streamer_name)}
        </div>

        <div class="live-title">
          ${esc(x.title)}
        </div>

      </div>

    </article>
  `;
}

function renderLive(rows, target) {
  const root = $(target);

  if (!root) return;

  if (!rows.length) {
    root.innerHTML = `
      <div class="empty">
        現在、配信中のストリーマーはいません。
      </div>
    `;

    return;
  }

  root.innerHTML = rows.map(liveCard).join("");

  root.querySelectorAll(".live-card").forEach((el) => {
    el.onclick = () => openUrl(el.dataset.url);
  });
}

/* =========================
   UPCOMING
========================= */

function scheduleItem(x) {
  return `
    <article
      class="schedule-item"
      data-url="${esc(x.url)}"
    >

      <div>

        <div class="schedule-time">
          ${fmtTime(x.scheduled_at)}
        </div>

        <div class="schedule-date">
          ${fmtDate(x.scheduled_at)}
        </div>

      </div>

      <div class="schedule-streamer">
        ${esc(x.streamer_name)}
      </div>

      <div class="schedule-title">
        ${esc(x.title)}
      </div>

      <div class="schedule-arrow">
        →
      </div>

    </article>
  `;
}

function renderUpcoming(rows, target, limit = 8) {
  const root = $(target);

  if (!root) return;

  if (!rows.length) {
    root.innerHTML = `
      <div class="empty">
        配信予定はありません。
      </div>
    `;

    return;
  }

  root.innerHTML = rows.slice(0, limit).map(scheduleItem).join("");

  root.querySelectorAll(".schedule-item").forEach((el) => {
    el.onclick = () => openUrl(el.dataset.url);
  });
}

/* =========================
   LATEST
========================= */

function latestItem(x) {
  return `
    <article
      class="latest-item"
      data-url="${esc(x.url)}"
    >

      <div class="latest-thumb">

        ${
          x.thumbnail
            ? `<img
                src="${esc(x.thumbnail)}"
                alt=""
              >`
            : ""
        }

      </div>

      <div>

        <div class="latest-streamer">
          ${esc(x.streamer_name)}
        </div>

        <div class="latest-title">
          ${esc(x.title)}
        </div>

      </div>

      <div class="latest-date">
        ${fmtDate(x.published_at)}
      </div>

    </article>
  `;
}

function renderLatest(rows, target, limit = 8) {
  const root = $(target);

  if (!root) return;

  if (!rows.length) {
    root.innerHTML = `
      <div class="empty">
        まだ最新情報がありません。
      </div>
    `;

    return;
  }

  root.innerHTML = rows.slice(0, limit).map(latestItem).join("");

  root.querySelectorAll(".latest-item").forEach((el) => {
    el.onclick = () => openUrl(el.dataset.url);
  });
}

/* =========================
   RENDER ALL
========================= */

function renderAll() {
  renderLive(liveRows, "#liveList");

  renderLive(liveRows, "#livePageList");

  renderUpcoming(upcomingRows, "#upcomingList", 8);

  renderUpcoming(upcomingRows, "#upcomingPageList", 100);

  renderLatest(latestRows, "#latestList", 8);

  renderLatest(latestRows, "#latestPageList", 100);
}

/* =========================
   VIEW SWITCH
========================= */

function setView(view) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `${view}View`);
  });

  document.querySelectorAll("[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });

  if (window.innerWidth <= 800) {
    closeMobile();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

document.querySelectorAll("[data-view]").forEach((el) => {
  el.addEventListener("click", () => setView(el.dataset.view));
});

/* =========================
   SIDEBAR
========================= */

const sidebar = $("#sidebar");
const main = document.querySelector(".main");

$("#collapseMenu").addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("collapsed");

  main.classList.toggle("sidebar-collapsed", collapsed);

  $("#collapseMenu").textContent = collapsed ? "›" : "‹";
});

function openMobile() {
  sidebar.classList.add("open");

  $("#sidebarOverlay").classList.add("show");
}

function closeMobile() {
  sidebar.classList.remove("open");

  $("#sidebarOverlay").classList.remove("show");
}

$("#mobileMenu").addEventListener("click", openMobile);

$("#sidebarOverlay").addEventListener("click", closeMobile);

/* =========================
   CLOCK
========================= */

function updateClock() {
  $("#clock").textContent = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

updateClock();

setInterval(updateClock, 1000);

/* =========================
   LOGOUT
========================= */

$("#logoutButton").addEventListener("click", async () => {
  if (!supabaseClient) return;

  await supabaseClient.auth.signOut();

  location.reload();
});

/* =========================
   AUTH EVENTS
========================= */

$("#loginButton").addEventListener("click", login);

$("#signupButton").addEventListener("click", signup);

$("#authPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

/* =========================
   PREVIEW MODE
========================= */

const previewMode =
  new URLSearchParams(window.location.search).get("preview") === "1";

function startPreview() {
  currentUser = {
    id: "preview-user",
    user_metadata: {
      username: "preview",
    },
  };

  $("#authScreen").classList.add("hidden");

  $("#app").classList.remove("hidden");

  $("#userName").textContent = "preview";

  $("#userMark").textContent = "P";

  $("#settingsUserId").textContent = "preview";

  /* -------------------------
     仮ストリーマー
  ------------------------- */

  myStreamers = [
    {
      id: "yano-kuromu",
      name: "夜乃くろむ",
      channel_id: "UCX4WL24YEOUYd7qDsFSLDOw",
      thumbnail: "",
    },
    {
      id: "sample-streamer",
      name: "サンプルストリーマー",
      channel_id: "sample",
      thumbnail: "",
    },
  ];

  allStreamers = [
    ...myStreamers,
    {
      id: "another-streamer",
      name: "もうひとりのストリーマー",
      channel_id: "another",
      thumbnail: "",
    },
  ];

  /* -------------------------
     仮動画データ
  ------------------------- */

  allVideos = [
    {
      video_id: "preview-live",
      streamer_id: "yano-kuromu",
      streamer_name: "夜乃くろむ",
      status: "live",
      title: "【雑談】ゆっくりおはなし",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date().toISOString(),
    },

    {
      video_id: "preview-live-2",
      streamer_id: "sample-streamer",
      streamer_name: "サンプルストリーマー",
      status: "live",
      title: "【ゲーム】今日も遊ぶ",
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date().toISOString(),
    },

    {
      video_id: "preview-upcoming",
      streamer_id: "yano-kuromu",
      streamer_name: "夜乃くろむ",
      status: "upcoming",
      title: "【配信予定】夜の雑談配信",
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date().toISOString(),
    },

    {
      video_id: "preview-upcoming-2",
      streamer_id: "sample-streamer",
      streamer_name: "サンプルストリーマー",
      status: "upcoming",
      title: "【Apex Legends】ランクやります",
      scheduled_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date().toISOString(),
    },

    {
      video_id: "preview-video-1",
      streamer_id: "yano-kuromu",
      streamer_name: "夜乃くろむ",
      status: "video",
      title: "【切り抜き】最近あったことを話す",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },

    {
      video_id: "preview-video-2",
      streamer_id: "sample-streamer",
      streamer_name: "サンプルストリーマー",
      status: "video",
      title: "【Minecraft】まったり建築",
      thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    },

    {
      video_id: "preview-video-3",
      streamer_id: "yano-kuromu",
      streamer_name: "夜乃くろむ",
      status: "archive",
      title: "【アーカイブ】昨日の配信",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      url: "https://www.youtube.com/",
      published_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  liveRows = allVideos.filter((x) => x.status === "live");

  upcomingRows = allVideos
    .filter((x) => x.status === "upcoming")
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  latestRows = allVideos
    .filter((x) => x.status === "video" || x.status === "archive")
    .sort(
      (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
    );

  renderAll();

  renderStreamers();

  $("#lastSync").textContent = "デザインプレビュー";

  /* -------------------------
     プレビュー表示
  ------------------------- */

  const previewNotice = document.createElement("div");

  previewNotice.textContent = "DESIGN PREVIEW";

  previewNotice.style.position = "fixed";
  previewNotice.style.right = "18px";
  previewNotice.style.bottom = "18px";
  previewNotice.style.zIndex = "9999";
  previewNotice.style.padding = "7px 10px";
  previewNotice.style.border = "1px solid rgba(255,255,255,.1)";
  previewNotice.style.borderRadius = "6px";
  previewNotice.style.background = "rgba(20,21,22,.9)";
  previewNotice.style.color = "#777";
  previewNotice.style.fontSize = "9px";
  previewNotice.style.letterSpacing = ".12em";

  document.body.appendChild(previewNotice);
}

/* =========================
   INITIAL AUTH CHECK
========================= */

async function init() {
  /* -------------------------
     デザイン確認
  ------------------------- */

  if (previewMode) {
    startPreview();

    return;
  }

  /* -------------------------
     通常モード
  ------------------------- */

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
  } else {
    $("#authScreen").classList.remove("hidden");

    $("#app").classList.add("hidden");
  }
}

init();

/* =========================
   AUTO REFRESH
========================= */

setInterval(async () => {
  if (previewMode) {
    return;
  }

  if (currentUser && !$("#app").classList.contains("hidden")) {
    await loadData();
  }
}, 60000);
