# 招待〜ログインの通しテスト

本物の Supabase を使わずに、画面の流れを最後まで確かめるためのテスト。

- `mock-supabase.js`：Supabase の Auth / REST API のうち、この流れで使う部分だけを模したサーバー（ポート 54321）。
  データはローカルの Postgres（`supabase/migrations` 適用済み）に入り、RLS・DB 関数・登録前フックは本物がそのまま動く。
  確認コードは常に `123456`。
- `onboarding.js`：Playwright でブラウザを動かし、招待リンク → メール登録 → 規約同意 → プロフィール → ログアウト → ログイン →
  未登録ログインの拒否 → 電話番号登録 → 使用済みリンク → アプリを通さない直接登録の拒否、を確認する。

```sh
# 1. ローカル Postgres に supabase/tests/00_supabase_stub.sql とマイグレーションを流し、管理者と招待リンクを作る
# 2. モックとアプリを起動
npm install pg playwright            # テスト用（アプリの依存には含めない）
PGHOST=/path/to/socket PGPORT=5432 node tests/e2e/mock-supabase.js &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next start -p 3100 &
# 3. 実行（INVITE_TOKEN は create_invite_link の戻り値、使用回数2のリンク）
INVITE_TOKEN=xxxx node tests/e2e/onboarding.js      # 最後に "E2E PASSED"
```

相談一覧・投稿のテストは、メンバー4人を入れた DB で実行する：

```sh
psql -d <db> -f tests/e2e/seed-consultations.sql
node tests/e2e/consultations.js      # 最後に "E2E PASSED"
```

モックはテスト専用で、Supabase の挙動を完全には再現しない（レート制限、メール送信、トークン更新など）。
本番前に、実際の Supabase プロジェクトでも一度通しで確認すること。
