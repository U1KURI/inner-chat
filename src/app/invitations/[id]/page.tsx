import Link from "next/link";
import { respondInvitation } from "@/app/consultations/actions";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";
import { PHASE_SHORT, daysLeft } from "@/lib/consultations";
import { requireMember } from "@/lib/member";

type Preview = {
  title: string;
  author: string;
  inviter: string;
  message: string | null;
  members: string[] | null;
  admin_can_view: boolean;
  ai_enabled: boolean;
  map_preview: { goal?: string; phase?: number; flow_summary?: string; open_issues?: string[] } | null;
  status: "pending" | "accepted" | "declined" | "canceled" | "expired";
  expires_at: string;
};

// B-09 関係者招待（承認前）。問い合わせ（B-10）は次の段階で追加
export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: failed } = await searchParams;
  const { supabase } = await requireMember();
  const { data, error } = /^[0-9a-f-]{36}$/i.test(id)
    ? await supabase.rpc("get_invitation_preview", { p_invitation_id: id })
    : { data: null, error: true };
  const p = data as Preview | null;

  if (error || !p) {
    return (
      <AppShell active="consult">
        <div className="empty-state">
          <h1>招待が見つかりません</h1>
          <Link href="/" className="btn plain">
            相談一覧に戻る
          </Link>
        </div>
      </AppShell>
    );
  }

  const open = p.status === "pending" && daysLeft(p.expires_at) > 0;
  const mp = p.map_preview;

  return (
    <AppShell active="consult">
      <div className="page-head">
        <Link href="/" className="back" aria-label="相談一覧に戻る">
          ←
        </Link>
        <h1>関係者への招待</h1>
      </div>
      <div className="stack detail">
        <p>
          <strong>{p.inviter}さん</strong>から招待が届いています
        </p>
        {p.message && <div className="card small">{p.message}</div>}
        <dl className="kv">
          <dt>相談</dt>
          <dd>{p.title}</dd>
          <dt>投稿者</dt>
          <dd>{p.author}</dd>
          <dt>関係者</dt>
          <dd>
            {(p.members ?? []).join("・")}（{p.members?.length ?? 0}人）
          </dd>
        </dl>
        <div className="meta">
          <span className="chip">🔒 関係者のみ</span>
          <span className="chip">管理者閲覧：{p.admin_can_view ? "許可" : "不可"}</span>
          <span className="chip">AI {p.ai_enabled ? "オン" : "オフ"}</span>
        </div>
        {mp && (
          <section className="map" aria-label="議論マップ（概要）">
            <div className="map-head">
              <span>📍 議論マップ（概要）</span>
            </div>
            <dl className="map-dl">
              {mp.goal && (
                <>
                  <dt>ゴール</dt>
                  <dd>{mp.goal}</dd>
                </>
              )}
              {mp.phase && (
                <>
                  <dt>現在地</dt>
                  <dd>{PHASE_SHORT[mp.phase - 1]}</dd>
                </>
              )}
              {mp.flow_summary && (
                <>
                  <dt>流れ</dt>
                  <dd>{mp.flow_summary}</dd>
                </>
              )}
            </dl>
          </section>
        )}
        <p className="small muted">本文とスレッドは参加後に見られます。</p>

        {failed && <p className="msg error">処理できませんでした。招待の状態が変わった可能性があります。</p>}

        {open ? (
          <>
            <p className="small muted">期限：あと{daysLeft(p.expires_at)}日</p>
            <form action={respondInvitation}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="accept" value="yes" />
              <SubmitButton pendingLabel="参加中…">参加する</SubmitButton>
            </form>
            <form action={respondInvitation}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="accept" value="no" />
              <SubmitButton variant="plain" pendingLabel="処理中…">
                辞退する
              </SubmitButton>
            </form>
          </>
        ) : (
          <p className="msg notice">この招待はすでに{p.status === "accepted" ? "承認" : "終了"}しています。</p>
        )}
      </div>
    </AppShell>
  );
}
