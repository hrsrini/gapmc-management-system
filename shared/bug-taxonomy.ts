import { z } from "zod";

export const BUG_TYPES = [
  "UI",
  "API",
  "Data",
  "Performance",
  "Security",
  "Integration",
  "Other",
] as const;

export type BugType = (typeof BUG_TYPES)[number];

export const BUG_SUBTYPES: Record<BugType, readonly string[]> = {
  UI: ["Layout", "Styling", "Navigation", "Forms", "Accessibility", "Other"],
  API: ["Error response", "Timeout", "Validation", "Authentication", "Other"],
  Data: ["Incorrect values", "Missing records", "Sync / import", "Export", "Other"],
  Performance: ["Slow page", "Slow API", "Memory / crash", "Other"],
  Security: ["Access control", "Session", "Injection / XSS", "Other"],
  Integration: ["Third-party", "Payment / receipt", "External API", "Other"],
  Other: ["General"],
};

export const BUG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export function isValidSubtype(type: string, subtype: string): boolean {
  const t = type as BugType;
  const list = BUG_SUBTYPES[t];
  return Boolean(list?.includes(subtype));
}

export const createBugBodySchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(500),
    description: z.string().trim().min(1, "Description is required").max(20000),
    bugType: z.enum(BUG_TYPES),
    bugSubtype: z.string().trim().min(1).max(120),
    severity: z.enum(BUG_SEVERITIES),
  })
  .refine((d) => isValidSubtype(d.bugType, d.bugSubtype), {
    message: "Subtype does not match selected type",
    path: ["bugSubtype"],
  });

export const patchBugSchema = z.object({
  status: z.enum(BUG_STATUSES).optional(),
  assignedToUserId: z.string().min(1).nullable().optional(),
  resolutionSummary: z.string().trim().max(10000).nullable().optional(),
});

export const bugCommentSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});
