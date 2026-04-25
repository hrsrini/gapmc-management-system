/**
 * Disable privileged-role MFA enforcement via system_config.
 * Usage: npm run db:disable-mfa-enforcement
 */
import { db } from "../server/db";
import { systemConfig } from "@shared/db-schema";

async function main() {
  const now = new Date().toISOString();
  await db
    .insert(systemConfig)
    .values({
      key: "mfa_privileged_enforced",
      value: "false",
      updatedBy: "system",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: "false", updatedBy: "system", updatedAt: now },
    });
  console.log("Set system_config.mfa_privileged_enforced = false");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

