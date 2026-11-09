"use client";

import { useActionState, useState } from "react";
import { createProfile, type WelcomeState } from "@/app/welcome/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function ProfileForm() {
  const [state, action] = useActionState<WelcomeState, FormData>(createProfile, {});
  const [name, setName] = useState("");
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="display_name">表示名</label>
        <input
          id="display_name"
          name="display_name"
          maxLength={40}
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：佐藤 太郎"
        />
        <p className="small muted">他のメンバーに表示される名前です。あとから変更できます。</p>
      </div>
      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="登録中…">次へ</SubmitButton>
    </form>
  );
}
