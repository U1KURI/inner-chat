import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { daysLeft, type PendingInvitation } from "@/lib/consultations";
import { requireMember } from "@/lib/member";

// 届いている関係者招待の一覧
export default async function InvitationsPage() {
  const { supabase } = await requireMember();
  const { data } = await supabase.rpc("my_pending_invitations");
  const items = (data ?? []) as PendingInvitation[];
  return (
    <AppShell active="consult">
      <div className="page-head">
        <Link href="/" className="back" aria-label="相談一覧に戻る">
          ←
        </Link>
        <h1>関係者への招待</h1>
      </div>
      {items.length === 0 && <p className="muted">届いている招待はありません。</p>}
      <ul className="cards">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/invitations/${i.id}`} className="card">
              <span className="ttl">{i.title}</span>
              <span className="meta">
                <span>{i.inviter}さんから</span>
                <span>あと{daysLeft(i.expires_at)}日</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
