# SRS §18-style open items (client confirmation)

Items below need **explicit GAPLMB confirmation** before design freeze (see SRS highlighting convention — amber / business rules). Replace placeholders after workshop with SRS **§18** row references.

1. **GST exempt list scope** — Confirm the seven named government office/godown holders is the **complete** list and whether **sub-units** (e.g. regional offices) map to the same category code.
2. **Track B / pre-receipt wording** — Align invoice vs receipt document titles for exempt entities with finance and SRS §6.
3. **Tally export format** — Confirm **CSV column order** vs Tally import (XML bridge, manual journal, or third-party tool).
4. **TDS and rent** — Rates, thresholds, and ledger names where PDF lists **TDS** under rent receipt lines.
5. **Maker–checker on admin config** — Whether **system_config** / fee changes require DA approval (SRS cross-cutting).
6. **SLA breach actions** — Email only vs SMS vs escalation roster (integrate with NIC gateway when available).
7. **Data retention periods** — Per SRS §16, confirm years per record class before building archival jobs.

_Update this file from SRS v2 **Section 18 — Open Items Requiring Client Confirmation** verbatim where possible._
