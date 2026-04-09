/**
 * POST /api/auth/login then GET /api/auth/me with same cookie jar.
 * Usage: SMOKE_URL=http://127.0.0.1:5002 node scripts/login-smoke.mjs
 */
const base = process.env.SMOKE_URL?.replace(/\/$/, "") || "http://127.0.0.1:5000";
const jar = new Map();

function absorbSetCookie(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /gapmc\.sid=([^;]+)/.exec(raw);
  if (m) jar.set("gapmc.sid", m[1]);
}

async function fetchWithJar(url, opts = {}) {
  const h = new Headers(opts.headers || {});
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.set("Cookie", cookie);
  const res = await fetch(url, { ...opts, headers: h });
  absorbSetCookie(res);
  return res;
}

const loginUrl = `${base}/api/auth/login`;
const meUrl = `${base}/api/auth/me`;

const loginRes = await fetchWithJar(loginUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: "admin", email: "admin", password: "Apmc@2026" }),
});

const loginText = await loginRes.text();
console.log("login status", loginRes.status);
console.log("login ct", loginRes.headers.get("content-type"));
let loginJson;
try {
  loginJson = JSON.parse(loginText);
} catch {
  loginJson = null;
}
console.log("login keys", loginJson && typeof loginJson === "object" ? Object.keys(loginJson) : null);
const u = loginJson?.user;
console.log(
  "user keys",
  u && typeof u === "object" ? Object.keys(u) : null,
);
console.log("employeeId", u?.employeeId, "employee_id", u?.employee_id);

const meRes = await fetchWithJar(meUrl, { method: "GET" });
const meText = await meRes.text();
console.log("me status", meRes.status);
let meJson;
try {
  meJson = JSON.parse(meText);
} catch {
  meJson = null;
}
console.log("me.user.employeeId", meJson?.user?.employeeId);

process.exit(loginRes.ok && u?.employeeId ? 0 : 1);
