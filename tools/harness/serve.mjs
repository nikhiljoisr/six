// Serves the built view (dist/) with the stand-in backend injected ahead of the app.
//   pnpm build && node tools/harness/serve.mjs [--port 4173]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../../dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };

async function fileFor(pathname) {
  if (pathname.startsWith("/__harness/")) return join(here, normalize(pathname.slice("/__harness/".length)));
  const inside = normalize(pathname === "/" ? "/index.html" : pathname);
  return join(dist, inside);
}

export function start({ port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    try {
      const file = await fileFor(decodeURIComponent(pathname));
      if (!file.startsWith(dist + sep) && !file.startsWith(here + sep)) throw new Error("outside the served folders");
      let body = await readFile(file);
      if (file.endsWith(`${sep}index.html`)) {
        body = Buffer.from(String(body).replace('<script type="module"', '<script src="/__harness/mock-tauri.js"></script>\n    <script type="module"'));
      }
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found (run `pnpm build` first?)");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--port");
  const { url } = await start({ port: at > -1 ? Number(process.argv[at + 1]) : 4173 });
  console.log(`Six harness at ${url}/?state=running   (states: see tools/harness/README.md)`);
}
