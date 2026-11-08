const { chromium } = require("playwright");
const fs = require("fs");
const S = process.env.SHOTS_DIR || ".";
const TOKEN = process.env.INVITE_TOKEN;
const BASE = "http://127.0.0.1:3100";
let n = 0;
const ok = (c, label) => { if (!c) throw new Error("FAIL: " + label); console.log("OK", ++n, label); };

(async () => {
  const browser = await chromium.launch();
  const mk = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ja-JP" });
  const shot = (page, name) => page.screenshot({ path: `${S}/shots/${name}.png`, fullPage: true });

  // 招待なし・無効なリンク
  let ctx = await mk(); let page = await ctx.newPage();
  await page.goto(BASE + "/signup");
  ok(await page.getByText("inner-chat は招待制です").isVisible(), "signup without invite is blocked");
  await page.goto(BASE + "/invite/not-a-real-token");
  ok(await page.getByText("招待リンクが見つかりません").isVisible(), "bad invite token shows A-07");
  await page.goto(BASE + "/");
  ok(page.url().endsWith("/login"), "home redirects to login when signed out");
  await ctx.close();

  // メールで登録
  ctx = await mk(); page = await ctx.newPage();
  await page.goto(`${BASE}/invite/${TOKEN}`);
  ok(await page.getByText("山田さんから招待が届いています").isVisible(), "invite page shows inviter");
  await shot(page, "01-invite");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.waitForURL("**/signup");
  await page.getByLabel("メールアドレス").fill("Sato@Example.com");
  await shot(page, "02-signup");
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await page.waitForURL("**/verify");
  ok(await page.getByText("sato@example.com").isVisible(), "verify page shows normalized email");
  ok(await page.getByText(/あと \d+ 秒/).isVisible(), "resend countdown shown");
  await page.getByLabel("確認コード（6桁）").fill("000000");
  await page.getByRole("button", { name: "確認する" }).click();
  await page.getByText("コードが正しくないか").waitFor();
  ok(true, "wrong code rejected");
  await page.getByLabel("確認コード（6桁）").fill("123456");
  await shot(page, "03-verify");
  await page.getByRole("button", { name: "確認する" }).click();
  await page.waitForURL("**/welcome/terms");
  ok(await page.getByText("山田さんからの招待で登録します").isVisible(), "terms page after verify");
  await shot(page, "04-terms");
  await page.getByLabel("利用規約と AI の利用に同意します").check();
  await page.getByRole("button", { name: "同意して次へ" }).click();
  await page.waitForURL("**/welcome/profile");
  await page.getByLabel("表示名").fill("佐藤 太郎");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.waitForURL("**/welcome/skills");
  ok(await page.getByRole("button", { name: "Web制作" }).isVisible(), "popular tags listed");
  await page.getByRole("button", { name: "Web制作" }).click();
  await page.getByLabel("タグを追加").fill("写真");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByLabel("ひとこと（任意）").fill("平日夜なら相談に乗れます");
  await shot(page, "05-skills");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.waitForURL(BASE + "/");
  ok(await page.getByText("ようこそ、佐藤 太郎さん").isVisible(), "home after onboarding");
  await shot(page, "06-home");
  await page.goto(BASE + "/welcome/terms");
  ok(page.url() === BASE + "/", "member cannot reopen onboarding");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL("**/login");
  ok(true, "logout");

  // ログイン（登録済み）
  await page.getByLabel("メールアドレス").fill("sato@example.com");
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await page.waitForURL("**/verify");
  await page.getByLabel("確認コード（6桁）").fill("123456");
  await page.getByRole("button", { name: "確認する" }).click();
  await page.waitForURL(BASE + "/");
  ok(await page.getByText("ようこそ、佐藤 太郎さん").isVisible(), "login as existing member");
  await ctx.close();

  // ログイン（未登録）
  ctx = await mk(); page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.getByLabel("メールアドレス").fill("stranger@example.com");
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await page.getByText("この連絡先は登録されていません").waitFor();
  ok(true, "unregistered login rejected");
  await shot(page, "07-login-unregistered");
  await ctx.close();

  // 電話番号で登録（同じリンクの2回目）
  ctx = await mk(); page = await ctx.newPage();
  await page.goto(`${BASE}/invite/${TOKEN}`);
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.waitForURL("**/signup");
  await page.getByRole("button", { name: "電話番号（SMS）で登録する" }).click();
  await page.getByLabel("電話番号").fill("０９０-１２３４-５６７８");
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await page.waitForURL("**/verify");
  ok(await page.getByText("090-1234-5678").isVisible(), "phone normalized (full-width input)");
  ok(await page.getByText("SMSで6桁").isVisible(), "SMS wording");
  await page.getByLabel("確認コード（6桁）").fill("123456");
  await page.getByRole("button", { name: "確認する" }).click();
  await page.waitForURL("**/welcome/terms");
  await page.getByRole("button", { name: "同意して次へ" }).click();
  ok(page.url().endsWith("/welcome/terms"), "cannot proceed without consent (required)");
  await page.getByLabel("利用規約と AI の利用に同意します").check();
  await page.getByRole("button", { name: "同意して次へ" }).click();
  await page.waitForURL("**/welcome/profile");
  await page.getByLabel("表示名").fill("高橋");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.waitForURL("**/welcome/skills");
  await page.getByRole("link", { name: "あとで" }).click();
  await page.waitForURL(BASE + "/");
  ok(await page.getByText("ようこそ、高橋さん").isVisible(), "phone signup complete");
  await ctx.close();

  // リンクの使用回数（2回）を使い切った
  ctx = await mk(); page = await ctx.newPage();
  await page.goto(`${BASE}/invite/${TOKEN}`);
  ok(await page.getByText("この招待リンクはすでに使われています").isVisible(), "used-up link shows A-07");
  await shot(page, "08-invite-used");
  await ctx.close();

  // アプリを通さず直接ユーザー作成を試みる → 登録前フックで拒否
  const r = await fetch("http://127.0.0.1:54321/auth/v1/otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bypass@example.com", create_user: true }) });
  const j = await r.json();
  ok(r.status === 403 && /招待制/.test(j.msg), "direct signup without invite blocked by hook");

  await browser.close();
  console.log("E2E PASSED", n);
})().catch((e) => { console.error(e.message); process.exit(1); });
