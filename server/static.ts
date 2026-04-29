import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/** Stop CDNs/browsers from serving a stale SPA shell after deploy (hashed /assets/* can stay long-cached). */
function setHtmlNoStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (base === "index.html" || filePath.endsWith(".html")) {
          setHtmlNoStore(res);
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    setHtmlNoStore(res);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
