import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";

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
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";

  function onListen() {
    log(`serving on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  }

  httpServer.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOTSUP" && host === "0.0.0.0") {
      log("Binding to 0.0.0.0 not supported, trying 127.0.0.1...");
      httpServer.listen(port, "127.0.0.1", onListen);
    } else {
      throw err;
    }
  });

  httpServer.listen(port, host, onListen);
})();
