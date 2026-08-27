/**
 * AI calling transcript — configurable by dialogue / capture type
 * (from Transcript_for_Trader_Assistant_recording.docx).
 */

export const TRADER_VOICE_TRANSCRIPT_CONFIG_KEY = "trader_voice_transcript_script";
/** Structured scenarios JSON in system_config. */
export const TRADER_VOICE_SCENARIOS_CONFIG_KEY = "trader_voice_transcript_scenarios";

export const VOICE_TRANSCRIPT_SCENARIO_IDS = [
  "verify",
  "capture_first",
  "capture_next",
  "capture_multi",
  "capture_incomplete",
  "correct_on_confirm",
  "correct_natural",
  "continue_long",
  "edit_earlier",
  "status",
  "stop",
  "submit",
  "verify_failure",
] as const;

export type VoiceTranscriptScenarioId = (typeof VOICE_TRANSCRIPT_SCENARIO_IDS)[number];

/** Maps dialogue type → voice-session API step the calling app should use. */
export type VoiceTranscriptApiStep =
  | "verify"
  | "session_create"
  | "lines_add"
  | "lines_update"
  | "session_status"
  | "submit"
  | "none";

export type VoiceTranscriptScenario = {
  id: VoiceTranscriptScenarioId;
  sortOrder: number;
  title: string;
  description: string;
  apiStep: VoiceTranscriptApiStep;
  enabled: boolean;
  body: string;
};

export type VoiceTranscriptScenariosConfig = {
  version: 1;
  scenarios: VoiceTranscriptScenario[];
};

function sc(
  partial: Omit<VoiceTranscriptScenario, "enabled"> & { enabled?: boolean },
): VoiceTranscriptScenario {
  return { enabled: true, ...partial };
}

export const TRADER_VOICE_SCENARIOS_DEFAULT: VoiceTranscriptScenariosConfig = {
  version: 1,
  scenarios: [
    sc({
      id: "verify",
      sortOrder: 1,
      title: "Greeting and trader verification",
      description: "Licence number + class, registered mobile, confirm firm and commodities.",
      apiStep: "verify",
      body: `**Assistant:**
Good morning. Welcome to the Trader Transaction Recording Service.

Please provide your **Trader License Number and Class**.

**Trader:**
My Trader License Number is **9898 Class A**.

**Assistant:**
Thank you. For verification, please provide your **registered mobile number**.

**Trader:**
My registered mobile number is **9098098908**.

**Assistant:**
Thank you. Your details have been successfully verified.

Your **Trader License Number is 9898 Class A, registered with name Prabhakar Shirodkar**.

Our records show that you primarily trade in **Coconut, Cashewnut, and Arecanut**.

Please confirm whether these details are correct by saying **Yes** or **No**.

**Trader:**
Yes, my details are correct.

**Assistant:**
Thank you. We can now start recording your transactions.

You may provide the transaction details. I will ask you only for information that is required or missing.`,
    }),
    sc({
      id: "capture_first",
      sortOrder: 2,
      title: "Capture first transaction",
      description: "Single purchase line: commodity, qty, farmer, place, rate — confirm total.",
      apiStep: "lines_add",
      body: `**Assistant:**
Please tell me about your first transaction.

You can provide the **commodity, quantity, farmer's name, place of purchase, and purchase rate** in one sentence.

**Trader:**
I purchased **1,000 coconuts** from Farmer **Mr. Sarvesh Naik from Curchorem** at **15 rupees per piece**.

**Assistant:**
Thank you. I understood the following:

You purchased **1,000 coconuts from Mr. Sarvesh Naik of Curchorem at 15 rupees per piece**.

The total purchase value is **15,000 rupees**.

Is this correct?

**Trader:**
Yes, it is correct.

**Assistant:**
Thank you. **Transaction 1 has been recorded successfully.**

Would you like to record another transaction?`,
    }),
    sc({
      id: "capture_next",
      sortOrder: 3,
      title: "Capture next transaction",
      description: "Additional single transaction after the first.",
      apiStep: "lines_add",
      body: `**Trader:**
Yes.

**Assistant:**
Please tell me the details of your next transaction.

**Trader:**
I purchased **500 kilos of Cashewnut** from **Mr. Ramesh Naik in Quepem** at **120 rupees per kilo**.

**Assistant:**
Thank you. I understood:

You purchased **500 kilos of Cashewnut from Mr. Ramesh Naik of Quepem at 120 rupees per kilo**.

The total purchase value is **60,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. **Transaction 2 has been recorded successfully.**

You have now recorded **2 transactions**.

Would you like to record another transaction?`,
    }),
    sc({
      id: "capture_multi",
      sortOrder: 4,
      title: "Multiple transactions in one statement",
      description: "Trader dictates several purchases; confirm each line separately.",
      apiStep: "lines_add",
      body: `**Trader:**
Yes. I have three more transactions.

**Assistant:**
Certainly. Please tell me the details of all three transactions.

**Trader:**
I purchased **800 coconuts from Mr. Prakash Naik in Margao at 14 rupees each**.

I also purchased **300 kilos of Arecanut from Mr. Suresh Naik in Ponda at 200 rupees per kilo**.

And I purchased **400 kilos of Cashewnut from Mr. Ganesh Naik in Canacona at 125 rupees per kilo**.

**Assistant:**
Thank you. I have identified three transactions.

**Transaction 3**

**800 coconuts from Mr. Prakash Naik in Margao at 14 rupees per piece**, totaling **11,200 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. Transaction 3 has been confirmed.

**Transaction 4**

**300 kilos of Arecanut from Mr. Suresh Naik in Ponda at 200 rupees per kilo**, totaling **60,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. Transaction 4 has been confirmed.

**Transaction 5**

**400 kilos of Cashewnut from Mr. Ganesh Naik in Canacona at 125 rupees per kilo**, totaling **50,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. Transaction 5 has been confirmed.

You now have **5 confirmed transactions**.

Would you like to record another transaction?`,
    }),
    sc({
      id: "capture_incomplete",
      sortOrder: 5,
      title: "Missing information",
      description: "Ask only for missing fields (rate, place, etc.), then confirm.",
      apiStep: "lines_add",
      body: `**Trader:**
Yes. I purchased **1,000 coconuts from Mr. Sarvesh Naik**.

**Assistant:**
Thank you. What was the **purchase rate per coconut**?

**Trader:**
15 rupees.

**Assistant:**
Thank you. And where was the purchase made?

**Trader:**
Curchorem.

**Assistant:**
Thank you.

You purchased **1,000 coconuts from Mr. Sarvesh Naik in Curchorem at 15 rupees per piece**, totaling **15,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. **Transaction 6 has been recorded successfully.**

Would you like to record another transaction?`,
    }),
    sc({
      id: "correct_on_confirm",
      sortOrder: 6,
      title: "Correction during confirmation",
      description: "Trader says No and corrects one field before the line is final.",
      apiStep: "lines_update",
      body: `**Assistant:**
You purchased **1,000 coconuts at 15 rupees per piece from Mr. Sarvesh Naik in Curchorem**, totaling **15,000 rupees**.

Is this correct?

**Trader:**
No. The quantity is **1,200 coconuts**.

**Assistant:**
Understood. I have changed the quantity to **1,200 coconuts**.

At **15 rupees per piece**, the revised total purchase value is **18,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. The transaction has been corrected and recorded successfully.`,
    }),
    sc({
      id: "correct_natural",
      sortOrder: 7,
      title: "Natural correction",
      description: "Free-form correction without a fixed command phrase.",
      apiStep: "lines_update",
      body: `The trader does not have to follow a fixed correction command.

**Trader:**
No, that's wrong. It was **1,500 coconuts at 16 rupees each**, not 1,000 at 15.

**Assistant:**
Understood.

I have changed the transaction to **1,500 coconuts at 16 rupees per piece**.

The total purchase value is **24,000 rupees**.

Is this correct?

**Trader:**
Yes.

**Assistant:**
Thank you. The corrected transaction has been recorded successfully.`,
    }),
    sc({
      id: "continue_long",
      sortOrder: 8,
      title: "Continuing long sessions",
      description: "Prompt to keep adding after many confirmed lines.",
      apiStep: "lines_add",
      body: `**Assistant:**
You now have **10 confirmed transactions**.

Would you like to record another transaction?

**Trader:**
Yes.

**Assistant:**
Certainly. Please tell me the details of your next transaction.`,
    }),
    sc({
      id: "edit_earlier",
      sortOrder: 9,
      title: "Reference an earlier transaction",
      description: "Change a previous line by sequence number (e.g. Transaction 2).",
      apiStep: "lines_update",
      body: `During a long session, the trader may want to change an earlier transaction.

**Trader:**
I want to change Transaction 2.

**Assistant:**
Certainly.

Transaction 2 is **500 kilos of Cashewnut from Mr. Ramesh Naik in Quepem at 120 rupees per kilo**, totaling **60,000 rupees**.

What would you like to change?

**Trader:**
The rate should be 125 rupees per kilo.

**Assistant:**
Understood.

The revised transaction is **500 kilos at 125 rupees per kilo**, totaling **62,500 rupees**.

Would you like me to update Transaction 2 with this rate?

**Trader:**
Yes.

**Assistant:**
Transaction 2 has been updated successfully.`,
    }),
    sc({
      id: "status",
      sortOrder: 10,
      title: "Trader requests status",
      description: "How many transactions recorded / confirmed.",
      apiStep: "session_status",
      body: `**Trader:**
How many transactions have I recorded?

**Assistant:**
You have currently recorded **12 transactions**.

All **12 transactions are confirmed**.

Would you like to record another transaction?`,
    }),
    sc({
      id: "stop",
      sortOrder: 11,
      title: "Trader requests to stop",
      description: "End capture; offer review or submit.",
      apiStep: "session_status",
      body: `**Trader:**
No, that's all.

**Assistant:**
Thank you.

You have recorded **12 transactions** in this session.

The total purchase value of all transactions is **₹XX,XX,XXX**.

Before I submit them, would you like to **review your transactions or submit them now**?`,
    }),
    sc({
      id: "submit",
      sortOrder: 12,
      title: "Final submission confirmation",
      description: "Confirm and submit all lines → Approved purchase transactions.",
      apiStep: "submit",
      body: `**Trader:**
Submit them.

**Assistant:**
You have **12 transactions** ready for submission.

The total purchase value is **₹XX,XX,XXX**.

Do you want to **confirm and submit all 12 transactions**?

**Trader:**
Yes.

**Assistant:**
Thank you. Please wait while I submit your transactions.

**[System successfully saves all transactions]**

**Assistant:**
All **12 transactions have been successfully submitted**.

Your transaction records have been saved against **Trader License Number 9898**.

Thank you for using the Trader Transaction Recording Service.

Have a great day.`,
    }),
    sc({
      id: "verify_failure",
      sortOrder: 13,
      title: "Verification failure",
      description: "Mobile mismatch; re-prompt then succeed.",
      apiStep: "verify",
      body: `**Trader:**
My License Number is **9898** **Class A**.

**Assistant:**
Thank you. Please provide your registered mobile number for verification.

**Trader:**
9098098909.

**Assistant:**
I'm sorry, but the mobile number does not match the registered details for Trader License Number 9898 **Class A**.

Please provide the registered mobile number again.

**Trader:**
9098098908.

**Assistant:**
Thank you. Your details have been successfully verified.

Let's continue.`,
    }),
  ],
};

/** Flatten enabled scenarios into one markdown doc (for export / legacy consumers). */
export function flattenVoiceTranscriptScenarios(cfg: VoiceTranscriptScenariosConfig): string {
  const parts = [...cfg.scenarios]
    .filter((s) => s.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => `## ${s.sortOrder}. ${s.title}\n\n${s.body.trim()}`);
  return `# Transcript – Trader Transaction Recording\n\n${parts.join("\n\n")}\n`;
}

/** Merge saved JSON over defaults (keeps new scenario ids if defaults gain any). */
export function mergeVoiceTranscriptScenarios(
  saved: VoiceTranscriptScenariosConfig | null | undefined,
): VoiceTranscriptScenariosConfig {
  if (!saved?.scenarios?.length) {
    return JSON.parse(JSON.stringify(TRADER_VOICE_SCENARIOS_DEFAULT)) as VoiceTranscriptScenariosConfig;
  }
  const byId = new Map(saved.scenarios.map((s) => [s.id, s]));
  const scenarios = TRADER_VOICE_SCENARIOS_DEFAULT.scenarios.map((def) => {
    const ov = byId.get(def.id);
    if (!ov) return { ...def };
    return {
      ...def,
      title: typeof ov.title === "string" && ov.title.trim() ? ov.title : def.title,
      description: typeof ov.description === "string" ? ov.description : def.description,
      apiStep: ov.apiStep || def.apiStep,
      enabled: ov.enabled !== false,
      body: typeof ov.body === "string" ? ov.body : def.body,
      sortOrder: Number.isFinite(ov.sortOrder) ? Number(ov.sortOrder) : def.sortOrder,
    };
  });
  return { version: 1, scenarios };
}

/** @deprecated Prefer structured scenarios; kept for older single-string saves. */
export const TRADER_VOICE_TRANSCRIPT_DEFAULT = flattenVoiceTranscriptScenarios(
  TRADER_VOICE_SCENARIOS_DEFAULT,
);
