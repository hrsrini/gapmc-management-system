/** Standard dropdown labels for employee and trader licence selects across Intra. */

export type EmployeeSelectFields = {
  id: string;
  empId?: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
};

export type TraderLicenceSelectFields = {
  id: string;
  licenceNo?: string | null;
  firmName?: string | null;
  provisionalLicenceNo?: string | null;
  entityPublicCode?: string | null;
};

export function formatEmployeeDisplayName(employee: Pick<EmployeeSelectFields, "firstName" | "middleName" | "surname">): string {
  return [employee.firstName, employee.middleName, employee.surname].filter(Boolean).join(" ").trim();
}

/** Employee No. - Name of Employee */
export function formatEmployeeSelectLabel(employee: EmployeeSelectFields): string {
  const no = (employee.empId ?? employee.id).trim();
  const name = formatEmployeeDisplayName(employee);
  return name ? `${no} - ${name}` : no;
}

function traderLicenceNo(licence: TraderLicenceSelectFields): string {
  return (
    licence.licenceNo?.trim() ||
    licence.provisionalLicenceNo?.trim() ||
    licence.entityPublicCode?.trim() ||
    licence.id
  );
}

/** License No. - Name of Trader */
export function formatTraderLicenceSelectLabel(licence: TraderLicenceSelectFields): string {
  const no = traderLicenceNo(licence);
  const name = (licence.firmName ?? "").trim();
  return name ? `${no} - ${name}` : no;
}
