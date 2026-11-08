"use server";

import { redirect } from "next/navigation";
import { contactLabel, parseContact, type Contact, type ContactKind } from "@/lib/contact";
import { clearFlowCookies, getInviteToken, getOtpState, setOtpState, type OtpPurpose } from "@/lib/flow";
import { inviteProblemMessage, sendCodeErrorMessage, verifyErrorMessage } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; notice?: string; sentAt?: number };

/** 確認コードを送る（登録時は先に招待を予約する） */
async function deliverCode(contact: Contact, purpose: OtpPurpose): Promise<{ error?: string }> {
  const supabase = await createClient();

  if (purpose === "signup") {
    const token = await getInviteToken();
    if (!token) return { error: "招待リンクから開き直してください。" };
    const { data, error } = await supabase.rpc(
      "claim_invite",
      contact.kind === "email" ? { p_token: token, p_email: contact.email } : { p_token: token, p_phone: contact.phone },
    );
    if (error) return { error: "招待を確認できませんでした。時間をおいてもう一度お試しください。" };
    const result = data as { ok: boolean; reason?: string };
    if (!result.ok) return { error: inviteProblemMessage(result.reason) };
  }

  const shouldCreateUser = purpose === "signup";
  const { error } =
    contact.kind === "email"
      ? await supabase.auth.signInWithOtp({ email: contact.email, options: { shouldCreateUser } })
      : await supabase.auth.signInWithOtp({ phone: contact.phone, options: { shouldCreateUser } });
  if (error) return { error: sendCodeErrorMessage(error, purpose) };
  return {};
}

export async function sendCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const purpose: OtpPurpose = formData.get("purpose") === "signup" ? "signup" : "login";
  const kind: ContactKind = formData.get("kind") === "phone" ? "phone" : "email";
  const parsed = parseContact(kind, String(formData.get("contact") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  const result = await deliverCode(parsed.contact, purpose);
  if (result.error) return { error: result.error };

  await setOtpState({ contact: parsed.contact, purpose, sentAt: Date.now() });
  redirect("/verify");
}

export async function resendCode(_prev: FormState): Promise<FormState> {
  const otp = await getOtpState();
  if (!otp) redirect("/login");
  const result = await deliverCode(otp.contact, otp.purpose);
  if (result.error) return { error: result.error };
  const sentAt = Date.now();
  await setOtpState({ ...otp, sentAt });
  return { notice: `${contactLabel(otp.contact)} にコードを送り直しました`, sentAt };
}

export async function verifyCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const otp = await getOtpState();
  if (!otp) redirect("/login");
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (token.length !== 6) return { error: "6桁のコードを入力してください。" };

  const supabase = await createClient();
  const { error } =
    otp.contact.kind === "email"
      ? await supabase.auth.verifyOtp({ email: otp.contact.email, token, type: "email" })
      : await supabase.auth.verifyOtp({ phone: otp.contact.phone, token, type: "sms" });
  if (error) return { error: verifyErrorMessage(error) };

  await clearFlowCookies("otp");
  // 行き先（ホーム／参加手続き）は "/" の側で判定する
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
