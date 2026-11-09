// 実行：cd supabase/functions/discussion-map && deno run --allow-net claude.test.ts
// （偽の API サーバーを立てて、SDK が送る内容とエラー時の扱いを確認する。実際の API は呼ばない）
import http from "node:http";
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { makeCallModel } from "./claude.ts";
import { SYSTEM_PROMPT } from "./core.ts";

let n = 0;
const ok = (c: unknown, label: string) => { if (!c) throw new Error("FAIL: " + label); console.log("OK", ++n, label); };
let mode = "ok";
let lastReq: { headers: http.IncomingHttpHeaders; body: any } | null = null;
const good = { has_goal: true, has_situation: true, has_constraints: false, goal: "g", phase: 2, flow: ["a"], decided: [], open_issues: [], next_steps: [], preview: { goal: "g", flow_summary: "s", open_issues: [] } };

const server = http.createServer(async (req, res) => {
  let s = ""; for await (const c of req) s += c;
  lastReq = { headers: req.headers, body: JSON.parse(s) };
  const msg = (stop: string, text: string, extra = {}) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1234, output_tokens: 321 }, ...extra });
  res.setHeader("content-type", "application/json");
  if (mode === "429") { res.statusCode = 429; res.setHeader("retry-after", "0"); return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } })); }
  if (mode === "refusal") return res.end(JSON.stringify(msg("refusal", "", { stop_details: { type: "refusal", category: "cyber", explanation: "x" } })));
  if (mode === "badjson") return res.end(JSON.stringify(msg("end_turn", "{not json")));
  res.end(JSON.stringify(msg("end_turn", JSON.stringify(good))));
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 });
const call = makeCallModel(client, "claude-opus-5-5");

let r = await call(SYSTEM_PROMPT, "相談の内容");
ok(r.ok && r.output.phase === 2 && r.inputTokens === 1234 && r.outputTokens === 321, "parses structured output and usage");
const b = lastReq!.body, h = lastReq!.headers;
ok(b.model === "claude-opus-5-5" && b.max_tokens === 16000, "model and max_tokens");
ok(b.fallbacks === "default", "fallbacks: default");
ok(String(h["anthropic-beta"]).includes("server-side-fallback-2026-07-01"), "fallback beta header");
ok(b.output_config?.format?.type === "json_schema" && b.output_config.format.schema.required.includes("preview"), "json_schema output format");
ok(b.output_config?.effort === "medium", "effort set explicitly");
ok(b.system === SYSTEM_PROMPT && b.messages[0].content === "相談の内容", "system and user prompt");
ok(!("temperature" in b) && !("thinking" in b), "no sampling params / thinking config");
mode = "refusal"; r = await call("s", "u");
ok(!r.ok && r.status === "refused" && r.error.includes("cyber"), "refusal handled");
mode = "badjson"; r = await call("s", "u");
ok(!r.ok && r.status === "error" && r.error.includes("invalid JSON"), "invalid JSON handled");
mode = "429"; r = await call("s", "u");
ok(!r.ok && r.status === "rate_limited", "rate limit handled");
server.close();
console.log("CLAUDE CALL TESTS PASSED", n);
