/**
 * Smoke test M-03 combined rent invoices API.
 * Usage: dotenv -e .env -- tsx scripts/smoke-rent-combined-invoices.ts
 */
const base = (process.env.SMOKE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const email = (process.env.SMOKE_EMAIL || "admin@gapmc.local").trim();
const password = process.env.SMOKE_PASSWORD || "GapmcAdmin@2026!";

function absorbSetCookie(res: Response, jar: Map<string, string>) {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /gapmc\.sid=([^;]+)/.exec(raw);
  if (m) jar.set("gapmc.sid", m[1]);
}

async function fetchJar(jar: Map<string, string>, url: string, init?: RequestInit) {
  const h = new Headers(init?.headers);
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.set("Cookie", cookie);
  const res = await fetch(url, { ...init, headers: h });
  absorbSetCookie(res, jar);
  return res;
}

async function main() {
  const jar = new Map<string, string>();
  const loginRes = await fetchJar(jar, `${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error("Login failed", loginRes.status, await loginRes.text());
    process.exit(1);
  }
  console.log("OK login");

  const listRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices`);
  if (!listRes.ok) {
    console.error("List combined failed", listRes.status, await listRes.text());
    process.exit(1);
  }
  const bundles = (await listRes.json()) as unknown[];
  console.log("OK list combined-invoices", bundles.length);

  const invRes = await fetchJar(jar, `${base}/api/ioms/rent/invoices`);
  if (!invRes.ok) {
    console.error("List invoices failed", invRes.status);
    process.exit(1);
  }
  let invoices = (await invRes.json()) as Array<{
    id: string;
    periodMonth: string;
    yardId: string;
    tenantLicenceId: string;
    status: string;
    combinedBundleId?: string | null;
    totalAmount?: number;
  }>;

  function findEligibleGroup(rows: typeof invoices) {
    const eligible = rows.filter(
      (i) =>
        (i.status === "Approved" || i.status === "Overdue") && !String(i.combinedBundleId ?? "").trim(),
    );
    const byKey = new Map<string, typeof eligible>();
    for (const inv of eligible) {
      const k = `${inv.yardId}::${inv.tenantLicenceId}::${inv.periodMonth}`;
      const arr = byKey.get(k) ?? [];
      arr.push(inv);
      byKey.set(k, arr);
    }
    return [...byKey.values()].find((g) => g.length >= 2) ?? null;
  }

  let group = findEligibleGroup(invoices);
  if (!group) {
    console.log("No eligible group — generating monthly drafts and approving…");
    const genRes = await fetchJar(jar, `${base}/api/ioms/rent/invoices/generate-monthly-drafts`, { method: "POST" });
    const genJson = await genRes.json().catch(() => ({}));
    console.log("generate-monthly-drafts", genRes.status, genJson);
    const invRes2 = await fetchJar(jar, `${base}/api/ioms/rent/invoices`);
    invoices = (await invRes2.json()) as typeof invoices;
    const drafts = invoices.filter((i) => i.status === "Draft" && !String(i.combinedBundleId ?? "").trim());
    const byTenant = new Map<string, typeof drafts>();
    for (const d of drafts) {
      const k = `${d.yardId}::${d.tenantLicenceId}::${d.periodMonth}`;
      const arr = byTenant.get(k) ?? [];
      arr.push(d);
      byTenant.set(k, arr);
    }
    const draftGroup = [...byTenant.values()].find((g) => g.length >= 2);
    if (draftGroup) {
      for (const inv of draftGroup.slice(0, 2)) {
        for (const status of ["Verified", "Approved"] as const) {
          const putRes = await fetchJar(jar, `${base}/api/ioms/rent/invoices/${inv.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });
          if (!putRes.ok) {
            console.error("Approve flow failed", inv.id, status, putRes.status, await putRes.text());
            process.exit(1);
          }
        }
      }
      const invRes3 = await fetchJar(jar, `${base}/api/ioms/rent/invoices`);
      invoices = (await invRes3.json()) as typeof invoices;
      group = findEligibleGroup(invoices);
    }
  }

  if (!group) {
    console.log("SKIP create — still no eligible invoice group after draft generation");
    return;
  }

  const createRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceIds: group.slice(0, 2).map((i) => i.id) }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    console.error("Create combined failed", createRes.status, createBody);
    process.exit(1);
  }
  const bundleId = String((createBody as { id?: string }).id ?? "");
  console.log("OK create bundle", bundleId, (createBody as { bundleInvoiceNo?: string }).bundleInvoiceNo);

  const pdfRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices/${bundleId}/pdf`);
  if (!pdfRes.ok) {
    console.error("Bundle PDF failed", pdfRes.status, await pdfRes.text());
    process.exit(1);
  }
  const pdfBuf = await pdfRes.arrayBuffer();
  console.log("OK bundle PDF bytes", pdfBuf.byteLength);

  const childId = group[0]!.id;
  const childPdfRes = await fetchJar(jar, `${base}/api/ioms/rent/invoices/${childId}/pdf`);
  if (childPdfRes.status !== 403) {
    console.error("Expected 403 for child PDF, got", childPdfRes.status);
    process.exit(1);
  }
  console.log("OK child individual PDF blocked");

  const dupRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceIds: group.slice(0, 2).map((i) => i.id) }),
  });
  if (dupRes.ok) {
    console.error("Expected duplicate create to fail");
    process.exit(1);
  }
  console.log("OK duplicate create rejected", dupRes.status);

  const detailRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices/${bundleId}`);
  const detail = (await detailRes.json()) as {
    outstandingTotal: number;
    children: Array<{ id: string; outstanding: number; totalAmount: number }>;
  };
  if (!detailRes.ok) {
    console.error("Detail failed", detailRes.status);
    process.exit(1);
  }
  if (detail.outstandingTotal <= 0) {
    console.log("SKIP payment — bundle already fully paid");
  } else {
    const payAmt = Math.min(100, detail.outstandingTotal);
    const allocations = detail.children
      .filter((c) => c.outstanding > 0)
      .slice(0, 1)
      .map((c) => ({ invoiceId: c.id, amount: Math.min(payAmt, c.outstanding) }));
    const payRes = await fetchJar(jar, `${base}/api/ioms/rent/combined-invoices/${bundleId}/record-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: payAmt, allocations }),
    });
    const payBody = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      console.error("Payment failed", payRes.status, payBody);
      process.exit(1);
    }
    console.log("OK partial payment", payBody);
  }

  console.log("All combined-invoice smoke checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
