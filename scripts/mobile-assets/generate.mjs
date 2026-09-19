/**
 * Phase 179 — generate native launcher/splash assets from ONE brand source.
 *
 * Replaces the default Capacitor-branded icons, which must never ship (§15:
 * "remove platform/editor branding from production artifacts").
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const SRC = resolve(root, "scripts/mobile-assets/source-icon.svg");
const BG = "#0b1220";

const out = (p) => { const f = resolve(root, p); mkdirSync(dirname(f), { recursive: true }); return f; };
const square = async (size, file, padded = false) => {
  const img = padded
    ? sharp({ create: { width: size, height: size, channels: 4, background: BG } })
        .composite([{ input: await sharp(SRC).resize(Math.round(size * 0.62)).png().toBuffer() }])
    : sharp(SRC).resize(size, size);
  await img.png().toFile(out(file));
};

// ── Android launcher (legacy + adaptive foreground) ──────────────
const ANDROID = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [dpi, size] of Object.entries(ANDROID)) {
  await square(size, `android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`);
  await square(size, `android/app/src/main/res/mipmap-${dpi}/ic_launcher_round.png`);
  // Adaptive foreground is 108dp with a 72dp safe zone -> inset the mark.
  await square(Math.round(size * 2.25), `android/app/src/main/res/mipmap-${dpi}/ic_launcher_foreground.png`, true);
}

// ── Android splash (portrait + landscape, all densities) ─────────
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [dpi, [w, h]] of Object.entries(SPLASH)) {
  for (const [orient, W, H] of [["port", w, h], ["land", h, w]]) {
    const logo = await sharp(SRC).resize(Math.round(Math.min(W, H) * 0.38)).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
      .composite([{ input: logo, gravity: "center" }])
      .png()
      .toFile(out(`android/app/src/main/res/drawable-${orient}-${dpi}/splash.png`));
  }
}
const logo = await sharp(SRC).resize(480).png().toBuffer();
await sharp({ create: { width: 1280, height: 1920, channels: 4, background: BG } })
  .composite([{ input: logo, gravity: "center" }]).png()
  .toFile(out("android/app/src/main/res/drawable/splash.png"));

// ── iOS AppIcon (single 1024 source; Xcode derives the rest) ─────
await sharp(SRC).resize(1024, 1024).flatten({ background: BG }).png()
  .toFile(out("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"));
writeFileSync(out("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"), JSON.stringify({
  images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
  info: { author: "xcode", version: 1 },
}, null, 2) + "\n");

// ── iOS splash ───────────────────────────────────────────────────
for (const [name, scale] of [["splash-2732x2732.png", 1], ["splash-2732x2732-1.png", 1], ["splash-2732x2732-2.png", 1]]) {
  const mark = await sharp(SRC).resize(Math.round(2732 * 0.22 * scale)).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: "center" }]).png()
    .toFile(out(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`));
}
console.log("mobile assets generated from a single brand source");
