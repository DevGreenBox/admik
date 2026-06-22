/**
 * THE CASE — strict photo map v3
 * Sessions 10–17: one primary full export each
 * Composites: hero p0; categories p0,p1,p2; editorial p1,p2; about p2
 * Details/Lookbook/Delivery/Footer: macro crops only
 */
import sharp from "sharp";
import { mkdir, readdir, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "images");

async function findFotoDir() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (["node_modules", "public", "src", "prisma", "scripts", ".next"].includes(e.name)) continue;
    const sub = await readdir(path.join(ROOT, e.name));
    if (sub.some((f) => f.toLowerCase().includes("фотосессия") || f.toLowerCase().includes("коллекции"))) {
      return path.join(ROOT, e.name);
    }
  }
  throw new Error("Папка Фото не найдена");
}

function findFile(files, ...patterns) {
  for (const p of patterns) {
    const hit = files.find((f) => f.toLowerCase().includes(p.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function findBannerFile(files) {
  const lower = (f) => f.toLowerCase();
  return (
    files.find((f) => lower(f).includes("фото для баннера 1")) ??
    files.find((f) => lower(f).includes("баннера 1")) ??
    files.find((f) => lower(f).includes("баннер для главной")) ??
    files.find((f) => lower(f).includes("banner-main") || lower(f).includes("banner_main")) ??
    null
  );
}

function findSession(files, num) {
  const n = String(num);
  return files.find((f) => {
    const l = f.toLowerCase();
    return l.startsWith(`фотосессия ${n}.`) || l.startsWith(`фотоссесия ${n}.`);
  }) ?? null;
}

function findUniform(files, num) {
  const n = String(num);
  return files.find((f) => {
    const l = f.toLowerCase();
    return l.startsWith(`униформа ${n}.`);
  }) ?? null;
}

function pct(w, h, box) {
  return {
    left: Math.min(Math.round((box.left / 100) * w), w - 1),
    top: Math.min(Math.round((box.top / 100) * h), h - 1),
    width: Math.max(1, Math.min(Math.round((box.width / 100) * w), w - Math.round((box.left / 100) * w))),
    height: Math.max(1, Math.min(Math.round((box.height / 100) * h), h - Math.round((box.top / 100) * h))),
  };
}

async function save(input, output, opts = {}) {
  const { extract, resize, quality = 92, mono = true } = opts;
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await access(input);
  } catch {
    return false;
  }
  let img = sharp(input);
  if (extract) {
    const m = await sharp(input).metadata();
    img = img.extract(pct(m.width ?? 1, m.height ?? 1, extract));
  }
  if (resize) img = img.resize(resize);
  if (mono) img = img.modulate({ saturation: 0.86, brightness: 1.03 });
  await img.webp({ quality }).toFile(output);
  console.log(`✓ ${path.relative(OUT, output)}`);
  return true;
}

async function panel(input, col, output, resize) {
  return save(input, path.join(OUT, output), {
    extract: { left: col * (100 / 3), top: 0, width: 100 / 3, height: 100 },
    resize,
    quality: 93,
  });
}

async function saveSession(files, dir, num, output, opts = {}) {
  const src = findSession(files, num);
  if (!src) return false;
  return save(path.join(dir, src), path.join(OUT, output), { quality: 93, ...opts });
}

async function main() {
  const dir = await findFotoDir();
  const files = await readdir(dir);
  const womenGrid = findFile(files, "фото для женской коллекции", "женской коллекции");
  const menGrid = findFile(files, "фото для мужской коллекции", "мужской коллекции");
  const portrait = { width: 900, height: 1200, fit: "cover" };
  const heroSize = { width: 1400, height: 1800, fit: "cover" };

  // 1 HERO
  if (womenGrid) await panel(path.join(dir, womenGrid), 0, "hero/split-women.webp", heroSize);
  if (menGrid) await panel(path.join(dir, menGrid), 0, "hero/split-men.webp", heroSize);

  // 2 HOME BANNER — «фото для баннера 1» (full width, max quality)
  const mainBanner = findBannerFile(files);
  if (mainBanner) {
    await save(path.join(dir, mainBanner), path.join(OUT, "home/banner-main.webp"), {
      resize: { width: 3620, withoutEnlargement: true },
      mono: false,
      quality: 96,
    });
  } else {
    console.warn("⚠ home/banner-main.webp — файл «фото для баннера 1» не найден в Фото/");
  }

  // 4 COLLECTIONS
  if (womenGrid) {
    const w = path.join(dir, womenGrid);
    await panel(w, 0, "categories/women-front.webp", portrait);
    await panel(w, 1, "categories/women-side.webp", portrait);
    await panel(w, 2, "categories/women-back.webp", portrait);
  }
  if (menGrid) {
    const m = path.join(dir, menGrid);
    await panel(m, 0, "categories/men-front.webp", portrait);
    await panel(m, 1, "categories/men-side.webp", portrait);
    await panel(m, 2, "categories/men-back.webp", portrait);
  }

  // 5 BESTSELLERS — Selection: ф10 / ф1 / ф11 / ф2
  await saveSession(files, dir, 10, "products/bestseller-14.webp", { resize: portrait });
  await saveSession(files, dir, 1, "products/bestseller-15.webp", { resize: portrait });
  await saveSession(files, dir, 11, "products/bestseller-16.webp", { resize: portrait });
  await saveSession(files, dir, 2, "products/bestseller-17.webp", { resize: portrait });

  // 6 EDITORIAL — ф111 / ф112 / ф17
  await saveSession(files, dir, 111, "editorial/women-portrait.webp", { resize: portrait });
  await saveSession(files, dir, 112, "editorial/men-portrait.webp", { resize: portrait });
  await saveSession(files, dir, 17, "editorial/duo.webp", { resize: portrait });

  // 8 DETAILS — униформа 1–12
  const detailSize = { width: 800, height: 800, fit: "cover" };
  for (let i = 1; i <= 12; i++) {
    const src = findUniform(files, i);
    if (src) {
      await save(path.join(dir, src), path.join(OUT, `details/detail-${String(i).padStart(2, "0")}.webp`), {
        resize: detailSize,
        quality: 92,
        mono: false,
      });
    }
  }

  // 9 ABOUT — ф8 (дуэт на блоках)
  await saveSession(files, dir, 8, "about/duo.webp", {
    resize: { width: 1200, height: 1500, fit: "cover" },
  });

  // 10 LOOKBOOK — ф13 / ф16 / ф17
  await saveSession(files, dir, 13, "lookbook/lb-13.webp", {
    resize: { width: 1400, height: 900, fit: "cover" },
  });
  await saveSession(files, dir, 16, "lookbook/lb-16.webp", {
    resize: { width: 1400, height: 1800, fit: "cover" },
  });
  await saveSession(files, dir, 17, "lookbook/lb-17.webp", {
    extract: { left: 15, top: 0, width: 70, height: 85 },
    resize: { width: 900, height: 1100, fit: "cover" },
  });

  // 11 DELIVERY — macro ф14, ф15
  await saveSession(files, dir, 14, "delivery/packaging.webp", {
    extract: { left: 32, top: 62, width: 32, height: 32 },
    resize: { width: 1200, height: 900, fit: "cover" },
    quality: 91,
  });
  await saveSession(files, dir, 15, "delivery/box.webp", {
    extract: { left: 28, top: 58, width: 36, height: 36 },
    resize: { width: 1200, height: 900, fit: "cover" },
    quality: 91,
  });

  // 12 FOOTER — ф10 neutral
  await saveSession(files, dir, 10, "footer/bg.webp", {
    extract: { left: 10, top: 5, width: 80, height: 70 },
    resize: { width: 1920, height: 600, fit: "cover" },
    quality: 75,
    mono: true,
  });

  console.log("\nDone.");
}

main().catch(console.error);
