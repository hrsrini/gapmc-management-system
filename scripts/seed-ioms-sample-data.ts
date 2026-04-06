/**
 * Seed sample IOMS records for demo (rent invoices, vouchers, commodities, expenditure heads, farmers, transactions,
 * fleet, construction, dak, check post, HR, ledger, receipts, MSP, fee rates, etc.).
 * Also seeds employee users with different roles (DO, DV, DA, READ_ONLY) for role-wise login testing.
 * Run after db:push and seed-ioms-m10. Usage: npm run db:seed-ioms-sample
 *
 * Role-wise logins (password for all: User@1234):
 *   do@gapmc.local      → Data Originator (DO)
 *   dv@gapmc.local      → Data Verifier (DV)
 *   da@gapmc.local      → Data Approver (DA)
 *   readonly@gapmc.local → Read Only
 *   admin@gapmc.local    → System Admin (from seed-ioms-m10; password: Apmc@2026)
 */
import "dotenv/config";
import { hash } from "bcryptjs";
import { db } from "../server/db";
import {
  yards,
  users,
  roles,
  userRoles,
  userYards,
  expenditureHeads,
  rentInvoices,
  paymentVouchers,
  commodities,
  farmers,
  purchaseTransactions,
  employees,
  attendances,
  timesheets,
  ltcClaims,
  taDaClaims,
  marketFeeRates,
  vehicles,
  vehicleTripLog,
  vehicleFuelRegister,
  vehicleMaintenance,
  works,
  worksBills,
  amcContracts,
  landRecords,
  fixedAssets,
  dakInward,
  dakOutward,
  dakActionLog,
  checkPostInward,
  checkPostOutward,
  exitPermits,
  checkPostBankDeposits,
  rentDepositLedger,
  iomsReceipts,
  mspSettings,
  slaConfig,
  traderLicences,
  assets,
  assetAllotments,
  traderBlockingLog,
  creditNotes,
  advanceRequests,
  recruitment,
  leaveRequests,
} from "../shared/db-schema";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";

const EMPLOYEE_USER_PASSWORD = "User@1234";

async function seed() {
  const now = new Date().toISOString();
  const [firstYard] = await db.select({ id: yards.id }).from(yards).limit(1);
  const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@gapmc.local")).limit(1);
  const yardId = firstYard?.id ?? nanoid();
  const userId = adminUser?.id ?? "system";

  if (!firstYard) {
    console.log("No yards found. Run npm run db:seed-ioms-m10 first.");
    process.exit(1);
  }

  const allYards = await db.select({ id: yards.id }).from(yards);
  const yardIds = allYards.map((y) => y.id);

  // ----- Trader licences (M-02) - for Licences, Blocking log, Allotments, Transactions -----
  const licenceCount = await db.select().from(traderLicences).limit(3);
  let licenceId1: string | null = null;
  if (licenceCount.length === 0) {
    const lic1 = nanoid();
    const lic2 = nanoid();
    await db.insert(traderLicences).values([
      {
        id: lic1,
        licenceNo: "LIC-2025-001",
        firmName: "Sample Traders & Co",
        firmType: "Partnership",
        yardId,
        contactName: "Ramesh Trader",
        mobile: "9876543210",
        email: "sample@trader.local",
        licenceType: "Associated",
        feeAmount: 500,
        validFrom: "2025-04-01",
        validTo: "2026-03-31",
        status: "Active",
        isBlocked: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: lic2,
        licenceNo: "LIC-2025-002",
        firmName: "Green Agri Traders",
        yardId: yardIds[1] ?? yardId,
        contactName: "Sunita Green",
        mobile: "9876543211",
        licenceType: "Functionary",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    licenceId1 = lic1;
    console.log("Seeded trader licences");
  } else {
    licenceId1 = licenceCount[0].id;
  }
  const sampleLicenceId = licenceId1 ?? (await db.select({ id: traderLicences.id }).from(traderLicences).limit(1))[0]?.id ?? "SAMPLE-LIC-001";

  // ----- Expenditure heads (M-06) -----
  const existingHeads = await db.select().from(expenditureHeads).limit(5);
  if (existingHeads.length === 0) {
    await db.insert(expenditureHeads).values([
      { id: nanoid(), code: "SAL", description: "Salary", category: "Payroll", isActive: true },
      { id: nanoid(), code: "OPS", description: "Operational Expense", category: "Operations", isActive: true },
      { id: nanoid(), code: "MNT", description: "Maintenance", category: "Operations", isActive: true },
    ]);
    console.log("Seeded expenditure heads");
  }
  const [head1] = await db.select({ id: expenditureHeads.id }).from(expenditureHeads).limit(1);
  const expenditureHeadId = head1?.id ?? nanoid();

  // ----- Commodities (M-04) -----
  const existingCommodities = await db.select().from(commodities).limit(5);
  if (existingCommodities.length === 0) {
    await db.insert(commodities).values([
      { id: nanoid(), name: "Rice", variety: "Paddy", unit: "Quintal", gradeType: "FAQ", isActive: true },
      { id: nanoid(), name: "Coconut", unit: "Nos", isActive: true },
    ]);
    console.log("Seeded commodities");
  }
  const [comm1] = await db.select({ id: commodities.id }).from(commodities).limit(1);
  const commodityId = comm1?.id ?? nanoid();

  // ----- Rent invoices (M-03) - sample -----
  const rentCount = await db.select().from(rentInvoices);
  if (rentCount.length < 3) {
    const placeholders = { allotmentId: "ALLOT-1", tenantLicenceId: "LIC-1", assetId: "ASSET-1" };
    await db.insert(rentInvoices).values([
      {
        id: nanoid(),
        ...placeholders,
        yardId,
        periodMonth: "2025-04",
        rentAmount: 5000,
        cgst: 450,
        sgst: 450,
        totalAmount: 5900,
        status: "Draft",
        doUser: userId,
        dvUser: null,
        daUser: null,
        isGovtEntity: false,
      },
      {
        id: nanoid(),
        ...placeholders,
        yardId: yardIds[1] ?? yardId,
        periodMonth: "2025-03",
        rentAmount: 5000,
        cgst: 450,
        sgst: 450,
        totalAmount: 5900,
        status: "Verified",
        doUser: userId,
        dvUser: userId,
        daUser: null,
        isGovtEntity: false,
      },
      {
        id: nanoid(),
        ...placeholders,
        yardId: yardIds[2] ?? yardId,
        periodMonth: "2025-02",
        rentAmount: 6000,
        cgst: 540,
        sgst: 540,
        totalAmount: 7080,
        status: "Approved",
        doUser: userId,
        dvUser: userId,
        daUser: userId,
        approvedAt: now,
        isGovtEntity: false,
      },
    ]);
    console.log("Seeded sample rent invoices");
  }
  const [firstRentInvoice] = await db.select({ id: rentInvoices.id }).from(rentInvoices).limit(1);

  // ----- Credit notes (M-03) -----
  const creditNoteCount = await db.select().from(creditNotes).limit(2);
  if (creditNoteCount.length === 0 && firstRentInvoice?.id) {
    await db.insert(creditNotes).values([
      { id: nanoid(), creditNoteNo: `CN-2025-${Date.now().toString().slice(-6)}`, invoiceId: firstRentInvoice.id, reason: "Rent adjustment", amount: 500, status: "Draft", daUser: null },
    ]);
    console.log("Seeded credit notes");
  }

  // ----- Payment vouchers (M-06) - sample -----
  const voucherCount = await db.select().from(paymentVouchers);
  if (voucherCount.length < 3) {
    await db.insert(paymentVouchers).values([
      {
        id: nanoid(),
        voucherType: "OperationalExpense",
        yardId,
        expenditureHeadId,
        payeeName: "Sample Vendor A",
        amount: 15000,
        status: "Draft",
        doUser: userId,
        dvUser: null,
        daUser: null,
        createdAt: now,
      },
      {
        id: nanoid(),
        voucherType: "ContractorBill",
        yardId: yardIds[1] ?? yardId,
        expenditureHeadId,
        payeeName: "Contractor B",
        amount: 25000,
        status: "Verified",
        doUser: userId,
        dvUser: userId,
        daUser: null,
        createdAt: now,
      },
      {
        id: nanoid(),
        voucherType: "OperationalExpense",
        yardId: yardIds[2] ?? yardId,
        expenditureHeadId,
        payeeName: "Vendor C",
        amount: 10000,
        status: "Approved",
        doUser: userId,
        dvUser: userId,
        daUser: userId,
        createdAt: now,
      },
    ]);
    console.log("Seeded sample payment vouchers");
  }
  const [firstVoucher] = await db.select({ id: paymentVouchers.id }).from(paymentVouchers).limit(1);

  // ----- Farmers (M-04) - sample -----
  const farmerCount = await db.select().from(farmers).limit(3);
  if (farmerCount.length === 0) {
    await db.insert(farmers).values([
      { id: nanoid(), name: "Sample Farmer 1", village: "Village A", district: "North Goa", yardId },
      { id: nanoid(), name: "Sample Farmer 2", village: "Village B", district: "South Goa", yardId: yardIds[1] ?? yardId },
    ]);
    console.log("Seeded sample farmers");
  }
  const [farmer1] = await db.select({ id: farmers.id }).from(farmers).limit(1);
  const farmerId = farmer1?.id ?? null;

  // ----- Purchase transactions (M-04) - sample -----
  const txCount = await db.select().from(purchaseTransactions).limit(2);
  if (txCount.length === 0) {
    await db.insert(purchaseTransactions).values({
      id: nanoid(),
      transactionNo: `TXN-${Date.now()}-1`,
      yardId,
      commodityId,
      traderLicenceId: sampleLicenceId,
      quantity: 10,
      unit: "Quintal",
      declaredValue: 25000,
      marketFeePercent: 1,
      marketFeeAmount: 250,
      purchaseType: "Direct",
      transactionDate: new Date().toISOString().slice(0, 10),
      status: "Draft",
      farmerId,
      parentTransactionId: null,
      entryKind: "Original",
    });
    console.log("Seeded sample purchase transaction");
  }

  // ----- Employees (M-01) - for attendance, timesheets, claims, and role users -----
  const empCount = await db.select().from(employees).limit(5);
  let employeeId1: string | null = null;
  if (empCount.length === 0) {
    const e1 = nanoid();
    const e2 = nanoid();
    const e3 = nanoid();
    const e4 = nanoid();
    await db.insert(employees).values([
      {
        id: e1,
        firstName: "Ramesh",
        surname: "Naik",
        designation: "Clerk",
        yardId,
        employeeType: "Regular",
        joiningDate: "2020-04-01",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: e2,
        firstName: "Sunita",
        surname: "Desai",
        designation: "Officer",
        yardId: yardIds[1] ?? yardId,
        employeeType: "Regular",
        joiningDate: "2021-06-15",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: e3,
        firstName: "Vijay",
        surname: "Kumar",
        designation: "Senior Officer",
        yardId,
        employeeType: "Regular",
        joiningDate: "2019-01-10",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: e4,
        firstName: "Lakshmi",
        surname: "Nair",
        designation: "Assistant",
        yardId: yardIds[1] ?? yardId,
        employeeType: "Regular",
        joiningDate: "2022-03-01",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    employeeId1 = e1;
    console.log("Seeded sample employees");
  } else {
    employeeId1 = empCount[0].id;
  }
  const empIdForClaims = employeeId1 ?? (await db.select({ id: employees.id }).from(employees).limit(1))[0]?.id;

  // ----- Employee users (role-wise login): DO, DV, DA, READ_ONLY; password User@1234 -----
  const roleTiers = ["DO", "DV", "DA", "READ_ONLY"] as const;
  const employeeUserSpecs: {
    email: string;
    username: string;
    name: string;
    roleTier: (typeof roleTiers)[number];
  }[] = [
    { email: "do@gapmc.local", username: "do", name: "Ramesh Naik (DO)", roleTier: "DO" },
    { email: "dv@gapmc.local", username: "dv", name: "Sunita Desai (DV)", roleTier: "DV" },
    { email: "da@gapmc.local", username: "da", name: "Vijay Kumar (DA)", roleTier: "DA" },
    { email: "readonly@gapmc.local", username: "readonly", name: "Lakshmi Nair (Read Only)", roleTier: "READ_ONLY" },
  ];
  const roleRows = await db.select({ id: roles.id, tier: roles.tier }).from(roles);
  const roleIdByTier: Record<string, string> = {};
  for (const r of roleRows) roleIdByTier[r.tier] = r.id;
  let allEmps = await db.select({ id: employees.id, firstName: employees.firstName, surname: employees.surname }).from(employees).orderBy(asc(employees.id));
  if (allEmps.length < 4) {
    const extra = 4 - allEmps.length;
    for (let k = 0; k < extra; k++) {
      const eId = nanoid();
      await db.insert(employees).values({
        id: eId,
        firstName: k === 0 ? "Vijay" : "Lakshmi",
        surname: k === 0 ? "Kumar" : "Nair",
        designation: k === 0 ? "Senior Officer" : "Assistant",
        yardId: yardIds[k % yardIds.length] ?? yardId,
        employeeType: "Regular",
        joiningDate: "2019-01-10",
        status: "Active",
        createdAt: now,
        updatedAt: now,
      });
    }
    allEmps = await db.select({ id: employees.id, firstName: employees.firstName, surname: employees.surname }).from(employees).orderBy(asc(employees.id));
  }
  const firstFourEmps = allEmps.slice(0, 4);
  const passwordHash = await hash(EMPLOYEE_USER_PASSWORD, 10);
  for (let i = 0; i < employeeUserSpecs.length && i < firstFourEmps.length; i++) {
    const spec = employeeUserSpecs[i];
    const emp = firstFourEmps[i];
    const roleId = roleIdByTier[spec.roleTier];
    if (!roleId) continue;
    const existingUser = await db.select().from(users).where(eq(users.email, spec.email)).limit(1);
    if (existingUser.length > 0) {
      const ex = existingUser[0];
      if (!ex.passwordHash) {
        await db
          .update(users)
          .set({ passwordHash, employeeId: emp.id, updatedAt: now })
          .where(eq(users.id, ex.id));
        await db.update(employees).set({ userId: ex.id, updatedAt: now }).where(eq(employees.id, emp.id));
      } else if (!ex.username) {
        await db.update(users).set({ username: spec.username, updatedAt: now }).where(eq(users.id, ex.id));
      }
      continue;
    }
    const uid = nanoid();
    await db.insert(users).values({
      id: uid,
      email: spec.email,
      username: spec.username,
      name: spec.name,
      employeeId: emp.id,
      passwordHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userRoles).values({ userId: uid, roleId }).onConflictDoNothing();
    for (const yid of yardIds) {
      await db.insert(userYards).values({ userId: uid, yardId: yid }).onConflictDoNothing();
    }
    await db.update(employees).set({ userId: uid, updatedAt: now }).where(eq(employees.id, emp.id));
  }
  console.log(`Seeded employee users (do/dv/da/readonly@gapmc.local) with roles; password: ${EMPLOYEE_USER_PASSWORD}`);

  // ----- Market fee rates (M-04) -----
  const feeRateCount = await db.select().from(marketFeeRates).limit(2);
  if (feeRateCount.length === 0 && commodityId) {
    await db.insert(marketFeeRates).values([
      { id: nanoid(), commodityId, validFrom: "2025-04-01", validTo: "2026-03-31", feePercent: 1, yardId: null },
      { id: nanoid(), commodityId, validFrom: "2025-04-01", validTo: "2026-03-31", feePercent: 1.5, yardId },
    ]);
    console.log("Seeded market fee rates");
  }

  // ----- Assets (M-02): register, allotments, vacant -----
  const assetCount = await db.select().from(assets).limit(2);
  let assetId1: string | null = null;
  if (assetCount.length === 0) {
    const a1 = nanoid();
    const a2 = nanoid();
    await db.insert(assets).values([
      { id: a1, assetId: "MAPU/Shop-001", yardId, assetType: "Shop", complexName: "Block A", plinthAreaSqft: 200, isActive: true },
      { id: a2, assetId: "MAPU/Shop-002", yardId, assetType: "Shop", plinthAreaSqft: 150, isActive: true },
    ]);
    assetId1 = a1;
    console.log("Seeded assets");
  } else {
    assetId1 = assetCount[0].id;
  }
  const firstAssetId = assetId1 ?? (await db.select({ id: assets.id }).from(assets).limit(1))[0]?.id;
  const allotmentCount = await db.select().from(assetAllotments).limit(2);
  if (allotmentCount.length === 0 && firstAssetId && sampleLicenceId) {
    await db.insert(assetAllotments).values([
      { id: nanoid(), assetId: firstAssetId, traderLicenceId: sampleLicenceId, allotteeName: "Sample Traders & Co", fromDate: "2025-04-01", toDate: "2026-03-31", status: "Active", securityDeposit: 10000, doUser: userId, daUser: userId },
    ]);
    console.log("Seeded asset allotments");
  }
  const blockingLogCount = await db.select().from(traderBlockingLog).limit(1);
  if (blockingLogCount.length === 0 && sampleLicenceId) {
    await db.insert(traderBlockingLog).values({
      id: nanoid(),
      traderLicenceId: sampleLicenceId,
      action: "Unblocked",
      reason: "Sample unblock after verification",
      actionedBy: userId,
      actionedAt: now,
    });
    console.log("Seeded trader blocking log");
  }

  // ----- Fleet (M-07): vehicles, trips, fuel, maintenance -----
  const vehicleCount = await db.select().from(vehicles).limit(2);
  let vehicleId1: string | null = null;
  if (vehicleCount.length === 0) {
    const v1 = nanoid();
    const v2 = nanoid();
    await db.insert(vehicles).values([
      { id: v1, registrationNo: "GA-01-AB-1234", vehicleType: "Light", yardId, status: "Active", purchaseDate: "2023-01-15", purchaseValue: 450000 },
      { id: v2, registrationNo: "GA-02-CD-5678", vehicleType: "Truck", yardId: yardIds[1] ?? yardId, status: "Active", capacity: "3T" },
    ]);
    vehicleId1 = v1;
    await db.insert(vehicleTripLog).values([
      { id: nanoid(), vehicleId: v1, tripDate: "2025-02-01", purpose: "Office trip", route: "Mapusa-Margao", distanceKm: 35, fuelConsumed: 4 },
      { id: nanoid(), vehicleId: v1, tripDate: "2025-02-10", purpose: "Inspection", route: "Margao-Ponda", distanceKm: 22 },
    ]);
    await db.insert(vehicleFuelRegister).values([
      { id: nanoid(), vehicleId: v1, fuelDate: "2025-02-05", quantityLitres: 40, totalAmount: 3600 },
    ]);
    await db.insert(vehicleMaintenance).values([
      { id: nanoid(), vehicleId: v1, maintenanceType: "Scheduled", serviceDate: "2025-01-20", description: "Oil change", cost: 2500 },
    ]);
    console.log("Seeded fleet vehicles, trips, fuel, maintenance");
  }

  // ----- Construction (M-08): works, bills, AMC, land, fixed assets -----
  const workCount = await db.select().from(works).limit(2);
  let workId1: string | null = null;
  if (workCount.length === 0) {
    const w1 = nanoid();
    const w2 = nanoid();
    await db.insert(works).values([
      { id: w1, yardId, workType: "Civil", status: "InProgress", description: "Compound wall", contractorName: "ABC Builders", startDate: "2025-01-01", endDate: "2025-06-30", estimateAmount: 500000, workNo: "WRK-2025-001" },
      { id: w2, yardId: yardIds[1] ?? yardId, workType: "Electrical", status: "Planned", description: "Lighting", contractorName: "XYZ Electric", startDate: "2025-03-01", workNo: "WRK-2025-002" },
    ]);
    workId1 = w1;
    await db.insert(worksBills).values([
      { id: nanoid(), workId: w1, billNo: "B1", billDate: "2025-02-15", amount: 150000, cumulativePaid: 0, status: "Pending" },
    ]);
    console.log("Seeded construction works and bills");
  }
  const amcCount = await db.select().from(amcContracts).limit(2);
  if (amcCount.length === 0) {
    await db.insert(amcContracts).values([
      { id: nanoid(), yardId, contractorName: "Cool Air Ltd", amountPerPeriod: 12000, periodType: "Monthly", contractStart: "2025-01-01", contractEnd: "2025-12-31", status: "Active" },
      { id: nanoid(), yardId: yardIds[1] ?? yardId, contractorName: "Lift Services", amountPerPeriod: 8000, periodType: "Quarterly", contractStart: "2024-04-01", contractEnd: "2025-03-31", status: "Active" },
    ]);
    console.log("Seeded AMC contracts");
  }
  const landCount = await db.select().from(landRecords).limit(2);
  if (landCount.length === 0) {
    await db.insert(landRecords).values([
      { id: nanoid(), yardId, surveyNo: "SUR-001", village: "Village A", taluk: "Taluk X", district: "North Goa", areaSqm: 5000, createdBy: userId, createdAt: now },
      { id: nanoid(), yardId: yardIds[1] ?? yardId, surveyNo: "SUR-002", village: "Village B", areaSqm: 3000, createdBy: userId, createdAt: now },
    ]);
    console.log("Seeded land records");
  }
  const fixedCount = await db.select().from(fixedAssets).limit(2);
  if (fixedCount.length === 0) {
    await db.insert(fixedAssets).values([
      { id: nanoid(), yardId, assetType: "Generator", acquisitionDate: "2022-06-01", acquisitionValue: 250000, status: "Active", currentBookValue: 200000 },
      { id: nanoid(), yardId: yardIds[1] ?? yardId, assetType: "Weighbridge", acquisitionDate: "2021-01-15", acquisitionValue: 800000, status: "Active", usefulLifeYears: 15 },
    ]);
    console.log("Seeded fixed assets");
  }

  // ----- Dak (M-09): inward, outward, action log -----
  const dakInCount = await db.select().from(dakInward).limit(2);
  let inwardId1: string | null = null;
  if (dakInCount.length === 0) {
    const d1 = nanoid();
    const d2 = nanoid();
    await db.insert(dakInward).values([
      { id: d1, yardId, diaryNo: "DAK-IN-2025-001", receivedDate: "2025-02-01", fromParty: "Dept of Agriculture", subject: "Circular on MSP", modeOfReceipt: "Post", status: "Pending", assignedTo: "Clerk", deadline: "2025-02-28", createdAt: now },
      { id: d2, yardId: yardIds[1] ?? yardId, receivedDate: "2025-02-10", fromParty: "APMC HQ", subject: "Meeting notice", modeOfReceipt: "Email", status: "InProgress", createdAt: now },
    ]);
    inwardId1 = d1;
    await db.insert(dakActionLog).values([
      { id: nanoid(), inwardId: d1, actionBy: userId, actionDate: now, actionNote: "Received and filed", statusAfter: "Pending" },
    ]);
    await db.insert(dakOutward).values([
      { id: nanoid(), yardId, despatchNo: "DAK-OUT-2025-001", despatchDate: "2025-02-05", toParty: "Dept of Agriculture", subject: "Reply to circular", modeOfDespatch: "Post", inwardRefId: d1, createdAt: now },
    ]);
    console.log("Seeded dak inward, outward, action log");
  }

  // ----- Check post: inward, outward, exit permits, bank deposits -----
  const checkPostYards = await db.select({ id: yards.id }).from(yards).where(eq(yards.type, "CheckPost")).limit(1);
  const checkPostId = checkPostYards[0]?.id ?? yardId;
  const cpInwardCount = await db.select().from(checkPostInward).limit(1);
  let cpInwardId1: string | null = null;
  if (cpInwardCount.length === 0) {
    const cpi = nanoid();
    await db.insert(checkPostInward).values({
      id: cpi,
      checkPostId,
      transactionType: "Permanent",
      entryDate: "2025-02-01",
      status: "Verified",
      vehicleNumber: "GA-03-EF-9999",
    });
    cpInwardId1 = cpi;
    console.log("Seeded check post inward");
  }
  const cpInwardForRef = cpInwardId1 ?? (await db.select({ id: checkPostInward.id }).from(checkPostInward).limit(1))[0]?.id ?? "REF-1";
  const cpOutwardCount = await db.select().from(checkPostOutward).limit(2);
  if (cpOutwardCount.length === 0) {
    await db.insert(checkPostOutward).values([
      { id: nanoid(), checkPostId, inwardRefId: cpInwardForRef, entryDate: "2025-02-02", vehicleNumber: "GA-03-EF-9999" },
      { id: nanoid(), checkPostId, inwardRefId: "REF-2", entryDate: "2025-02-10" },
    ]);
    console.log("Seeded check post outward");
  }
  const exitPermitCount = await db.select().from(exitPermits).limit(1);
  const cpInwardForPermit = cpInwardId1 ?? (await db.select({ id: checkPostInward.id }).from(checkPostInward).limit(1))[0]?.id;
  if (exitPermitCount.length === 0 && cpInwardForPermit) {
    await db.insert(exitPermits).values({
      id: nanoid(),
      permitNo: "PERM-2025-001",
      inwardId: cpInwardForPermit,
      issuedDate: "2025-02-02",
      officerId: userId,
    });
    console.log("Seeded exit permits");
  }
  const bankDepCount = await db.select().from(checkPostBankDeposits).limit(1);
  if (bankDepCount.length === 0) {
    await db.insert(checkPostBankDeposits).values({
      id: nanoid(),
      checkPostId,
      depositDate: "2025-02-15",
      bankName: "SBI Mapusa",
      amount: 50000,
      status: "Recorded",
      narration: "Market fee collection",
    });
    console.log("Seeded check post bank deposits");
  }

  // ----- HR: attendance, timesheets, LTC/TA-DA claims -----
  if (empIdForClaims) {
    const attCount = await db.select().from(attendances).limit(3);
    if (attCount.length === 0) {
      await db.insert(attendances).values([
        { id: nanoid(), employeeId: empIdForClaims, date: "2025-02-24", action: "CheckIn", reason: null },
        { id: nanoid(), employeeId: empIdForClaims, date: "2025-02-24", action: "CheckOut", reason: null },
        { id: nanoid(), employeeId: empIdForClaims, date: "2025-02-25", action: "CheckIn" },
      ]);
      console.log("Seeded attendances");
    }
    const tsCount = await db.select().from(timesheets).limit(1);
    if (tsCount.length === 0) {
      await db.insert(timesheets).values({
        id: nanoid(),
        employeeId: empIdForClaims,
        periodStart: "2025-02-01",
        periodEnd: "2025-02-15",
        totalAttendance: 10,
        totalTimesheet: 80,
        status: "Draft",
      });
      console.log("Seeded timesheets");
    }
    const ltcCount = await db.select().from(ltcClaims).limit(1);
    if (ltcCount.length === 0) {
      await db.insert(ltcClaims).values({
        id: nanoid(),
        employeeId: empIdForClaims,
        claimDate: "2025-02-01",
        amount: 25000,
        period: "2024-25",
        status: "Pending",
      });
      console.log("Seeded LTC claims");
    }
    const tadaCount = await db.select().from(taDaClaims).limit(1);
    if (tadaCount.length === 0) {
      await db.insert(taDaClaims).values({
        id: nanoid(),
        employeeId: empIdForClaims,
        travelDate: "2025-02-10",
        purpose: "Official meeting at HQ",
        amount: 1500,
        status: "Pending",
      });
      console.log("Seeded TA/DA claims");
    }
  }

  // ----- Advance requests (M-06) -----
  const firstVoucherRow = firstVoucher ?? (await db.select({ id: paymentVouchers.id }).from(paymentVouchers).limit(1))[0];
  const advanceCount = await db.select().from(advanceRequests).limit(2);
  if (advanceCount.length === 0 && firstVoucherRow?.id && empIdForClaims) {
    await db.insert(advanceRequests).values([
      { id: nanoid(), voucherId: firstVoucherRow.id, employeeId: empIdForClaims, purpose: "Official travel advance", amount: 10000, recoverySchedule: "Monthly", recoveredAmount: 0 },
    ]);
    console.log("Seeded advance requests");
  }

  // ----- Recruitment (M-01) -----
  const recruitmentCount = await db.select().from(recruitment).limit(2);
  if (recruitmentCount.length === 0) {
    await db.insert(recruitment).values([
      { id: nanoid(), position: "Clerk", applicantName: "Vijay Kumar", qualification: "B.Com", appliedDate: "2025-02-01", status: "Shortlisted", decision: null },
      { id: nanoid(), position: "Office Assistant", applicantName: "Lakshmi Nair", appliedDate: "2025-02-10", status: "Applied", decision: null },
    ]);
    console.log("Seeded recruitment");
  }

  // ----- Leave requests (M-01) -----
  const leaveCount = await db.select().from(leaveRequests).limit(2);
  if (leaveCount.length === 0 && empIdForClaims) {
    const [doRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, "do@gapmc.local")).limit(1);
    const [dvRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, "dv@gapmc.local")).limit(1);
    await db.insert(leaveRequests).values([
      {
        id: nanoid(),
        employeeId: empIdForClaims,
        leaveType: "CL",
        fromDate: "2025-02-15",
        toDate: "2025-02-15",
        status: "Pending",
        doUser: doRow?.id ?? null,
        dvUser: null,
        approvedBy: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      },
      {
        id: nanoid(),
        employeeId: empIdForClaims,
        leaveType: "EL",
        fromDate: "2025-03-01",
        toDate: "2025-03-03",
        status: "Verified",
        doUser: doRow?.id ?? null,
        dvUser: dvRow?.id ?? null,
        approvedBy: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
      },
    ]);
    console.log("Seeded leave requests");
  }

  // ----- Rent deposit ledger (M-03) -----
  const ledgerCount = await db.select().from(rentDepositLedger).limit(2);
  if (ledgerCount.length === 0) {
    await db.insert(rentDepositLedger).values([
      { id: nanoid(), tenantLicenceId: "LIC-1", assetId: "ASSET-1", entryDate: "2025-01-01", entryType: "OpeningBalance", debit: 0, credit: 0, balance: 10000 },
      { id: nanoid(), tenantLicenceId: "LIC-1", assetId: "ASSET-1", entryDate: "2025-02-01", entryType: "Rent", debit: 5900, credit: 0, balance: 15900 },
    ]);
    console.log("Seeded rent deposit ledger");
  }

  // ----- IOMS receipts (M-05) -----
  const receiptCount = await db.select().from(iomsReceipts).limit(2);
  if (receiptCount.length === 0) {
    const u = nanoid().slice(0, 4);
    await db.insert(iomsReceipts).values([
      { id: nanoid(), receiptNo: `GAPLMB/SAMP/2526/Rent/${u}01`, yardId, revenueHead: "Rent", payerName: "Tenant A", amount: 5900, totalAmount: 5900, paymentMode: "Cash", status: "Paid", createdBy: userId, createdAt: now },
      { id: nanoid(), receiptNo: `GAPLMB/SAMP/2526/MarketFee/${u}02`, yardId, revenueHead: "MarketFee", amount: 500, totalAmount: 500, paymentMode: "Cash", status: "Paid", createdBy: userId, createdAt: now },
    ]);
    console.log("Seeded IOMS receipts");
  }

  // ----- MSP settings (M-02) -----
  const mspCount = await db.select().from(mspSettings).limit(2);
  if (mspCount.length === 0) {
    await db.insert(mspSettings).values([
      { id: nanoid(), commodity: "Rice", mspRate: 2100, validFrom: "2025-04-01", validTo: "2026-03-31", updatedBy: userId },
      { id: nanoid(), commodity: "Coconut", mspRate: 35, validFrom: "2025-04-01", validTo: "2026-03-31", updatedBy: userId },
    ]);
    console.log("Seeded MSP settings");
  }

  // ----- SLA config (M-10) - optional -----
  const slaCount = await db.select().from(slaConfig).limit(1);
  if (slaCount.length === 0) {
    await db.insert(slaConfig).values([
      { id: nanoid(), workflow: "VoucherApproval", hours: 48, alertRole: "DV" },
      { id: nanoid(), workflow: "RentInvoiceApproval", hours: 24, alertRole: "DA" },
      { id: nanoid(), workflow: "M-09 Dak deadline", hours: 24, alertRole: "DA" },
    ]);
    console.log("Seeded SLA config");
  }

  console.log("IOMS sample data seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
