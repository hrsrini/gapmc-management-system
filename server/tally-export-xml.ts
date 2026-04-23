/**
 * GAPLMB → Tally **interchange** XML (v1): stable element layout for tooling / CA mapping.
 * Not a guaranteed drop-in for Tally Prime import without client-side transform — UAT with finance required.
 */

export type TallyExportFlatRow = {
  kind: string;
  docNo: string | null;
  date: string | null;
  yardId: string | null;
  revenueHead: string | null;
  payerName?: string | null;
  payeeName?: string | null;
  voucherType?: string | null;
  /** M-02 unified entity id on IOMS receipts (`TA:|TB:|AH:`); empty for payment vouchers. */
  unifiedEntityId?: string | null;
  amount: number | null;
  cgst: number | null;
  sgst: number | null;
  totalAmount: number | null;
  tallyLedgerName: string | null;
  tallyLedgerId: string | null;
  tallyGroup: string | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGapmcTallyInterchangeXmlV1(params: {
  rows: TallyExportFlatRow[];
  from?: string;
  to?: string;
  generatedAt: string;
}): string {
  const { rows, from, to, generatedAt } = params;
  const body = rows
    .map((r) => {
      const party = r.kind === "receipt" ? (r.payerName ?? "") : (r.payeeName ?? "");
      const attrs = [
        `kind="${esc(String(r.kind))}"`,
        `docNo="${esc(String(r.docNo ?? ""))}"`,
        `date="${esc(String(r.date ?? "").slice(0, 10))}"`,
        `yardId="${esc(String(r.yardId ?? ""))}"`,
        `revenueHead="${esc(String(r.revenueHead ?? ""))}"`,
        `partyName="${esc(String(party))}"`,
        `voucherType="${esc(String(r.voucherType ?? ""))}"`,
        `unifiedEntityId="${esc(String(r.unifiedEntityId ?? ""))}"`,
        `amount="${Number(r.amount ?? 0)}"`,
        `cgst="${Number(r.cgst ?? 0)}"`,
        `sgst="${Number(r.sgst ?? 0)}"`,
        `totalAmount="${Number(r.totalAmount ?? 0)}"`,
        `tallyLedgerId="${esc(String(r.tallyLedgerId ?? ""))}"`,
        `tallyLedgerName="${esc(String(r.tallyLedgerName ?? ""))}"`,
        `tallyGroup="${esc(String(r.tallyGroup ?? ""))}"`,
      ].join(" ");
      return `    <row ${attrs}/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gapmcTallyExport xmlns="urn:gapmc:tally-interchange:v1" version="1" generatedAt="${esc(generatedAt)}" dateFrom="${esc(from ?? "")}" dateTo="${esc(to ?? "")}">
  <meta>
    <generator>IOMS tally-export</generator>
    <note>Interchange format for mapping to Tally Prime / GST tools — validate with finance before production import.</note>
  </meta>
  <rows>
${body}
  </rows>
</gapmcTallyExport>
`;
}
