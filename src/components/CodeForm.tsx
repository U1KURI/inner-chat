"use client";

import { useActionState, useEffect, useState } from "react";
import { resendCode, verifyCode, type FormState } from "@/app/auth/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

const RESEND_WAIT_SECONDS = 60;

export function CodeForm({ sentAt }: { sentAt: number }) {
  const [verifyState, verifyAction] = useActionState<FormState, FormData>(verifyCode, {});
  const [resendState, resendAction] = useActionState<FormState>(resendCode, {});
  const lastSent = resendState.sentAt ?? sentAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const wait = Math.max(0, RESEND_WAIT_SECONDS - Math.floor((now - lastSent) / 1000));

  return (
    <div className="stack">
      <form action={verifyAction} className="stack">
        <div className="field">
          <label htmlFor="code">確認コード（6桁）</label>
          <input
            id="code"
            name="code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9０-９ ]*"
            maxLength={7}
            placeholder="123456"
            required
            autoFocus
          />
        </div>
        <FormMessage error={verifyState.error} />
        <SubmitButton pendingLabel="確認中…">確認する</SubmitButton>
      </form>

      <div className="hint">
        <p>届かない場合</p>
        <ul>
          <li>迷惑メールフォルダを確認してください</li>
          <li>
            <form action={resendAction} className="inline">
              {wait > 0 ? (
                <span className="muted">コードを再送する（あと {wait} 秒）</span>
              ) : (
                <button type="submit" className="link">
                  コードを再送する
                </button>
              )}
            </form>
          </li>
        </ul>
        <FormMessage error={resendState.error} notice={resendState.notice} />
      </div>
    </div>
  );
}
