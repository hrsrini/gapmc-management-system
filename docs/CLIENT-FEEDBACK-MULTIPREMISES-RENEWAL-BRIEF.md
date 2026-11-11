# Brief writeup — Client feedback changes (Multi-Premises Allotment, Renewal & Notices)

**Source:** Functional Requirement Document — Agreement Renewal, Rent Revision, Penalty Management + Multi-Premises allotment / vacation & F&F settlement feedback.

## What the client asked for (summary)

### A. Multi-premises under one agreement
- One tenant · one yard · **one agreement · many premises** (same location only).
- Searchable multi-select of vacant premises; allocated / unsafe / demolished not selectable.
- Common agreement dates, period number, rent-revision frequency, penalty terms.
- Premises-wise monthly rent (common rent + edit per line).
- Security deposit at **agreement** level, **split by area** for partial vacation/refund.
- DA approval activates tenancy for **all** premises on the agreement.

### B. Renewal, notice, period & rent revision
- Track expiry; **Renew / Notice open 2 months before expiry**.
- Renewal notice PDF with **dynamic generation date**; every generate/reprint is a **new dated version** (never overwrite); separate **dispatch** date.
- Auto-propose renewal from/to from **previous tenure** (not a fixed 11 months for all).
- Replace hard-coded “every 4th renewal” with configurable:
  - **Agreement Period Number** (Period 1 = original; +1 each renewal)
  - **Rent Revision Frequency (agreement periods)**  
  - Revision due when next period hits frequency+1, then every frequency periods (e.g. freq 3 → periods 4, 7, 10…).
- Block complete renewal until **approved** rent revision when due.
- Delay penalty from agreement clause/method/rate; verification & approval; full history.

### C. Nine renewal statuses
Active → Renewal Due → Notice Generated → Renewal Initiated → Renewal Pending → Renewed / Expired / Penalty Applicable / Rent Revision Pending.

### D. Vacation / eviction & Full & Final Settlement
- Three cases: premature intimation · end-date vacation · eviction by EO/GO order.
- Settlement as-of actual vacation/eviction date (rent, interest, other dues, SD, adjustments).
- Keep system-calculated vs proposed vs approved amounts separate; audit trail; Final Demand Notice + payment history when recoverable.

### E. MIS (FRD §10 — 12 reports)
1. Due for renewal (2 months)  
2. Expired not renewed  
3. Notices generated/printed  
4. Notice generation & dispatch history  
5. Successfully renewed  
6. Pending renewal  
7. Due for mandatory rent revision  
8. Rent revision history  
9. Premises-wise renewal history  
10. Delay period & penalty details  
11. Penalties pending verification/approval  
12. Premises-wise current agreement status  

---

## Implementation status (checked)

| Area | Status |
|------|--------|
| Multi-premises draft form + yard-scoped selector + area SD split | Done |
| Agreement Period Number + Rent Revision Frequency + block Complete until revision approved | Done |
| 2-month Renew/Notice window (UI + API) | Done (aligned to FRD) |
| Notice versioning, PDF, dispatch history | Done |
| Renewal tenure from prior agreement dates | Done |
| Flexible penalty methods (incl. fixed ₹/day) + approvals queue | Done |
| 9 renewal statuses + list KPIs | Done |
| History tabs (renewals / revisions / notices / penalties / docs / audit) | Done |
| MIS 12 reports per FRD §10 | Done (aligned to FRD list) |
| Vacation cases + F&F cards/adjustments + Final Demand Notice PDF | Done |
| Order PDF attach on eviction | UI placeholder (attach control present; full file store optional follow-up) |

---

## Fixes applied from this FRD pass
1. **`revisionDue`** now uses **next period** (period+1), matching “revision at start of Period N”.
2. **Renew / Notice** gated to the **2-month window** (and after expiry); API rejects out-of-window notice/start.
3. **MIS sidebar** remapped to **FRD §10** report list (not the earlier mock-only ordering).
4. **Penalty method** catalogue includes **FixedPerDay** (fixed amount × days of delay).
5. Detail screen frequency hint corrected (next revision at frequency+1, then every frequency periods).
