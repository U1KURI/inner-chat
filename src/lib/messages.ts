// サーバーやデータベースからのエラーを利用者向けの文に置き換える

export function inviteProblemMessage(reason: string | undefined): string {
  switch (reason) {
    case "expired":
      return "この招待リンクは有効期限が切れています。";
    case "used":
      return "この招待リンクはすでに使われています。";
    case "revoked":
      return "この招待リンクは無効になっています。";
    case "contact_required":
      return "メールアドレスか電話番号を入力してください。";
    default:
      return "招待リンクが見つかりません。リンクをもう一度確認してください。";
  }
}

type AuthLikeError = { message?: string; status?: number; code?: string } | null | undefined;

export function sendCodeErrorMessage(error: AuthLikeError, purpose: "signup" | "login"): string {
  const msg = error?.message ?? "";
  if (error?.status === 429 || /rate limit|too many|after \d+ seconds/i.test(msg)) {
    return "短い時間に何度も送信されました。少し待ってからもう一度お試しください。";
  }
  if (/招待制/.test(msg)) return msg; // 登録前フックからのメッセージ
  if (purpose === "login" && /signups? not allowed|user not found|otp_disabled/i.test(msg + (error?.code ?? ""))) {
    return "この連絡先は登録されていません。招待リンクから登録してください。";
  }
  if (/sms|phone provider|unsupported phone/i.test(msg)) {
    return "SMS を送れませんでした。電話番号を確認するか、メールアドレスでお試しください。";
  }
  return "確認コードを送れませんでした。時間をおいてもう一度お試しください。";
}

export function verifyErrorMessage(error: AuthLikeError): string {
  const msg = error?.message ?? "";
  if (error?.status === 429 || /rate limit|too many/i.test(msg)) {
    return "試行回数が多すぎます。少し待ってから、コードを再送してください。";
  }
  return "コードが正しくないか、有効期限が切れています。";
}

export function redeemErrorMessage(message: string | undefined): string {
  const msg = message ?? "";
  if (/no invitation/.test(msg)) return "この連絡先に届いている招待が見つかりません。招待リンクからやり直してください。";
  if (/no longer valid/.test(msg)) return "招待リンクが無効になりました。招待してくれた人に新しいリンクを頼んでください。";
  if (/terms/.test(msg)) return "利用規約への同意が必要です。";
  if (/already a member/.test(msg)) return "すでに登録が完了しています。";
  if (/display_name/.test(msg)) return "表示名は1〜40文字で入力してください。";
  return "登録できませんでした。時間をおいてもう一度お試しください。";
}
