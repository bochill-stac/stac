# STAC v2
ユーザーが追加したYouTubeチャンネルを同期する構成です。

重要な変更:
- `sync-youtube.mjs` は `streamers` テーブルを直接読み、全登録チャンネルを同期。
- YouTube Search APIは使わず、各チャンネルRSS + `videos.list` を使用。
- `videos.streamer_id` はDB上の実際の `streamers.id` を使用。
- そのため新しく追加した「望月ほぐの / Hoguno Mochizuki」も同期対象になります。

GitHub Secrets:
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
YOUTUBE_API_KEY

Supabase Edge Function Secrets:
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
YOUTUBE_API_KEY

Edge Function `add-streamer` はVerify JWTをOFFにして、Authorizationヘッダーを関数内で検証します。
