import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  PHASES,
  STATUS_LABEL,
  relativeTime,
  type ConsultationListItem,
  type PendingInvitation,
  type Status,
} from "@/lib/consultations";
import { requireMember } from "@/lib/member";

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "mine", label: "自分の" },
  { key: "member", label: "関係者" },
] as const;
const STATUSES: (Status | "")[] = ["", "open", "in_progress", "resolved", "closed"];

function href(f: string, s: string) {
  const q = new URLSearchParams();
  if (f !== "all") q.set("f", f);
  if (s) q.set("s", s);
  const qs = q.toString();
  return qs ? `/?${qs}` : "/";
}

// B-01 相談一覧（ホーム）
export default async function Home({ searchParams }: { searchParams: Promise<{ f?: string; s?: string }> }) {
  const { supabase } = await requireMember();
  const sp = await searchParams;
  const filter = FILTERS.some((x) => x.key === sp.f) ? (sp.f as string) : "all";
  const status = STATUSES.includes((sp.s ?? "") as Status) ? (sp.s ?? "") : "";

  const [{ data: list, error }, { data: invites }] = await Promise.all([
    supabase.rpc("list_consultations", { p_filter: filter, p_status: status || null }),
    supabase.rpc("my_pending_invitations"),
  ]);
  const items = (list ?? []) as ConsultationListItem[];
  const pending = (invites ?? []) as PendingInvitation[];

  return (
    <AppShell active="consult">
      <div className="page-head">
        <h1>相談</h1>
        <Link href="/consultations/new" className="btn primary sm">
          ＋ 相談する
        </Link>
      </div>

      {pending.length > 0 && (
        <Link href={pending.length === 1 ? `/invitations/${pending[0].id}` : "/invitations"} className="banner">
          <span>✉ 関係者招待が{pending.length}件届いています</span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <div className="filters">
        <div className="seg" role="group" aria-label="表示する相談">
          {FILTERS.map((x) => (
            <Link key={x.key} href={href(x.key, status)} className="chip" aria-pressed={filter === x.key}>
              {x.label}
            </Link>
          ))}
        </div>
        <div className="seg" role="group" aria-label="ステータス">
          {STATUSES.map((s) => (
            <Link key={s || "any"} href={href(filter, s)} className="chip" aria-pressed={status === s}>
              {s ? STATUS_LABEL[s] : "すべての状態"}
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="msg error">相談を読み込めませんでした。時間をおいて開き直してください。</p>}

      {!error && items.length === 0 && (
        <div className="empty-state">
          <p>{filter === "all" && !status ? "まだ相談はありません。" : "条件に合う相談はありません。"}</p>
          <p className="small muted">ふわっとした困りごとでも大丈夫です。最初の相談を投稿してみましょう。</p>
          <Link href="/consultations/new" className="btn primary">
            相談する
          </Link>
        </div>
      )}

      <ul className="cards">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/consultations/${c.id}`} className="card consult-card">
              <span className="ttl">{c.title}</span>
              <span className="meta">
                <span className="chip">{c.visibility === "public" ? "🌐 全体" : `🔒 関係者のみ ${c.member_count}`}</span>
                <span className={`chip status-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                {!c.ai_enabled && <span className="chip">AI オフ</span>}
                <span>
                  {c.author_name}・{relativeTime(c.last_activity_at)}
                </span>
              </span>
              {c.excerpt && <span className="excerpt">{c.excerpt}</span>}
              {c.tags.length > 0 && (
                <span className="tags">
                  {c.tags.map((t) => (
                    <span key={t} className="tag">
                      #{t}
                    </span>
                  ))}
                </span>
              )}
              <span className="meta">
                <span>💬 {c.message_count}</span>
                {c.can_help_count > 0 && <span>🙋 話聞けます {c.can_help_count}</span>}
                {c.know_someone_count > 0 && <span>💡 詳しい人知ってます {c.know_someone_count}</span>}
              </span>
              {c.map_phase && <span className="where">📍 現在地：{PHASES[c.map_phase - 1]}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
