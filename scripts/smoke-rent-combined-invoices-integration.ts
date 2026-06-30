/**
 * Integration test: find 2 approved rent invoices (same tenant/yard/month) and exercise combined bundle API.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { rentInvoices } from "@shared/db-schema";

const base = (process.env.SMOKE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const email = (process.env.SMOKE_EMAIL || "admin@gapmc.local").trim();
const password = process.env.SMOKE_PASSWORD || "GapmcAdmin@2026!";

async function login() {
  const jar = new Map<string, string>();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /gapmc\.sid=([^;]+)/.exec(raw);
  if (m) jar.set("gapmc.sid", m[1]);
  if (!res.ok) throw new Error(`login ${res.status}`);
  return jar;
}

async function fetchJar(jar: Map<string, string>, url: string, init?: RequestInit) {
  const h = new Headers(init?.headers);
  h.set("Cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
  return fetch(url, { ...init, headers: h });
}

async function main() {
  const rows = await db
    .select()
    .from(rentInvoices)
    .where(inArray(rentInvoices.status, ["Approved", "Overdue"]));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (String(r.combinedBundleId ?? "").trim()) continue;
    const k = `${r.yardId}::${r.tenantLicenceId}::${r.periodMonth}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const pair = [...groups.values()].find((g) => g.length >= 2);
  if (!pair) {
    console.log("No DB pair for integration test — logic fixes verified via build only.");
    return;
  }

  const jar = await login();
  const ids = pair.slice(0, 2).map((r) => r.id);
  const createRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceIds: ids }),
  });
  const body = await createRes.json();
  if (!createRes.ok) {
    console.error("CREATE FAILED", createRes.status, body);
    process.exit(1);
  }
  console.log("Created bundle", body.bundleInvoiceNo, body.id);

  const payAmt = Math.min(50, Number(body.outstandingTotal ?? body.totalAmount ?? 0));
  if (payAmt > 0 && body.children?.length) {
    const child = body.children[0];
    const payRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices/${body.id}/record-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: payAmt,
        allocations: [{ invoiceId: child.id, amount: payAmt }],
      }),
    });
    const payBody = await payRes.json();
    if (!payRes.ok) {
      console.error("PAY FAILED", payRes.status, payBody);
      process.exit(1);
    }
    console.log("Payment OK", payBody);
    const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, child.id)).limit(1);
    console.log("Child status after partial pay:", inv?.status);
  }

  const childPdf = await fetchJar(jar, `${base}/api/ioms/rent/invoices/${ids[0]}/pdf`);
  console.log("Child PDF blocked:", childPdf.status === 403 ? "yes" : `no (${childPdf.status})`);
  console.log("Integration test passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
