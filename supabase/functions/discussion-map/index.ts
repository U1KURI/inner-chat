// Edge Function：議論マップの自動生成（pg_cron から1分ごとに呼ばれる）
//   設定：supabase secrets set ANTHROPIC_API_KEY=... （任意で CLAUDE_MODEL）
//   呼び出し元は secret キーを apikey ヘッダーに付ける（docs/discussion-map.md）
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { withSupabase } from "npm:@supabase/server@1.9.2";
import { makeCallModel } from "./claude.ts";
import { runBatch } from "./core.ts";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5";
const BATCH = Number(Deno.env.get("MAP_BATCH_SIZE") ?? "5");
const anthropic = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む

export default {
  fetch: withSupabase({ auth: "secret" }, async (_req, ctx) => {
    const db = ctx.supabaseAdmin;
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    };

    const results = await runBatch(
      { rpc, callModel: makeCallModel(anthropic, MODEL), log: (m, x) => console.error(m, x) },
      BATCH,
    );
    const expired = await rpc("expire_invitations", {});
    return Response.json({ processed: results, expired_invitations: expired });
  }),
};
