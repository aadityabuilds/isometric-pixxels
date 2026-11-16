// Render the WebGL object layer (buildings + trees) in headless Chrome, tile by tile.
//   node render/capture.mjs                      all tiles -> render/out/tiles/
//   node render/capture.mjs --window x,y,w,h     one window -> render/out/window.png
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "render", "out");
const TILE = 2048;
const MARGIN = 8;
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const allowed = path.startsWith("/render/") || path.startsWith("/data/build/");
    try {
      if (!allowed) throw new Error("forbidden");
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function main() {
  const args = process.argv.slice(2);
  const win = args.includes("--window") ? args[args.indexOf("--window") + 1].split(",").map(Number) : null;
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--max-old-space-size=8192"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[page]", m.text()));
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  const massing = args.includes("--massing") ? "?massing=1" : "";
  await page.goto(`http://127.0.0.1:${port}/render/index.html${massing}`);
  await page.waitForFunction(() => window.ready || window.initError, null, { timeout: 600000 });
  const err = await page.evaluate(() => window.initError);
  if (err) throw new Error(err);
  const info = await page.evaluate(() => window.sceneInfo);
  console.log(`scene: ${info.buildings} buildings, ${info.trees} trees, image ${info.camera.width}x${info.camera.height}`);

  const render = async (x, y, w, h) => {
    const url = await page.evaluate(([a, b, c, d]) => window.renderTile(a, b, c, d), [x, y, w, h]);
    return Buffer.from(url.split(",")[1], "base64");
  };

  const outDir = args.includes("--outdir") ? args[args.indexOf("--outdir") + 1] : join(OUT, "tiles");
  await mkdir(outDir, { recursive: true });
  if (win) {
    const t0 = Date.now();
    await writeFile(join(OUT, "window.png"), await render(...win));
    console.log(`window rendered in ${Date.now() - t0} ms`);
  } else {
    const cols = Math.ceil(info.camera.width / TILE);
    const rows = Math.ceil(info.camera.height / TILE);
    const manifest = { tile: TILE, margin: MARGIN, cols, rows, width: info.camera.width, height: info.camera.height };
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const t0 = Date.now();
        const png = await render(tx * TILE - MARGIN, ty * TILE - MARGIN, TILE + 2 * MARGIN, TILE + 2 * MARGIN);
        await writeFile(join(outDir, `${tx}_${ty}.png`), png);
        console.log(`tile ${tx},${ty} in ${Date.now() - t0} ms`);
      }
    }
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest));
  }
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
