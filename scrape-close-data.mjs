import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome");
const CLOSE_URL = "https://web.345569.xyz";

export async function scrapeCloseData() {
  const profileDir = await mkdtemp(join(tmpdir(), "fund-close-"));
  const chrome = spawn(
    CHROME_PATH,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      CLOSE_URL,
    ],
    { stdio: "ignore" },
  );

  try {
    const port = await readDebuggingPort(profileDir);
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const value = await response.json();
      return value.find((target) => target.type === "page") ? value : null;
    });
    const page = targets.find((target) => target.type === "page");
    const cdp = await createCdpClient(page.webSocketDebuggerUrl);

    try {
      await cdp.send("Runtime.enable");
      await waitFor(async () => {
        const count = await evaluate(
          cdp,
          "document.querySelectorAll('.fund-row').length",
        );
        return count > 0 ? count : null;
      }, 15_000);

      const summary = await evaluate(
        cdp,
        `({
          timestamp: document.querySelector('.summary-time')?.textContent
            ?.replace(/^更新于\\s*/, '').trim() ?? '',
          indices: [...document.querySelectorAll('.summary-card')].map(card => ({
            name: card.querySelector('.summary-name')?.textContent?.trim() ?? '',
            impact: card.querySelector('.summary-value')?.textContent?.trim() ?? ''
          })),
          funds: [...document.querySelectorAll('.fund-row')].map(row => ({
            name: row.querySelector('.fund-name')?.textContent?.trim() ?? '',
            impact: row.querySelector('.fund-impact')?.textContent?.trim() ?? ''
          }))
        })`,
      );

      for (let index = 0; index < summary.funds.length; index += 1) {
        await evaluate(
          cdp,
          `document.querySelectorAll('.fund-row')[${index}]?.click()`,
        );
        await waitFor(async () => {
          const title = await evaluate(
            cdp,
            "document.querySelector('.detail-title')?.textContent?.trim() ?? ''",
          );
          return title === summary.funds[index].name ? title : null;
        });

        await evaluate(
          cdp,
          "document.querySelector('.expand-button')?.click()",
        );
        summary.funds[index].stocks = await evaluate(
          cdp,
          `[...document.querySelectorAll('.table-row')].map(row => ({
            name: row.querySelector('.stock-name')?.textContent?.trim() ?? '',
            weight: row.querySelector('.stock-weight')?.textContent?.trim() ?? '',
            change: row.querySelector('.stock-change')?.textContent?.trim() ?? ''
          }))`,
        );

        await evaluate(cdp, "history.back()");
        await waitFor(async () => {
          const count = await evaluate(
            cdp,
            "document.querySelectorAll('.fund-row').length",
          );
          return count === summary.funds.length ? count : null;
        });
      }

      return summary;
    } finally {
      cdp.close();
    }
  } finally {
    chrome.kill("SIGTERM");
    await rm(profileDir, { recursive: true, force: true });
  }
}

async function readDebuggingPort(profileDir) {
  return waitFor(async () => {
    try {
      const value = await readFile(
        join(profileDir, "DevToolsActivePort"),
        "utf8",
      );
      return Number(value.split("\n")[0]) || null;
    } catch {
      return null;
    }
  });
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();

    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveRequest, rejectRequest) => {
            pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result);
      }
    });
    socket.addEventListener("error", () => {
      reject(new Error("无法连接收盘数据浏览器"));
    });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(task, timeout = 10_000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeout) {
    try {
      const value = await task();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("等待收盘数据超时");
}
