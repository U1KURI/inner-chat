// Supabase の Auth / REST API の一部だけを模したテスト用サーバー。
// データは本物の Postgres（マイグレーション適用済み）に入り、RLS もそのまま効く。
const http = require("http");
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({ host: process.env.PGHOST, port: +process.env.PGPORT, user: "postgres", database: "t" });
const CODE = "123456";
const pendingOtp = new Map(); // key -> {createUser}
const tokens = new Map(); // access_token -> user id
const log = [];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, aud: "authenticated", role: "authenticated", email: user.email })}.sig`;
}
const phoneDigits = (p) => (p || "").replace(/\D/g, "");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}
function userFromReq(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  return tokens.get(t) || null;
}
async function asRole(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ""]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function getUserRow(where, val) {
  const r = await pool.query(`select id, email, phone from auth.users where ${where} = $1`, [val]);
  return r.rows[0] || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    // ---------- Auth ----------
    if (p === "/auth/v1/otp" && req.method === "POST") {
      const b = await readBody(req);
      const key = b.email ? `e:${b.email.toLowerCase()}` : `p:${phoneDigits(b.phone)}`;
      const existing = b.email ? await getUserRow("lower(email)", b.email.toLowerCase()) : await getUserRow("phone", phoneDigits(b.phone));
      if (!existing) {
        if (b.create_user === false) {
          log.push(["otp", key, "rejected: signups not allowed"]);
          return send(res, 422, { code: "otp_disabled", msg: "Signups not allowed for otp", error_code: "otp_disabled" });
        }
        // 本物の Auth と同じく、ユーザー作成の前にフックを呼ぶ
        const ev = { metadata: { name: "before-user-created" }, user: { email: b.email || "", phone: phoneDigits(b.phone) } };
        const c = await pool.connect();
        let out;
        try {
          await c.query("set role supabase_auth_admin");
          out = (await c.query("select public.hook_before_user_created($1) as r", [ev])).rows[0].r;
          await c.query("reset role");
        } finally {
          c.release();
        }
        if (out.error) {
          log.push(["otp", key, "hook rejected"]);
          return send(res, out.error.http_code, { code: out.error.http_code, msg: out.error.message, error_code: "hook" });
        }
        await pool.query("insert into auth.users (id, email, phone) values ($1, $2, $3)", [
          crypto.randomUUID(), b.email ? b.email.toLowerCase() : null, b.phone ? phoneDigits(b.phone) : null,
        ]);
      }
      pendingOtp.set(key, true);
      log.push(["otp", key, "sent"]);
      return send(res, 200, {});
    }
    if (p === "/auth/v1/verify" && req.method === "POST") {
      const b = await readBody(req);
      const key = b.email ? `e:${b.email.toLowerCase()}` : `p:${phoneDigits(b.phone)}`;
      if (!pendingOtp.get(key) || b.token !== CODE) {
        return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      }
      pendingOtp.delete(key);
      const u = b.email ? await getUserRow("lower(email)", b.email.toLowerCase()) : await getUserRow("phone", phoneDigits(b.phone));
      const access_token = jwt(u);
      tokens.set(access_token, u.id);
      const user = { id: u.id, aud: "authenticated", role: "authenticated", email: u.email || "", phone: u.phone || "", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return send(res, 200, { access_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: crypto.randomUUID(), user });
    }
    if (p === "/auth/v1/user" && req.method === "GET") {
      const uid = userFromReq(req);
      if (!uid) return send(res, 401, { code: 401, msg: "invalid JWT" });
      const u = await getUserRow("id", uid);
      return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email || "", phone: u.phone || "", app_metadata: {}, user_metadata: {} });
    }
    if (p === "/auth/v1/logout") {
      tokens.delete((req.headers.authorization || "").replace(/^Bearer /, ""));
      return send(res, 204);
    }

    // ---------- REST ----------
    const uid = userFromReq(req);
    const rpc = p.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const b = await readBody(req);
      const names = Object.keys(b);
      const args = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      const r = await asRole(uid, (c) => c.query(`select public.${rpc[1]}(${args}) as r`, names.map((n) => b[n])));
      return send(res, 200, r.rows[0].r);
    }
    const tbl = p.match(/^\/rest\/v1\/(\w+)$/);
    if (tbl) {
      const table = tbl[1];
      const filters = [];
      const vals = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "on_conflict", "columns"].includes(k)) continue;
        const m = v.match(/^eq\.(.*)$/);
        if (m) { vals.push(m[1]); filters.push(`${k} = $${vals.length}`); }
      }
      const where = filters.length ? `where ${filters.join(" and ")}` : "";
      if (req.method === "GET") {
        const sel = url.searchParams.get("select") || "*";
        let cols = sel;
        if (/profile_skills\(count\)/.test(sel)) {
          cols = sel.replace("profile_skills(count)", `(select json_build_array(json_build_object('count', count(*))) from public.profile_skills ps where ps.tag_id = ${table}.id) as profile_skills`);
        }
        const r = await asRole(uid, (c) => c.query(`select ${cols} from public.${table} ${where}`, vals));
        if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
          if (r.rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          return send(res, 200, r.rows[0]);
        }
        return send(res, 200, r.rows);
      }
      if (req.method === "POST") {
        let rows = await readBody(req);
        if (!Array.isArray(rows)) rows = [rows];
        const ignore = (req.headers.prefer || "").includes("ignore-duplicates");
        const conflict = url.searchParams.get("on_conflict");
        const out = await asRole(uid, async (c) => {
          const res2 = [];
          for (const row of rows) {
            const keys = Object.keys(row);
            const q = `insert into public.${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})` +
              (ignore && conflict ? ` on conflict (${conflict}) do nothing` : "") + " returning *";
            res2.push(...(await c.query(q, keys.map((k) => row[k]))).rows);
          }
          return res2;
        });
        return send(res, 201, (req.headers.prefer || "").includes("return=representation") ? out : undefined);
      }
      if (req.method === "PATCH") {
        const b = await readBody(req);
        const keys = Object.keys(b);
        const set = keys.map((k, i) => `${k} = $${vals.length + i + 1}`).join(", ");
        await asRole(uid, (c) => c.query(`update public.${table} set ${set} ${where}`, [...vals, ...keys.map((k) => b[k])]));
        return send(res, 204);
      }
    }
    if (p === "/__log") return send(res, 200, log);
    send(res, 404, { message: "not mocked: " + req.method + " " + p });
  } catch (e) {
    send(res, 400, { message: e.message, code: e.code });
  }
});
server.listen(54321, () => console.log("mock supabase on :54321"));
