// Render the live-layer sprite atlas: node render/sprites.mjs -> public/sprites/atlas.{png,json}
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!path.startsWith("/render/")) throw new Error("forbidden");
    res.writeHead(200, { "content-type": extname(path) === ".js" ? "text/javascript" : "text/html" });
    res.end(await readFile(join(ROOT, path)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

const scene = JSON.parse(await readFile(join(ROOT, "data", "build", "scene.json"), "utf8"));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[page error]", e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/render/sprites.html`);
await page.waitForFunction(() => window.ready);
const { png, meta } = await page.evaluate(([c, s]) => window.buildAtlas(c, s), [scene.camera, scene.sun]);
const out = join(ROOT, "public", "sprites");
await mkdir(out, { recursive: true });
await writeFile(join(out, "atlas.png"), Buffer.from(png.split(",")[1], "base64"));
await writeFile(join(out, "atlas.json"), JSON.stringify({ ...meta, camera: { bearing: scene.camera.bearing, elevation: scene.camera.elevation, pxPerM: scene.camera.pxPerM } }));
console.log(`atlas ${meta.width}x${meta.height}`);
await browser.close();
server.close();
