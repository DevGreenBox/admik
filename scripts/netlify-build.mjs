/**
 * Netlify build: optional foto → next build
 * Publish dir is managed by @netlify/plugin-nextjs — do NOT set publish in netlify.toml.
 *
 * Витрина — headless-потребитель Admik Storefront API: своей БД/Prisma/миграций нет.
 * Бэкенд настраивается через ADMIK_API_URL / NEXT_PUBLIC_ADMIK_API_URL / STOREFRONT_API_KEY.
 */
import { execSync } from "node:child_process";
import { access } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function runOptional(cmd) {
  try {
    run(cmd);
    return true;
  } catch (err) {
    console.warn(`[netlify-build] skipped (${cmd}):`, err.message ?? err);
    return false;
  }
}

async function hasPhotoSource() {
  try {
    const entries = await readdir(ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (["node_modules", "public", "src", "scripts", ".next"].includes(e.name)) continue;
      const sub = await readdir(path.join(ROOT, e.name));
      if (sub.some((f) => f.toLowerCase().includes("униформа") || f.toLowerCase().includes("баннер"))) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function hasProcessedImages() {
  try {
    await access(path.join(ROOT, "public", "images", "hero", "split-women.webp"));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const imagesReady = await hasProcessedImages();

  // Netlify injects URL at build time — use it when env vars not set manually
  if (process.env.URL && !process.env.NEXT_PUBLIC_SITE_URL) {
    process.env.NEXT_PUBLIC_SITE_URL = process.env.URL;
    console.log(`[netlify-build] NEXT_PUBLIC_SITE_URL = ${process.env.URL}`);
  }

  if (await hasPhotoSource()) {
    runOptional("npm run foto");
  } else if (!imagesReady) {
    console.warn("[netlify-build] No public/images — run npm run foto locally and commit.");
  }

  run("npx next build");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
