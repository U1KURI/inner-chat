"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/member";

export type NewConsultationState = { error?: string };

export async function createConsultation(_prev: NewConsultationState, formData: FormData): Promise<NewConsultationState> {
  const { supabase } = await requireMember();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const visibility = formData.get("visibility") === "restricted" ? "restricted" : "public";
  const memberIds = formData.getAll("member").map(String);
  const adminCanView = formData.get("admin_can_view") === "on";
  const aiEnabled = formData.get("ai_enabled") === "on";
  const tags = [...new Set(formData.getAll("tag").map((t) => String(t).trim()).filter(Boolean))].slice(0, 10);

  if (title.length < 1 || title.length > 100) return { error: "タイトルは1〜100文字で入力してください。" };
  if (body.length > 10000) return { error: "内容は10,000文字までです。" };
  if (visibility === "restricted" && memberIds.length === 0) {
    return { error: "「関係者のみ」の場合は、関係者を1人以上選んでください。" };
  }

  const { data, error } = await supabase.rpc("create_consultation", {
    p_title: title,
    p_body: body,
    p_visibility: visibility,
    p_member_ids: visibility === "restricted" ? memberIds : [],
    p_admin_can_view: visibility === "restricted" ? adminCanView : true,
    p_ai_enabled: aiEnabled,
    p_tags: tags,
  });
  if (error || !data) return { error: "投稿できませんでした。時間をおいてもう一度お試しください。" };

  redirect(`/consultations/${data as string}`);
}

export async function respondInvitation(formData: FormData) {
  const { supabase } = await requireMember();
  const id = String(formData.get("id") ?? "");
  const accept = formData.get("accept") === "yes";
  const { error } = await supabase.rpc("respond_to_invitation", { p_invitation_id: id, p_accept: accept });
  if (error) redirect(`/invitations/${id}?error=1`);
  redirect(accept ? "/?f=member" : "/");
}
