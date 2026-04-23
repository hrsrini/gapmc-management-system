/**
 * Minimal smoke check: GET /api/health (no auth).
 * Run while dev server is up: npm run smoke
 * Optional: SMOKE_URL=http://127.0.0.1:5001 npm run smoke
 * Session smoke: same SMOKE_URL then `npm run login-smoke` (tries new + legacy admin passwords).
 */
const base = process.env.SMOKE_URL?.replace(/\/$/, "") || `http://127.0.0.1:${process.env.PORT || "5000"}`;
const url = `${base}/api/health`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`[smoke] FAIL ${res.status} ${url}`);
  process.exit(1);
}
const body = await res.json().catch(() => ({}));
console.log(`[smoke] OK ${url}`, body);
process.exit(0);
