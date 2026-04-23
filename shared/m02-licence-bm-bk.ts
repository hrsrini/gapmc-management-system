/** M-02 Form BM: market functionary licence types that carry supplementary identity / certificate fields. */
export const BM_SUPPLEMENT_LICENCE_TYPES = ["Functionary", "Hamali", "Weighman", "AssistantTrader"] as const;

export function traderLicenceUsesBmSupplement(licenceType: string | null | undefined): boolean {
  if (!licenceType) return false;
  return (BM_SUPPLEMENT_LICENCE_TYPES as readonly string[]).includes(String(licenceType));
}
