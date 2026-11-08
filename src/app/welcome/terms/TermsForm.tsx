"use client";

import { useActionState } from "react";
import { acceptTerms, type WelcomeState } from "@/app/welcome/actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function TermsForm() {
  const [state, action] = useActionState<WelcomeState, FormData>(acceptTerms, {});
  return (
    <form action={action} className="stack">
      <label className="check">
        <input type="checkbox" name="agree" required />
        <span>利用規約と AI の利用に同意します</span>
      </label>
      <FormMessage error={state.error} />
      <SubmitButton pendingLabel="保存中…">同意して次へ</SubmitButton>
    </form>
  );
}
