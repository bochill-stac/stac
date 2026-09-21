# スト活 v1 — 最初からセットアップ

**デザインはこれまで作ってきたスト活UIをそのまま維持**しています。

## 目的
iPadでスト活を常時表示し、YouTubeなどの活動情報を1か所で見る。

## 構成
YouTube → GitHub Actions → Supabase → スト活Web → iPad

Webを開くたびにYouTube APIを呼ぶ設計ではありません。

## 1. Supabase
1. https://supabase.com/ を開く
2. GitHubでログイン
3. New project → 名前 `stac`
4. Freeで開始
5. 日本に近いリージョンを選べるなら選ぶ
6. DBパスワードは自分だけで保管

## 2. DBを作る
Supabaseの **SQL Editor** を開き、`supabase/schema.sql` を全部貼ってRun。
`videos` テーブルと `stac_home` view ができます。

## 3. Web用設定
SupabaseのProject Settings → APIから **Project URL** と **Publishable key** を取得。
`config.js` に入れる。

`config.js` はGitHubへコミットしない設定になっています。

## 4. YouTube API
Google CloudでYouTube Data API v3を有効化し、API keyを作る。
この構成では `search.list` を使わず、RSSで見つかったIDだけ `videos.list` に送ります。

## 5. GitHub Secrets
Repository → Settings → Secrets and variables → Actions に以下を追加。
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YOUTUBE_API_KEY`
- `YOUTUBE_CHANNEL_ID`

**Service role keyは絶対に `config.js` に入れない。**

## 6. GitHub Actions
`.github/workflows/sync-youtube.yml` が約5分ごとに動きます。
最初は Actions → STAC YouTube Sync → Run workflow で手動実行。
Supabaseの `videos` にデータが入れば成功。

## 7. Vercel
GitHubリポジトリをVercelへImportしてDeploy。
Web側はSupabaseのPublishable keyだけを使います。

## 8. iPad
Safariでスト活を開き、ホーム画面に追加。
iPadで開きっぱなしにするのが想定用途です。

## 節約方針
- `search.list` 不使用
- RSSでまずID確認
- 新規・状態確認が必要な動画だけAPI
- Web閲覧者ごとにYouTube APIを呼ばない
- Supabaseを保存先兼キャッシュにする

## 最初の対象
夜乃くろむ / Yano Kuromu。
YouTube Channel IDはGitHub Secret `YOUTUBE_CHANNEL_ID` に設定。

## 今後
X、Twitch、Discord通知、複数ストリーマー、お気に入り、通知履歴を順番に追加する。
