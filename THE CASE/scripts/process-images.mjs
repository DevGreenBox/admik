/**
 * Extract & grade visuals from brandbook + ./Фото for site sections.
 * Does NOT touch home/banner-main.webp (main horizontal banner).
 * Run: node scripts/process-images.mjs
 */
import sharp from "sharp";
import { mkdir, access, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BRAND = path.join(ROOT, "public", "brandbook");
const OUT = path.join(ROOT, "public", "images");

async function findFotoDir() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || ["node_modules", "public", "src", "prisma", "scripts", ".next"].includes(e.name)) continue;
    const sub = await readdir(path.join(ROOT, e.name));
    if (sub.some((f) => f.includes("баннер") || f.includes("женская форма"))) {
      return path.join(ROOT, e.name);
    }
  }
  return null;
}

function pct(w, h, box) {
  return {
    left: Math.min(Math.round((box.left / 100) * w), w - 1),
    top: Math.min(Math.round((box.top / 100) * h), h - 1),
    width: Math.max(1, Math.min(Math.round((box.width / 100) * w), w - Math.round((box.left / 100) * w))),
    height: Math.max(1, Math.min(Math.round((box.height / 100) * h), h - Math.round((box.top / 100) * h))),
  };
}

async function save(inputPath, outputPath, { extract, resize, quality = 90, mono = true } = {}) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await access(inputPath);
  } catch {
    console.warn(`Skip missing: ${inputPath}`);
    return;
  }

  let img = sharp(inputPath);
  if (extract) {
    const m = await sharp(inputPath).metadata();
    img = img.extract(pct(m.width ?? 1, m.height ?? 1, extract));
  }
  if (resize) img = img.resize(resize);
  else img = img.resize({ width: 1400, withoutEnlargement: true });

  img = mono
    ? img.modulate({ saturation: 0.84, brightness: 1.03 })
    : img.modulate({ brightness: 1.01 });

  await img.webp({ quality }).toFile(outputPath);
  console.log(`✓ ${path.relative(OUT, outputPath)}`);
}

async function cropBrand(file, out, box, resize, quality = 91) {
  await save(path.join(BRAND, file), path.join(OUT, out), {
    extract: box,
    resize,
    quality,
  });
}

async function cropFoto(fotoDir, file, out, resize, quality = 92) {
  if (!fotoDir) return;
  await save(path.join(fotoDir, file), path.join(OUT, out), { resize, quality });
}

async function main() {
  const fotoDir = await findFotoDir();
  console.log("THE CASE — brandbook visual pipeline\n");
  if (fotoDir) console.log(`Фото: ${fotoDir}\n`);

  // Hero split — processed by npm run foto («Фото на главную страницу»)

  // ── ABOUT — lifestyle / editorial ──
  await cropFoto(fotoDir, "о компании.png", "about/main.webp", { width: 1600, height: 1000, fit: "cover" });
  await cropFoto(fotoDir, "модель девушки и парня.png", "about/duo.webp", { width: 1400, height: 1800, fit: "cover" });
  await cropBrand("file-004.png", "about/profile.webp", { left: 0, top: 0, width: 42, height: 72 }, { width: 900, height: 1200, fit: "cover" });
  await cropBrand("file-010.png", "about/spotlight.webp", { left: 0, top: 8, width: 38, height: 42 }, { width: 900, height: 1100, fit: "cover" });
  await cropBrand("file-002.png", "about/portrait.webp", { left: 87, top: 0, width: 13, height: 28 }, { width: 700, height: 900, fit: "cover" });

  // ── LOOKBOOK — cinematic campaign ──
  const lookbookJobs = [
    ["о компании.png", "lookbook/lb-01.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["модель девушки и парня.png", "lookbook/lb-02.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["женская форма.png", "lookbook/lb-03.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["мужская форма.png", "lookbook/lb-04.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["женская форма 2.png", "lookbook/lb-05.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["мужская форма 2.png", "lookbook/lb-06.webp", { width: 1400, height: 1860, fit: "cover" }],
    ["кадр с одеждой 2.png", "lookbook/lb-07.webp", { width: 1400, height: 1860, fit: "cover" }],
  ];
  for (const [file, out, resize] of lookbookJobs) {
    await cropFoto(fotoDir, file, out, resize);
  }
  await cropBrand("file-010.png", "lookbook/lb-08.webp", { left: 38, top: 8, width: 22, height: 38 }, { width: 1200, height: 1600, fit: "cover" });
  await cropBrand("file-010.png", "lookbook/lb-09.webp", { left: 60, top: 8, width: 22, height: 38 }, { width: 1200, height: 1600, fit: "cover" });
  await cropBrand("file-004.png", "lookbook/lb-10.webp", { left: 72, top: 8, width: 28, height: 55 }, { width: 1200, height: 1600, fit: "cover" });

  // ── DETAILS — fabric, pockets, seams, tags ──
  await cropFoto(fotoDir, "кадр одежды.png", "details/pocket-white.webp", { width: 1000, height: 1200, fit: "cover" });
  await cropFoto(fotoDir, "деталь одежды.png", "details/tag-label.webp", { width: 1000, height: 800, fit: "cover" });
  await cropFoto(fotoDir, "кадр с одеждой 2.png", "details/collar-detail.webp", { width: 1000, height: 1200, fit: "cover" });
  await cropBrand("file-002.png", "details/neckline.webp", { left: 50, top: 0, width: 12.5, height: 28 }, { width: 800, height: 1000, fit: "cover" });
  await cropBrand("file-004.png", "details/fabric-texture.webp", { left: 45, top: 55, width: 28, height: 45 }, { width: 900, height: 900, fit: "cover" });
  await cropBrand("file-004.png", "details/back-seam.webp", { left: 72, top: 8, width: 28, height: 50 }, { width: 900, height: 1100, fit: "cover" });
  await cropBrand("file-010.png", "details/waistband.webp", { left: 0, top: 50, width: 25, height: 22 }, { width: 800, height: 700, fit: "cover" });
  await cropBrand("file-010.png", "details/woven-tag.webp", { left: 50, top: 72, width: 16, height: 18 }, { width: 700, height: 700, fit: "cover" });

  // ── CATEGORIES — full-body product views ──
  await cropFoto(fotoDir, "женская форма.png", "categories/women-front.webp", { width: 700, height: 1050, fit: "cover" });
  await cropFoto(fotoDir, "женская форма 2.png", "categories/women-side.webp", { width: 700, height: 1050, fit: "cover" });
  await cropBrand("file-002.png", "categories/women-back.webp", { left: 37.5, top: 0, width: 12.5, height: 28 }, { width: 700, height: 1050, fit: "cover" });
  await cropFoto(fotoDir, "мужская форма.png", "categories/men-front.webp", { width: 700, height: 1050, fit: "cover" });
  await cropFoto(fotoDir, "мужская форма 2.png", "categories/men-side.webp", { width: 700, height: 1050, fit: "cover" });
  await cropBrand("file-002.png", "categories/men-back.webp", { left: 62.5, top: 0, width: 12.5, height: 28 }, { width: 700, height: 1050, fit: "cover" });
  await cropBrand("file-002.png", "categories/women.webp", { left: 25, top: 0, width: 12.5, height: 28 }, { width: 800, height: 1000, fit: "cover" });
  await cropBrand("file-002.png", "categories/men.webp", { left: 12.5, top: 0, width: 12.5, height: 28 }, { width: 800, height: 1000, fit: "cover" });
  await cropBrand("file-010.png", "categories/suits.webp", { left: 38, top: 48, width: 22, height: 35 }, { width: 800, height: 1000, fit: "cover" });
  await cropBrand("file-004.png", "categories/coats.webp", { left: 0, top: 0, width: 42, height: 72 }, { width: 800, height: 1000, fit: "cover" });
  await cropBrand("file-010.png", "categories/accessories.webp", { left: 50, top: 72, width: 16, height: 18 }, { width: 800, height: 800, fit: "cover" });

  // ── DELIVERY — packaging & objects ──
  await cropBrand("file-002.png", "delivery/packaging.webp", { left: 17, top: 0, width: 17, height: 28 }, { width: 1600, height: 700, fit: "cover" });
  await cropBrand("file-010.png", "delivery/box-open.webp", { left: 25, top: 72, width: 22, height: 22 }, { width: 1200, height: 900, fit: "cover" });
  await cropBrand("file-002.png", "delivery/bag-white.webp", { left: 34, top: 0, width: 17, height: 28 }, { width: 900, height: 1100, fit: "cover" });
  await cropBrand("file-004.png", "delivery/tags.webp", { left: 0, top: 72, width: 45, height: 28 }, { width: 1400, height: 600, fit: "cover" });

  // ── PRODUCTS — catalog image pool ──
  const productPool = [
    "categories/women-front.webp",
    "categories/women-side.webp",
    "categories/women-back.webp",
    "categories/men-front.webp",
    "categories/men-side.webp",
    "categories/men-back.webp",
    "details/pocket-white.webp",
    "details/collar-detail.webp",
    "details/tag-label.webp",
    "details/fabric-texture.webp",
    "details/back-seam.webp",
    "details/neckline.webp",
  ];
  for (let i = 0; i < productPool.length; i++) {
    const src = path.join(OUT, productPool[i]);
    const dest = path.join(OUT, `products/p-${String(i + 1).padStart(2, "0")}.webp`);
    try {
      await access(src);
      await sharp(src).webp({ quality: 91 }).toFile(dest);
      console.log(`✓ products/p-${String(i + 1).padStart(2, "0")}.webp`);
    } catch {
      /* skip */
    }
  }

  // Footer texture from tag detail
  await save(path.join(OUT, "details/tag-label.webp"), path.join(OUT, "footer/texture.webp"), {
    resize: { width: 1920 },
    quality: 70,
    mono: true,
  }).catch(() =>
    cropBrand("file-004.png", "footer/texture.webp", { left: 0, top: 72, width: 45, height: 28 }, { width: 1920 })
  );

  console.log("\nDone. (home/banner-main.webp unchanged)");
}

main().catch(console.error);
