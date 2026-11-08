import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type InviteStatus = {
  signed_in: boolean;
  member?: boolean;
  status?: "active" | "suspended";
  can_join?: boolean;
  inviter?: string | null;
};

export type Profile = { id: string; display_name: string; role: "member" | "admin"; bio: string | null };

/** ログイン状態と参加状況をまとめて取得する */
export async function getAuthState() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, status: { signed_in: false } as InviteStatus, profile: null };

  const { data } = await supabase.rpc("my_invite_status");
  const status = (data ?? { signed_in: true }) as InviteStatus;
  let profile: Profile | null = null;
  if (status.member && status.status === "active") {
    const res = await supabase.from("profiles").select("id, display_name, role, bio").eq("id", user.id).maybeSingle();
    profile = res.data as Profile | null;
  }
  return { supabase, user, status, profile };
}

/** メンバー専用の画面で使う。条件を満たさなければ適切な画面へ移動する */
export async function requireMember() {
  const state = await getAuthState();
  if (!state.user) redirect("/login");
  if (!state.status.member) redirect(state.status.can_join ? "/welcome/terms" : "/no-access?reason=not_invited");
  if (state.status.status === "suspended") redirect("/no-access?reason=suspended");
  if (!state.profile) redirect("/no-access?reason=unknown");
  return { ...state, profile: state.profile };
}

/** 参加手続き中（ログイン済み・プロフィール未作成）の画面で使う */
export async function requireJoining() {
  const state = await getAuthState();
  if (!state.user) redirect("/login");
  if (state.status.member) redirect("/");
  if (!state.status.can_join) redirect("/no-access?reason=not_invited");
  return state;
}
