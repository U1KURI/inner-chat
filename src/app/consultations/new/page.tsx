import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import type { Member } from "@/lib/consultations";
import { requireMember } from "@/lib/member";
import { NewConsultationForm } from "./NewConsultationForm";

// B-02 相談を投稿
export default async function NewConsultationPage() {
  const { supabase, profile } = await requireMember();
  const { data } = await supabase.rpc("member_directory");
  const members = ((data ?? []) as Member[]).filter((m) => m.id !== profile.id);

  return (
    <AppShell active="consult">
      <div className="page-head">
        <Link href="/" className="back" aria-label="相談一覧に戻る">
          ←
        </Link>
        <h1>相談する</h1>
      </div>
      <NewConsultationForm members={members} />
    </AppShell>
  );
}
