import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile } from "fs/promises";
import { join } from "path";

const POSTCSS_FROM_WARNING =
  "A PostCSS plugin did not pass the `from` option to `postcss.parse`";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "pdfkit",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === "string" && msg.includes(POSTCSS_FROM_WARNING)) return;
    origWarn.apply(console, args);
  };
  await viteBuild();
  console.warn = origWarn;

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // connect-pg-simple reads table.sql via path.resolve(__dirname, "./table.sql").
  // When bundled into dist/index.cjs, __dirname is dist/, so the file must exist there.
  await copyFile(
    join("node_modules", "connect-pg-simple", "table.sql"),
    join("dist", "table.sql"),
  );
  console.log("copied connect-pg-simple table.sql -> dist/table.sql");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
