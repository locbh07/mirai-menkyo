import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 8788);

if (!existsSync(dist)) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", "build.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build failed: ${code}`))));
  });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mmdata": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
};

http
  .createServer((request, response) => {
    const url = new URL(request.url || "/", `http://localhost:${port}`);
    let filePath = path.join(dist, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(dist)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = path.join(dist, "index.html");
    }
    response.setHeader("Content-Type", mimeTypes[path.extname(filePath)] || "application/octet-stream");
    createReadStream(filePath).pipe(response);
  })
  .listen(port, () => {
    console.log(`Mirai Menkyo dev server: http://localhost:${port}`);
  });
