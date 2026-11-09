# inner-chat

知り合いだけが入れる、「できること」と相談をつなぐチャット。

- 要件：[docs/requirements.md](docs/requirements.md)
- 決定記録：[docs/decisions.md](docs/decisions.md)
- 画面：[docs/screens.md](docs/screens.md)（HTML 版：[docs/wireframes.html](docs/wireframes.html)）
- データ設計：[docs/data-model.md](docs/data-model.md)

## 実装済み

招待からログインまで（A-01〜A-07）

| URL | 画面 |
| --- | --- |
| `/invite/[token]` | 招待ウェルカム（無効なリンクなら案内） |
| `/signup` | 連絡先入力（メールが標準、電話番号は切り替え） |
| `/verify` | 確認コード入力（60秒後に再送可） |
| `/welcome/terms` | 規約・AI 利用の同意 |
| `/welcome/profile` | 表示名（ここでメンバー登録が完了） |
| `/welcome/skills` | できること・ひとこと（スキップ可） |
| `/login` | ログイン（登録済みの連絡先のみ） |
| `/no-access` | 招待のないアカウント・停止中のアカウント |
| `/` | 相談一覧（B-01）：すべて／自分の／関係者、ステータスで絞り込み、届いた関係者招待のバナー |
| `/consultations/new` | 相談を投稿（B-02）：公開範囲、関係者の選択（名前・タグで検索）、管理者閲覧、AI 利用、タグ |
| `/consultations/[id]` | 相談詳細（B-03 の簡易版）：本文・公開範囲・関係者・議論マップの枠。スレッド・反応・設定は次の段階 |
| `/invitations`, `/invitations/[id]` | 関係者招待の一覧・承認前の画面（B-09 の簡易版）：参加する／辞退する。問い合わせは次の段階 |
| `/me` | マイページ（簡易版）：ログアウト |

画面の例は [docs/screenshots/](docs/screenshots/)（テスト実行時のスマホ表示）。

## 招待の確認の仕組み

招待されていない人は、アプリからも Supabase の API を直接たたいても登録できない。

1. 招待リンクを開くと、リンクが有効か確認する（`check_invite_link`）
2. メールアドレス／電話番号を入れると、「この連絡先はこの招待で登録する」と予約する（`claim_invite`、1時間有効）
3. 確認コードを送る時、Supabase Auth がユーザーを作る直前に **登録前フック**（`hook_before_user_created`）が予約を確認。予約がなければユーザーを作らせない
4. コード確認・規約同意のあと、表示名を入れると予約を使ってメンバーになる（`redeem_invite`）。リンクの使用回数はこの時点で数える

ログイン（`/login`）は新しいユーザーを作らない設定で確認コードを送るので、未登録の連絡先は「登録されていません」と表示される。

## セットアップ

### 1. Supabase プロジェクト

1. Supabase でプロジェクトを作る
2. `supabase/migrations/` の SQL を古い順に適用する（`supabase db push`、または SQL Editor に貼り付け）
3. **最初の管理者を作る**（登録前フックを有効にする前に行う）
   - Authentication → Users → Add user で管理者のメールアドレスを登録
   - SQL Editor で：
     ```sql
     insert into public.profiles (id, display_name, role, terms_version, terms_accepted_at)
     select id, '管理者の名前', 'admin', '2026-11-08', now() from auth.users where email = 'admin@example.com';
     insert into public.notification_settings (profile_id)
     select id from auth.users where email = 'admin@example.com';
     ```
4. **登録前フックを有効にする**：Authentication → Hooks → Before User Created → Postgres function で `public.hook_before_user_created` を選ぶ
   - ローカル開発（`supabase start`）では `supabase/config.toml` に：
     ```toml
     [auth.hook.before_user_created]
     enabled = true
     uri = "pg-functions://postgres/public/hook_before_user_created"
     ```
5. **メールで6桁のコードを送るようにする**：Authentication → Email Templates の「Magic Link」と「Confirm signup」の本文に `{{ .Token }}` を入れる（標準はリンクだけで、コードが入っていない）
6. メール送信を外部サービス（Resend など）につなぐ：Authentication → SMTP Settings。標準の送信は数が厳しく制限されている
7. SMS を使う場合：Authentication → Providers → Phone で SMS 事業者（Twilio など）を設定する。設定しなければ電話番号での登録は失敗し、画面にはメールを使うよう案内が出る

### 2. アプリ

```sh
cp .env.example .env.local   # Supabase の URL と anon（publishable）キーを入れる
npm install
npm run dev
```

管理者は、招待リンクを SQL で発行できる（管理画面はこれから作る）：

```sql
-- 管理者としてログインした状態のアプリから呼ぶ想定。SQL Editor で試す場合は
-- set request.jwt.claim.sub = '<管理者の id>'; set role authenticated; を先に実行
select public.create_invite_link(interval '7 days', 1, '〇〇さん用');
-- 戻り値のトークンで https://<アプリのドメイン>/invite/<トークン> を送る
```

## テスト

- DB のアクセスルール：[supabase/tests/](supabase/tests/)（80項目）
- 招待〜ログインの通し：[tests/e2e/onboarding.js](tests/e2e/onboarding.js)（ブラウザで22項目）
- 相談一覧・投稿・関係者招待：[tests/e2e/consultations.js](tests/e2e/consultations.js)（ブラウザで30項目）
