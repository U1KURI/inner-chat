"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "plain";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingLabel ?? "送信中…") : children}
    </button>
  );
}
