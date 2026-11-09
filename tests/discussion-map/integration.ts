// 議論マップの処理を本物の Postgres で通す（AI はテスト用の偽物）。
//   tests/e2e/consultations.js を流した DB に対して実行する：
//   PG_MODULE=/path/to/node_modules/pg/lib/index.js DATABASE_URL=postgresql://... \
//     node --experimental-strip-types tests/discussion-map/integration.ts
import { runBatch, type ModelCall } from "../../supabase/functions/discussion-map/core.ts";

const pg = await import(process.env.PG_MODULE ?? "pg");
const { Pool } = (pg.default ?? pg) as { Pool: new (o: object) => any };
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let n = 0;
const ok = (c: unknown, label: string) => {
  if (!c) throw new Error("FAIL: " + label);
  console.log("OK", ++n, label);
};

// Edge Function と同じく service_role で DB 関数を呼ぶ
async function rpc(fn: string, args: Record<string, unknown>) {
  const c = await pool.connect();
  try {
    await c.query("set role service_role");
    const names = Object.keys(args);
    const r = await c.query(
      `select * from public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`,
      names.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])),
    );
    return fn === "ai_claim_dirty_maps" ? r.rows.map((x: any) => x.r) : r.rows[0]?.r;
  } finally {
    await c.query("reset role");
    c.release();
  }
}

const prompts: string[] = [];
async function fakeModel(_system: string, user: string): Promise<ModelCall> {
  prompts.push(user);
  const hasOthers = /\] P[2-9]/.test(user);
  return {
    ok: true,
    model: "fake-model",
    inputTokens: user.length,
    outputTokens: 100,
    output: {
      has_goal: true,
      has_situation: true,
      has_constraints: false,
      goal: "お店のサイトを作り直して予約を増やしたい",
      phase: hasOthers ? 2 : 1,
      flow: hasOthers ? ["今のサイトの問題点を共有", "予約の仕組みが論点に"] : ["相談が投稿された"],
      decided: [],
      open_issues: ["予算", "自分で更新したいか"],
      next_steps: hasOthers ? [{ text: "参考サイトを3つ挙げる", who: "P1" }] : [],
      preview: { goal: "お店のサイトを作り直したい", flow_summary: "問題点を共有し、予約の仕組みを検討中", open_issues: ["予算"] },
    },
  };
}
const mapOf = async (id: string) =>
  (await pool.query("select * from public.discussion_maps where consultation_id = $1", [id])).rows[0];

const {
  rows: [pub],
} = await pool.query("select id from public.consultations where title = $1", ["店のWebサイトをなんとかしたい"]);
ok(pub, "public consultation exists (run tests/e2e/consultations.js first)");

// 1回目：投稿直後（他の人の発言なし）→ 材料集め中のまま
let res = await runBatch({ rpc, callModel: fakeModel }, 10);
ok(res[pub.id] === "applied", "first run applied right after posting");
let m = await mapOf(pub.id);
ok(m.state === "collecting", "no replies yet -> still collecting");
ok(m.missing_items.find((x: any) => x.key === "others")?.ok === false, "checklist: replies missing");
ok(prompts[0].includes("投稿者：P1"), "prompt labels the author");

// 発言が来る → まとめ待ち（3分）の間は処理しない
await pool.query(
  `insert into public.consultation_messages (consultation_id, author_id, body) values
   ($1, '00000000-0000-0000-0000-00000000000d', '予約システムって今使ってますか？'),
   ($1, '00000000-0000-0000-0000-00000000000b', '電話だけです')`,
  [pub.id],
);
res = await runBatch({ rpc, callModel: fakeModel }, 10);
ok(!(pub.id in res), "debounce: not processed right after a message");
await pool.query("update public.discussion_maps set dirty_since = now() - interval '4 minutes' where consultation_id = $1", [pub.id]);
res = await runBatch({ rpc, callModel: fakeModel }, 10);
ok(res[pub.id] === "applied", "processed after debounce");
m = await mapOf(pub.id);
ok(m.state === "ready" && m.phase === 2, "ready with phase 2");
ok(m.next_steps[0].who === "00000000-0000-0000-0000-00000000000b" && m.next_steps[0].who_name === "佐藤", "next-step owner resolved from label");
ok(m.preview && !JSON.stringify(m.preview).includes("佐藤"), "preview has no names");
const last = prompts[prompts.length - 1];
ok(!last.includes("中村") && !last.includes("佐藤"), "prompt does not contain display names");
ok(last.includes("P2: 予約システムって今使ってますか？"), "prompt contains labeled messages");

// 失敗 → 記録して、マップはそのまま再試行待ち
await pool.query("update public.discussion_maps set dirty_since = now() - interval '4 minutes' where consultation_id = $1", [pub.id]);
res = await runBatch({ rpc, callModel: async () => ({ ok: false, status: "refused", error: "refused: test", model: "fake-model" }) }, 10);
ok(res[pub.id] === "refused", "refusal recorded");
const {
  rows: [run],
} = await pool.query("select status from public.ai_runs where consultation_id = $1 order by id desc limit 1", [pub.id]);
ok(run.status === "refused", "ai_runs has refused");
m = await mapOf(pub.id);
ok(m.state === "ready" && m.failure_count === 1 && m.dirty_since, "map kept, queued for retry");

// 再試行で戻る（画面確認用に ready の状態にしておく）
await pool.query("update public.discussion_maps set dirty_since = now() - interval '10 minutes' where consultation_id = $1", [pub.id]);
res = await runBatch({ rpc, callModel: fakeModel }, 10);
ok(res[pub.id] === "applied", "retry succeeded");

await pool.end();
console.log("INTEGRATION PASSED", n);
