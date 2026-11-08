# アクセスルールの検証

素の Postgres（16 で確認）に Supabase の最小限の代役（auth.users / auth.uid() / ロール）を入れ、
マイグレーションを流してからシナリオを実行する。

```sh
createdb innerchat_test
psql -d innerchat_test -f supabase/tests/00_supabase_stub.sql
psql -d innerchat_test -f supabase/migrations/20261108000000_init.sql
psql -d innerchat_test -f supabase/tests/10_access_scenarios.sql   # 最後に "ALL TESTS PASSED"
```

`00_supabase_stub.sql` はテスト専用。本番の Supabase には流さない。
