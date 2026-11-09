-- 議論マップの定期処理を登録する（Supabase の SQL Editor で1回だけ実行）
-- 前提：Edge Function `discussion-map` をデプロイ済み（docs/discussion-map.md の手順）
-- 下の2か所（project-ref と secret キー）を自分のプロジェクトの値に置き換える。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- プロジェクトの URL と secret キー（Settings → API keys の secret キー「default」）を Vault に保存
select vault.create_secret('https://project-ref.supabase.co', 'project_url');
select vault.create_secret('YOUR_SUPABASE_SECRET_KEY', 'secret_key');

-- 1分ごとに Edge Function を呼ぶ（議論マップの生成と、関係者招待の期限切れ処理）
select cron.schedule(
  'discussion-map',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/discussion-map',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- 止めたいとき：select cron.unschedule('discussion-map');
-- 実行状況：select * from cron.job_run_details order by start_time desc limit 20;
--           select * from net._http_response order by created desc limit 20;
