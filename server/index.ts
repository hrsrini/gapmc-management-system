import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import { ensureLocalUploadsRoot } from "./object-storage";

ensureLocalUploadsRoot();

// Suppress known PostCSS plugin warning (same as in script/build.ts)
const postcssFromWarning = "A PostCSS plugin did not pass the `from` option to `postcss.parse`";
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes(postcssFromWarning)) return;
  origWarn.apply(console, args);
};

const app = express();

/** Behind nginx / TLS terminator: needed for correct req.secure and cookie.secure "auto". */
if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY !== "false") {
  app.set("trust proxy", 1);
}

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const sessionSecret = process.env.SESSION_SECRET || "gapmc-dev-secret-change-in-production";

const sessionOptions: session.SessionOptions = {
  name: "gapmc.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // "auto" uses req.secure — requires trust proxy when TLS ends at nginx
    secure: process.env.NODE_ENV === "production" ? "auto" : false,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
  },
};

/** Production: persist sessions in Postgres so load-balanced instances share login state. */
if (process.env.NODE_ENV === "production") {
  const PgStore = connectPgSimple(session);
  sessionOptions.store = new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  if (
    process.env.NODE_ENV === "production" &&
    process.env.PAYMENT_GATEWAY_INIT_ENABLED === "true" &&
    !process.env.PAYMENT_WEBHOOK_HMAC_SECRET?.trim() &&
    process.env.PAYMENT_WEBHOOK_REQUIRE_HMAC !== "true"
  ) {
    log(
      "[security] Gateway init enabled without PAYMENT_WEBHOOK_HMAC_SECRET — configure HMAC for POST /api/ioms/receipts/payments/callback or set PAYMENT_WEBHOOK_REQUIRE_HMAC=true once the secret is in place.",
    );
  }

  if (process.env.SLA_REMINDER !== "false") {
    const { startSlaReminderLoop } = await import("./sla-reminder");
    startSlaReminderLoop();
  }

  // M-03: Rent invoice auto-generation on 1st of each month at 00:01 (optional)
  if (process.env.CRON_RENT_INVOICE === "true") {
    const cron = await import("node-cron");
    const { generateRentInvoicesForCurrentMonth } = await import("./cron-rent-invoices");
    cron.default.schedule("1 0 1 * *", async () => {
      try {
        const { created, skipped } = await generateRentInvoicesForCurrentMonth();
        log(`Cron M-03: rent invoices created=${created} skipped=${skipped}`);
      } catch (e) {
        console.error("Cron M-03 rent invoice generation failed:", e);
      }
    });
    log("Cron M-03 rent invoice generation scheduled (1st of month 00:01)");
  }

  if (process.env.CRON_LICENCE_EXPIRY === "true") {
    const cron = await import("node-cron");
    const { autoBlockExpiredTraderLicences } = await import("./cron-licence-expiry");
    cron.default.schedule("5 1 * * *", async () => {
      try {
        const { blocked } = await autoBlockExpiredTraderLicences();
        log(`Cron M-02: expired licences auto-blocked=${blocked}`);
      } catch (e) {
        console.error("Cron M-02 licence expiry failed:", e);
      }
    });
    log("Cron M-02 licence expiry auto-block scheduled (daily 01:05)");
  }

  if (process.env.CRON_HR_RETIREMENT === "true") {
    const cron = await import("node-cron");
    const { runHrRetirementReminders } = await import("./cron-hr-retirement");
    cron.default.schedule("15 7 * * *", async () => {
      try {
        const r = await runHrRetirementReminders();
        log(`Cron M-01: HR retirement reminders checked=${r.checked} notified=${r.notified}`);
      } catch (e) {
        console.error("Cron M-01 HR retirement failed:", e);
      }
    });
    log("Cron M-01 HR retirement reminders scheduled (daily 07:15)");
  }

  if (process.env.CRON_OPERATIONAL_DIGEST === "true") {
    const cron = await import("node-cron");
    const { runOperationalRemindersDigest } = await import("./cron-operational-reminders");
    cron.default.schedule("25 7 * * *", async () => {
      try {
        const r = await runOperationalRemindersDigest();
        log(`Cron M-07/M-08: operational digest fleet=${r.fleetAlerts} amc=${r.amcAlerts} maint=${r.maintenanceDue}`);
      } catch (e) {
        console.error("Cron operational digest failed:", e);
      }
    });
    log("Cron M-07/M-08 operational digest scheduled (daily 07:25)");
  }

  if (process.env.CRON_AMC_DIGEST === "true") {
    const cron = await import("node-cron");
    const { runAmcRenewalDigest } = await import("./cron-amc-renewal-digest");
    cron.default.schedule("35 7 * * *", async () => {
      try {
        const r = await runAmcRenewalDigest();
        log(`Cron M-08: AMC renewal digest amcAlerts=${r.amcAlerts}`);
      } catch (e) {
        console.error("Cron AMC digest failed:", e);
      }
    });
    log("Cron M-08 AMC renewal digest scheduled (daily 07:35)");
  }

  if (process.env.CRON_AMC_MONTHLY_BILLS === "true") {
    const cron = await import("node-cron");
    const { generateMonthlyAmcBillsIfMissing } = await import("./cron-amc-bills");
    cron.default.schedule("20 2 * * *", async () => {
      try {
        const r = await generateMonthlyAmcBillsIfMissing();
        if (r.disabled) return;
        log(`Cron M-08: AMC monthly bills created=${r.created} skipped=${r.skipped}`);
      } catch (e) {
        console.error("Cron AMC monthly bills failed:", e);
      }
    });
    log("Cron M-08 AMC monthly bill generation scheduled (daily 02:20 UTC; Monthly contracts only)");
  }

  if (process.env.CRON_DATA_RETENTION_AUDIT === "true") {
    const cron = await import("node-cron");
    const { runDataRetentionAuditJob } = await import("./data-retention-audit");
    cron.default.schedule("0 4 * * 0", async () => {
      try {
        const s = await runDataRetentionAuditJob();
        log(`Cron data retention audit: ${JSON.stringify(s.countsPastRetention)}`);
      } catch (e) {
        console.error("Cron data retention audit failed:", e);
      }
    });
    log("Cron data retention audit scheduled (Sundays 04:00 UTC; read-only counts + audit_log)");
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const requestedPort = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const isDev = process.env.NODE_ENV !== "production";
  /**
   * Default: fail fast if PORT is in use (avoids a stale server on :5000 while you open :5001 and get broken auth).
   * Set DEV_PORT_FALLBACK=true to try the next ports (legacy behaviour).
   */
  const allowDevPortFallback = process.env.DEV_PORT_FALLBACK === "true";
  const maxPort = isDev && allowDevPortFallback ? requestedPort + 19 : requestedPort;

  function onListenLog(effectivePort: number, bindHost: string) {
    const displayHost = bindHost === "0.0.0.0" ? "localhost" : bindHost;
    log(`serving on http://${displayHost}:${effectivePort}`);
  }

  function listenOn(port: number, bindHost: string): void {
    httpServer.removeAllListeners("error");
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOTSUP" && bindHost === "0.0.0.0") {
        log("Binding to 0.0.0.0 not supported, trying 127.0.0.1...");
        listenOn(port, "127.0.0.1");
        return;
      }
      if (err.code === "EADDRINUSE" && port < maxPort) {
        log(`Port ${port} in use, trying ${port + 1}...`);
        listenOn(port + 1, bindHost);
        return;
      }
      if (err.code === "EADDRINUSE") {
        log(
          isDev && !allowDevPortFallback
            ? `Port ${port} is already in use (another node/express may be running old code). Stop it, then restart. Or set DEV_PORT_FALLBACK=true to try another port, or set PORT to a free port.`
            : `Port ${port} is already in use. Stop the other process or set PORT to a free port.`,
        );
        process.exit(1);
        return;
      }
      throw err;
    });
    httpServer.listen(port, bindHost, () => onListenLog(port, bindHost));
  }

  listenOn(requestedPort, host);
})();
