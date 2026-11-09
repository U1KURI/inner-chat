"use client";

import { useActionState, useState } from "react";
import { saveSkills, type WelcomeState } from "@/app/welcome/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function SkillsForm({ popular }: { popular: string[] }) {
  const [state, action] = useActionState<WelcomeState, FormData>(saveSkills, {});
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [bio, setBio] = useState("");

  const toggle = (name: string) =>
    setSelected((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  const addDraft = () => {
    const name = draft.trim().slice(0, 30);
    if (name && !selected.some((n) => n.toLowerCase() === name.toLowerCase())) setSelected((cur) => [...cur, name]);
    setDraft("");
  };
  const options = [...popular, ...selected.filter((n) => !popular.includes(n))];

  return (
    <form action={action} className="stack">
      {selected.map((name) => (
        <input key={name} type="hidden" name="tag" value={name} />
      ))}

      <div className="field">
        <label htmlFor="new-tag">タグを追加</label>
        <div className="add-tag">
          <input
            id="new-tag"
            value={draft}
            maxLength={30}
            placeholder="例：Web制作、税務、子育て"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <button type="button" className="btn plain" onClick={addDraft}>
            追加
          </button>
        </div>
      </div>

      {options.length > 0 && (
        <div className="field">
          <span className="small muted">{popular.length > 0 ? "よく使われているタグ（タップで選択）" : "選んだタグ"}</span>
          <div className="chips">
            {options.map((name) => (
              <button
                key={name}
                type="button"
                className="chip"
                aria-pressed={selected.includes(name)}
                onClick={() => toggle(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="bio">ひとこと（任意）</label>
        <textarea
          id="bio"
          name="bio"
          maxLength={500}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="例：平日夜なら相談に乗れます"
        />
      </div>

      <FormMessage error={state.error} />
      <div className="btns">
        <a href="/" className="btn plain">
          あとで
        </a>
        <SubmitButton pendingLabel="保存中…">はじめる</SubmitButton>
      </div>
    </form>
  );
}
