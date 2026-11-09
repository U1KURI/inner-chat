export type Visibility = "public" | "restricted";
export type Status = "open" | "in_progress" | "resolved" | "closed";
export type MapState = "collecting" | "ready" | "disabled";

export type ConsultationListItem = {
  id: string;
  title: string;
  excerpt: string;
  visibility: Visibility;
  status: Status;
  ai_enabled: boolean;
  author_name: string;
  is_mine: boolean;
  created_at: string;
  last_activity_at: string;
  tags: string[];
  member_count: number;
  message_count: number;
  can_help_count: number;
  know_someone_count: number;
  map_state: MapState | null;
  map_phase: number | null;
};

export type DiscussionMap = {
  state: MapState;
  goal: string | null;
  phase: number | null;
  flow: string[];
  decided: string[];
  open_issues: string[];
  next_steps: { text: string; who?: string | null; who_name?: string | null }[] | string[];
  missing_items: { key: string; label: string; ok: boolean }[];
  updated_at: string;
  version: number;
};

export type ConsultationDetail = {
  id: string;
  title: string;
  body: string;
  visibility: Visibility;
  status: Status;
  admin_can_view: boolean;
  ai_enabled: boolean;
  author_name: string;
  is_author: boolean;
  is_member: boolean;
  created_at: string;
  tags: string[];
  members: string[] | null;
  pending_invitees: string[] | null;
  message_count: number;
  can_help_count: number;
  know_someone_count: number;
  map: DiscussionMap | null;
};

export type PendingInvitation = { id: string; title: string; inviter: string; expires_at: string };

export type Member = { id: string; display_name: string; availability: "open" | "busy" | "paused"; tags: string[] };

export const STATUS_LABEL: Record<Status, string> = {
  open: "募集中",
  in_progress: "進行中",
  resolved: "解決",
  closed: "クローズ",
};

export const PHASES = ["課題整理", "情報・選択肢集め", "検討・比較", "決定", "実行・フォロー"] as const;
export const PHASE_SHORT = ["課題整理", "情報集め", "検討", "決定", "実行"] as const;

// 材料がそろう前に出すチェック項目（AI がまだ判定していないときの既定）
export const DEFAULT_MISSING_ITEMS = [
  { key: "goal", label: "何をしたいか（ゴール）", ok: false },
  { key: "situation", label: "今の状況", ok: false },
  { key: "constraints", label: "期限や予算などの条件", ok: false },
  { key: "others", label: "投稿者以外の発言（1件以上）", ok: false },
];

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 2) return "昨日";
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function daysLeft(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000));
}
