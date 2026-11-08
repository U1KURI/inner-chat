import { cookies } from "next/headers";
import type { Contact } from "@/lib/contact";

// 招待〜ログインの途中の状態を持つ Cookie（いずれも httpOnly）
const INVITE = "ic_invite"; // 招待トークン
const OTP = "ic_otp"; // 確認コードの送り先
const TERMS = "ic_terms"; // 同意した規約のバージョン

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type OtpPurpose = "signup" | "login";
export type OtpState = { contact: Contact; purpose: OtpPurpose; sentAt: number };

export async function setInviteToken(token: string) {
  (await cookies()).set(INVITE, token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}
export async function getInviteToken(): Promise<string | null> {
  return (await cookies()).get(INVITE)?.value ?? null;
}

export async function setOtpState(state: OtpState) {
  (await cookies()).set(OTP, JSON.stringify(state), { ...base, maxAge: 60 * 60 });
}
export async function getOtpState(): Promise<OtpState | null> {
  const raw = (await cookies()).get(OTP)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OtpState;
  } catch {
    return null;
  }
}

export async function setTermsAccepted(version: string) {
  (await cookies()).set(TERMS, version, { ...base, maxAge: 60 * 60 * 24 });
}
export async function getTermsAccepted(): Promise<string | null> {
  return (await cookies()).get(TERMS)?.value ?? null;
}

export async function clearFlowCookies(...names: ("invite" | "otp" | "terms")[]) {
  const store = await cookies();
  const map = { invite: INVITE, otp: OTP, terms: TERMS };
  names.forEach((n) => store.delete(map[n]));
}
