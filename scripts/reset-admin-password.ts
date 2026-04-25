/**
 * Reset admin@gapmc.local password to DEFAULT_ADMIN_PASSWORD from seed script.
 * Usage: npm run db:reset-admin-password
 */
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "@shared/db-schema";

const DEFAULT_ADMIN_PASSWORD = "GapmcAdmin@2026!";

async function main() {
  const now = new Date().toISOString();
  const passwordHash = await hash(DEFAULT_ADMIN_PASSWORD, 10);
  const updated = await db
    .update(users)
    .set({
      passwordHash,
      updatedAt: now,
      // If the account was disabled, keep disabledAt but re-enable sign-in by default for recovery.
      isActive: true,
      disabledAt: null,
    })
    .where(eq(users.email, "admin@gapmc.local"))
    .returning({ id: users.id, email: users.email });

  if (updated.length === 0) {
    console.error("No admin@gapmc.local user found.");
    process.exit(1);
  }
  console.log("Reset password for:", updated[0]);
  console.log("New password:", DEFAULT_ADMIN_PASSWORD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

