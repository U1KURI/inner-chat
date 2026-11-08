"use server";

import { redirect } from "next/navigation";
import { TERMS_VERSION } from "@/lib/env";
import { clearFlowCookies, getTermsAccepted, setTermsAccepted } from "@/lib/flow";
import { requireJoining, requireMember } from "@/lib/member";
import { redeemErrorMessage } from "@/lib/messages";

export type WelcomeState = { error?: string };

export async function acceptTerms(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  await requireJoining();
  if (formData.get("agree") !== "on") return { error: "利用規約と AI の利用への同意が必要です。" };
  await setTermsAccepted(TERMS_VERSION);
  redirect("/welcome/profile");
}

export async function createProfile(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const { supabase } = await requireJoining();
  const terms = await getTermsAccepted();
  if (terms !== TERMS_VERSION) redirect("/welcome/terms");

  const displayName = String(formData.get("display_name") ?? "").trim();
  if (displayName.length < 1 || displayName.length > 40) return { error: "表示名は1〜40文字で入力してください。" };

  const { error } = await supabase.rpc("redeem_invite", { p_display_name: displayName, p_terms_version: terms });
  if (error) return { error: redeemErrorMessage(error.message) };

  await clearFlowCookies("invite", "terms");
  redirect("/welcome/skills");
}

export async function saveSkills(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const { supabase, profile } = await requireMember();

  const names = [
    ...new Set(
      formData
        .getAll("tag")
        .map((v) => String(v).trim())
        .filter((v) => v.length >= 1 && v.length <= 30),
    ),
  ].slice(0, 20);
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 500);

  if (names.length > 0) {
    // 小さなコミュニティなのでタグ一覧はまとめて読み、名前（大文字小文字は区別しない）で照合する
    const { data: existing, error: readError } = await supabase.from("tags").select("id, name");
    if (readError) return { error: "保存できませんでした。もう一度お試しください。" };
    const byName = new Map((existing ?? []).map((t) => [t.name.toLowerCase(), t.id as string]));

    const missing = names.filter((n) => !byName.has(n.toLowerCase()));
    if (missing.length > 0) {
      // 1件ずつ作る（同時に誰かが同じ名前を作っていたら失敗するので、最後に読み直す）
      for (const name of missing) {
        await supabase.from("tags").insert({ name, created_by: profile.id });
      }
      const { data: again } = await supabase.from("tags").select("id, name");
      (again ?? []).forEach((t) => byName.set(t.name.toLowerCase(), t.id));
    }

    const rows = names
      .map((n) => byName.get(n.toLowerCase()))
      .filter((id): id is string => Boolean(id))
      .map((tag_id, i) => ({ profile_id: profile.id, tag_id, kind: "can" as const, sort_order: i }));
    const { error } = await supabase
      .from("profile_skills")
      .upsert(rows, { onConflict: "profile_id,tag_id", ignoreDuplicates: true });
    if (error) return { error: "できることを保存できませんでした。もう一度お試しください。" };
  }

  if (bio) {
    const { error } = await supabase.from("profiles").update({ bio }).eq("id", profile.id);
    if (error) return { error: "ひとことを保存できませんでした。もう一度お試しください。" };
  }

  redirect("/");
}
