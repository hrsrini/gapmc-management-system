/**
 * POST /api/auth/login then GET /api/auth/me (same cookie jar), then GET /api/yards.
 *
 * Env:
 *   SMOKE_URL        — base URL (default http://127.0.0.1:5000)
 *   SMOKE_EMAIL      — login identifier (default admin@gapmc.local)
 *   SMOKE_PASSWORD   — if set, only this password is tried (CI / custom admin)
 *
 * Without SMOKE_PASSWORD, tries current seed password then legacy dev password
 * (databases seeded before BR-USR-10 still hash Apmc@2026).
 *
 * Usage:
 *   SMOKE_URL=http://127.0.0.1:5010 node scripts/login-smoke.mjs
 */
const base = process.env.SMOKE_URL?.replace(/\/$/, "") || "http://127.0.0.1:5000";
const email = (process.env.SMOKE_EMAIL || "admin@gapmc.local").trim();

const PASSWORD_CANDIDATES = process.env.SMOKE_PASSWORD
  ? [process.env.SMOKE_PASSWORD]
  : ["GapmcAdmin@2026!", "Apmc@2026"];

function absorbSetCookie(res, jar) {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /gapmc\.sid=([^;]+)/.exec(raw);
  if (m) jar.set("gapmc.sid", m[1]);
}

async function fetchWithJar(jar, url, opts = {}) {
  const h = new Headers(opts.headers || {});
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.set("Cookie", cookie);
  const res = await fetch(url, { ...opts, headers: h });
  absorbSetCookie(res, jar);
  return res;
}

const loginUrl = `${base}/api/auth/login`;
const meUrl = `${base}/api/auth/me`;
const yardsUrl = `${base}/api/yards`;

let loginRes;
let loginJson;
let usedPasswordLabel = "";

for (const password of PASSWORD_CANDIDATES) {
  const jar = new Map();
  const label = process.env.SMOKE_PASSWORD ? "SMOKE_PASSWORD" : password === "Apmc@2026" ? "legacy Apmc@2026" : "seed GapmcAdmin@2026!";
  loginRes = await fetchWithJar(jar, loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginText = await loginRes.text();
  try {
    loginJson = JSON.parse(loginText);
  } catch {
    loginJson = null;
  }
  if (loginRes.ok && loginJson?.user?.employeeId) {
    usedPasswordLabel = label;
    // Re-use same jar for /me and /yards
    console.log("login status", loginRes.status, `(password: ${label})`);
    console.log("employeeId", loginJson.user.employeeId);

    const meRes = await fetchWithJar(jar, meUrl, { method: "GET" });
    const meText = await meRes.text();
    let meJson;
    try {
      meJson = JSON.parse(meText);
    } catch {
      meJson = null;
    }
    console.log("me status", meRes.status, "me.user.employeeId", meJson?.user?.employeeId);

    const yardsRes = await fetchWithJar(jar, yardsUrl, { method: "GET" });
    const yardsText = await yardsRes.text();
    let yardsJson;
    try {
      yardsJson = JSON.parse(yardsText);
    } catch {
      yardsJson = null;
    }
    console.log("yards status", yardsRes.status, "count", Array.isArray(yardsJson) ? yardsJson.length : "n/a");

    const ok =
      meRes.ok &&
      meJson?.user?.employeeId &&
      yardsRes.ok &&
      Array.isArray(yardsJson);
    if (!ok) {
      console.error("[login-smoke] FAIL after login: /me or /api/yards not OK");
      process.exit(1);
    }
    if (label === "legacy Apmc@2026") {
      console.warn(
        "[login-smoke] Used legacy password. Run: npm run db:seed-ioms-m10  (re-hash admin to GapmcAdmin@2026!)",
      );
    }
    process.exit(0);
  }
}

console.log("login status", loginRes?.status ?? "n/a");
console.log("login code", loginJson?.code, "error", loginJson?.error);
console.log("[login-smoke] FAIL: could not log in after", PASSWORD_CANDIDATES.length, "password attempt(s).");
console.log(
  "Hint: set SMOKE_PASSWORD to your admin password, or run npm run db:seed-ioms-m10 against this database.",
);
process.exit(1);
