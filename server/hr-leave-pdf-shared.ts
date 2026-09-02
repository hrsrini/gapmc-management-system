/** Server-side leave PDF helpers (re-export shared display rules). */
export {
  employeeHonorific,
  formatLeaveCopyToLine,
  formatLeaveOrderDateDisplay as formatLeaveOrderDate,
} from "@shared/hr-leave-display";

/** Today's date on the sanction order header: DD/MM/YYYY. */
export function formatLeaveOrderDateToday(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
