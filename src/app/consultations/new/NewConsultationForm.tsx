"use client";

import { useActionState, useMemo, useState } from "react";
import { createConsultation, type NewConsultationState } from "@/app/consultations/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import type { Member } from "@/lib/consultations";

const AVAILABILITY: Record<Member["availability"], string> = {
  open: "相談受付中",
  busy: "ちょっと忙しい",
  paused: "休止中",
};

export function NewConsultationForm({ members }: { members: Member[] }) {
  const [state, action] = useActionState<NewConsultationState, FormData>(createConsultation, {});
  // エラーで戻ったときに入力が消えないよう、入力欄はすべて state で持つ
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adminCanView, setAdminCanView] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "restricted">("public");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const restricted = visibility === "restricted";
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.display_name.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [members, query]);

  const toggleMember = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, "").slice(0, 30);
    if (t && tags.length < 10 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
    setTagDraft("");
  };

  return (
    <form action={action} className="stack form-wide">
      <div className="field">
        <label htmlFor="title">タイトル</label>
        <input
          id="title"
          name="title"
          maxLength={100}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：店のWebサイトをなんとかしたい"
        />
      </div>

      <div className="field">
        <label htmlFor="body">内容（ふわっとで大丈夫です）</label>
        <textarea
          id="body"
          name="body"
          maxLength={10000}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="今困っていること、気になっていることを書いてください"
        />
      </div>
      <p className="hint">💡 やりたいこと／今の状況／期限や予算 が書いてあると、話が進みやすくなります</p>

      <fieldset className="field">
        <legend>公開範囲</legend>
        <label className="radio">
          <input
            type="radio"
            name="visibility"
            value="public"
            checked={!restricted}
            onChange={() => setVisibility("public")}
          />
          <span>🌐 全体に公開</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="visibility"
            value="restricted"
            checked={restricted}
            onChange={() => setVisibility("restricted")}
          />
          <span>🔒 関係者のみ</span>
        </label>

        {restricted && (
          <div className="indent stack">
            <div className="field">
              <label htmlFor="member-search">関係者を選ぶ（{selected.length}人選択中）</label>
              <input
                id="member-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・できることで検索"
              />
            </div>
            {members.length === 0 ? (
              <p className="small muted">まだ他のメンバーがいません。</p>
            ) : (
              <ul className="member-pick">
                {matches.map((m) => (
                  <li key={m.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="member"
                        value={m.id}
                        checked={selected.includes(m.id)}
                        onChange={() => toggleMember(m.id)}
                      />
                      <span>
                        {m.display_name} <span className="small muted">{AVAILABILITY[m.availability]}</span>
                        {m.tags.length > 0 && <span className="tags small">{m.tags.map((t) => `#${t}`).join(" ")}</span>}
                      </span>
                    </label>
                  </li>
                ))}
                {matches.length === 0 && <li className="small muted">該当するメンバーがいません</li>}
              </ul>
            )}
            {/* 検索で隠れた選択済みの人も送信する */}
            {selected
              .filter((id) => !matches.some((m) => m.id === id))
              .map((id) => (
                <input key={id} type="hidden" name="member" value={id} />
              ))}
            <p className="small muted">選んだ人には招待が届き、承認すると参加します。</p>
            <label className="check">
              <input
                type="checkbox"
                name="admin_can_view"
                checked={adminCanView}
                onChange={(e) => setAdminCanView(e.target.checked)}
              />
              <span>
                管理者の閲覧を許可する
                <span className="small muted block">
                  調整や仲裁が必要になった場合に備えて、管理者が内容を確認できるようにします
                </span>
              </span>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>AI</legend>
        <label className="check">
          <input
            type="checkbox"
            name="ai_enabled"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
          />
          <span>
            AI を使う
            <span className="small muted block">
              {aiEnabled
                ? "内容を AI が要約し、議論の流れを整理します。合いそうな人へのおすすめにも使います（全体公開のみ）"
                : "この相談は AI に送られません。議論マップは投稿者・関係者が手入力します。"}
            </span>
          </span>
        </label>
      </fieldset>

      <div className="field">
        <label htmlFor="tag-input">タグ（任意）</label>
        {tags.map((t) => (
          <input key={t} type="hidden" name="tag" value={t} />
        ))}
        <div className="add-tag">
          <input
            id="tag-input"
            value={tagDraft}
            maxLength={30}
            placeholder="例：Web制作"
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" className="btn plain" onClick={addTag}>
            追加
          </button>
        </div>
        {tags.length > 0 && (
          <div className="chips">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                aria-pressed="true"
                aria-label={`${t} を外す`}
                onClick={() => setTags(tags.filter((x) => x !== t))}
              >
                {t} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="投稿中…">投稿する</SubmitButton>
    </form>
  );
}
