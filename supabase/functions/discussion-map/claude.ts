// Claude API の呼び出し（構造化出力・拒否時の自動フォールバックつき）
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { MAP_SCHEMA, type ModelCall, type ModelOutput } from "./core.ts";

export function makeCallModel(client: Anthropic, model: string) {
  return async (system: string, user: string): Promise<ModelCall> => {
    try {
      const res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // 安全上の理由で断られた場合、Anthropic 推奨の別モデルで自動的にやり直す
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: MAP_SCHEMA as unknown as Record<string, unknown> },
        },
      });
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") {
        return { ok: false, status: "refused", error: `refused: ${res.stop_details?.category ?? "unknown"}`, model: res.model, ...usage };
      }
      if (res.stop_reason === "max_tokens") {
        return { ok: false, status: "error", error: "max_tokens reached", model: res.model, ...usage };
      }
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      let output: ModelOutput;
      try {
        output = JSON.parse(text) as ModelOutput;
      } catch {
        return { ok: false, status: "error", error: "invalid JSON in response", model: res.model, ...usage };
      }
      return { ok: true, output, model: res.model, ...usage };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return { ok: false, status: "rate_limited", error: e.message, model };
      if (e instanceof Anthropic.APIError) return { ok: false, status: "error", error: `${e.status}: ${e.message}`, model };
      return { ok: false, status: "error", error: String(e), model };
    }
  };
}
