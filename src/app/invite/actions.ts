"use server";

import { redirect } from "next/navigation";
import { setInviteToken } from "@/lib/flow";

export async function startSignup(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/login");
  await setInviteToken(token);
  redirect("/signup");
}
