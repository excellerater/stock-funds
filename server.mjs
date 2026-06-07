import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const REFRESH_INTERVAL = 60_000;
let syncing = null;
let syncStatus = {
  ok: true,
  cached: false,
  error: null,
  checkedAt: null,
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/refresh") {
    try {
      await syncData();
      return serveDataset(response);
    } catch (error) {
      syncStatus = {
        ok: false,
        cached: true,
        error: error.message,
        checkedAt: new Date().toISOString(),
      };
      return serveDataset(response);
    }
  }

  if (url.pathname === "/api/data") {
    return serveDataset(response);
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  return serveFile(requestedPath, response);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fund monitor running at http://127.0.0.1:${PORT}`);
});

setInterval(() => {
  syncData().catch((error) => console.error("Background sync failed:", error.message));
}, REFRESH_INTERVAL);

function syncData() {
  if (syncing) return syncing;

  syncing = new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["sync-remote-data.mjs"],
      { cwd: ROOT },
      (error, stdout, stderr) => {
        syncing = null;
        if (error) {
          const message = stderr.trim() || error.message;
          syncStatus = {
            ok: false,
            cached: true,
            error: message,
            checkedAt: new Date().toISOString(),
          };
          reject(new Error(message));
          return;
        }
        syncStatus = {
          ok: true,
          cached: false,
          error: null,
          checkedAt: new Date().toISOString(),
        };
        if (stdout.trim()) console.log(stdout.trim());
        resolve();
      },
    );
  });

  return syncing;
}

async function serveDataset(response) {
  try {
    const dataset = JSON.parse(
      await readFile(join(ROOT, "data/remote-funds.json"), "utf8"),
    );
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ ...dataset, syncStatus }));
  } catch {
    response.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ error: "暂无本地缓存数据" }));
  }
}

async function serveFile(relativePath, response, extraHeaders = {}) {
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolutePath = join(ROOT, safePath);

  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(absolutePath)] || "application/octet-stream",
      ...extraHeaders,
    });
    createReadStream(absolutePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}
