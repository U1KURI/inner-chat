"use client";

import { useActionState, useState } from "react";
import { sendCode, type FormState } from "@/app/auth/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function ContactForm({ purpose }: { purpose: "signup" | "login" }) {
  const [state, action] = useActionState<FormState, FormData>(sendCode, {});
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [value, setValue] = useState(""); // エラーで戻っても入力を残す
  const isEmail = kind === "email";

  return (
    <form action={action} className="stack">
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="kind" value={kind} />
      <div className="field">
        <label htmlFor="contact">{isEmail ? "メールアドレス" : "電話番号"}</label>
        <input
          key={kind}
          id="contact"
          name="contact"
          type={isEmail ? "email" : "tel"}
          inputMode={isEmail ? "email" : "tel"}
          autoComplete={isEmail ? "email" : "tel"}
          placeholder={isEmail ? "taro@example.com" : "090-1234-5678"}
          required
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="送信中…">確認コードを送る</SubmitButton>
      <div className="switch">
        {isEmail ? (
          <>
            <span className="muted">メールを使いたくない方は</span>
            <button type="button" className="link" onClick={() => { setKind("phone"); setValue(""); }}>
              電話番号（SMS）で{purpose === "signup" ? "登録" : "ログイン"}する
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => { setKind("email"); setValue(""); }}>
            メールアドレスで{purpose === "signup" ? "登録" : "ログイン"}する
          </button>
        )}
      </div>
    </form>
  );
}
