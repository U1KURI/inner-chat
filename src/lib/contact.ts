export type ContactKind = "email" | "phone";
export type Contact = { kind: "email"; email: string } | { kind: "phone"; phone: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 全角数字・記号を半角に
function toHalfWidth(s: string): string {
  return s.replace(/[０-９＋－ー（）]/g, (c) => {
    const map: Record<string, string> = { "＋": "+", "－": "-", "ー": "-", "（": "(", "）": ")" };
    return map[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  });
}

/**
 * 電話番号を E.164 形式（+819012345678）にする。
 * 「090-1234-5678」のような国内表記は日本の番号として扱う。
 */
export function normalizePhone(raw: string): string | null {
  const s = toHalfWidth(raw).trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (/^0\d{9,10}$/.test(digits)) return `+81${digits.slice(1)}`;
  return null;
}

export function parseContact(kind: ContactKind, raw: string): { contact: Contact } | { error: string } {
  if (kind === "email") {
    const email = toHalfWidth(raw).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: "メールアドレスの形式を確認してください" };
    return { contact: { kind: "email", email } };
  }
  const phone = normalizePhone(raw);
  if (!phone) return { error: "電話番号の形式を確認してください（例：090-1234-5678）" };
  return { contact: { kind: "phone", phone } };
}

export function contactLabel(c: Contact): string {
  if (c.kind === "email") return c.email;
  // +819012345678 → 090-1234-5678 風に表示
  if (c.phone.startsWith("+81")) {
    const d = "0" + c.phone.slice(3);
    return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d;
  }
  return c.phone;
}
