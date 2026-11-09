import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DiscussionMapBox } from "@/components/DiscussionMapBox";
import { STATUS_LABEL, relativeTime, type ConsultationDetail } from "@/lib/consultations";
import { requireMember } from "@/lib/member";

// B-03 相談詳細（簡易版：スレッド・反応・設定は次の段階で追加）
export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const { data } = isUuid ? await supabase.rpc("get_consultation", { p_id: id }) : { data: null };
  const c = data as ConsultationDetail | null;

  if (!c) {
    return (
      <AppShell active="consult">
        <div className="empty-state">
          <h1>相談が見つかりません</h1>
          <p className="muted">削除されたか、閲覧できる範囲外の相談です。</p>
          <Link href="/" className="btn plain">
            相談一覧に戻る
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="consult">
      <div className="page-head">
        <Link href="/" className="back" aria-label="相談一覧に戻る">
          ←
        </Link>
        <span className="muted small">相談</span>
      </div>

      <article className="detail">
        <header className="stack-sm">
          <h1 className="detail-title">{c.title}</h1>
          <div className="meta">
            <span>
              {c.author_name}・{relativeTime(c.created_at)}
            </span>
            <span className={`chip status-${c.status}`}>{STATUS_LABEL[c.status]}</span>
            <span className="chip">{c.visibility === "public" ? "🌐 全体公開" : `🔒 関係者のみ ${c.members?.length ?? 0}人`}</span>
            {c.visibility === "restricted" && (
              <span className="chip">管理者閲覧：{c.admin_can_view ? "許可" : "不可"}</span>
            )}
            <span className="chip">AI {c.ai_enabled ? "オン" : "オフ"}</span>
          </div>
          {c.visibility === "restricted" && c.members && (
            <p className="small muted">
              関係者：{c.members.join("・")}
              {c.pending_invitees && c.pending_invitees.length > 0 && `（承認待ち：${c.pending_invitees.join("・")}）`}
            </p>
          )}
        </header>

        <DiscussionMapBox map={c.map} />

        {c.body ? <div className="body-text">{c.body}</div> : <p className="muted small">（本文なし）</p>}

        {c.tags.length > 0 && (
          <div className="tags">
            {c.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="meta">
          <span className="chip">🙋 話聞けます {c.can_help_count}</span>
          <span className="chip">💡 詳しい人知ってます {c.know_someone_count}</span>
          <span>💬 {c.message_count}</span>
        </div>

        <p className="hint">スレッドでの会話・反応・相談の設定は、次の段階で追加します。</p>
      </article>
    </AppShell>
  );
}
