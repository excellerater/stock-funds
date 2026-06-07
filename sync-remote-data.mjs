import { mkdir, readFile, writeFile } from "node:fs/promises";
import { scrapeCloseData } from "./scrape-close-data.mjs";

const BASE_URL = "https://web1.345569.xyz";
const CLOSE_URL = "https://web.345569.xyz";
const LIST_PATH = "/api/lkjhgfdsa";
const DETAIL_PATH = "/api/detail";
const OUTPUT_DIR = new URL("./data/", import.meta.url);

async function main() {
  const existingDataset = await loadExistingDataset();
  const decrypt = await createDecryptor();
  const listPayload = await fetchJson(`${BASE_URL}${LIST_PATH}`);
  const listData = parsePayload(listPayload, decrypt);
  const snapshot = listData?.b?.c;
  const funds = snapshot?.categ0ry1mpacts;

  if (!snapshot || !Array.isArray(funds)) {
    throw new Error("列表数据结构不符合预期");
  }

  const enrichedFunds = [];

  for (const fund of funds) {
    const detailPayload = await fetchJson(
      `${BASE_URL}${DETAIL_PATH}?id=${encodeURIComponent(fund.id)}`,
    );
    const detailData = parsePayload(detailPayload, decrypt);
    const detail = detailData?.b?.c ?? {};

    enrichedFunds.push({
      id: fund.id,
      name: fund.name,
      impact: normalizePercent(fund.estimatedImpact),
      delayNote: fund.time ?? "",
      description: snapshot.description ?? "",
      timestamp: snapshot.timestamp ?? "",
      hiddenOvernight: String(snapshot.timestamp ?? "").includes("盘后"),
      stocks: Array.isArray(detail.stocks)
        ? detail.stocks.map(parseStockRow).filter(Boolean)
        : [],
    });
  }

  const generatedAt = new Date().toISOString();
  const closeSnapshot = await loadCloseSnapshot(existingDataset);
  const closeImpacts = new Map(
    closeSnapshot?.funds?.map((fund) => [fund.name, fund.impact]) ?? [],
  );
  const closeStocks = new Map(
    closeSnapshot?.funds?.map((fund) => [fund.name, fund.stocks ?? []]) ?? [],
  );
  const currentSnapshot = {
    generatedAt,
    session: detectSession(snapshot.timestamp),
    timestamp: snapshot.timestamp ?? "",
    description: snapshot.description ?? "",
    indices: Array.isArray(snapshot.indexs)
      ? snapshot.indexs.map((item) => ({
          name: item.inxnm,
          impact: normalizePercent(item.rise_fall_per),
        }))
      : [],
    funds: enrichedFunds.map((fund) => ({
      id: fund.id,
      impact: fund.impact,
    })),
  };
  const history = await loadHistory();
  const snapshots = mergeSnapshots(history.snapshots ?? [], currentSnapshot);
  const latestBySession = {
    ...buildLatestBySession(history.snapshots ?? []),
    ...(history.latestBySession ?? {}),
  };
  const previousSnapshot = findPreviousSnapshot(
    Object.values(latestBySession),
    currentSnapshot,
  );
  latestBySession[currentSnapshot.session] = currentSnapshot;
  const previousImpacts = new Map(
    previousSnapshot?.funds.map((fund) => [fund.id, fund.impact]) ?? [],
  );
  const dataset = {
    source: BASE_URL,
    closeSource: CLOSE_URL,
    generatedAt,
    session: currentSnapshot.session,
    closeSnapshot: closeSnapshot
      ? {
          generatedAt: closeSnapshot.generatedAt,
          timestamp: closeSnapshot.timestamp,
          description: closeSnapshot.description,
          indices: closeSnapshot.indices,
        }
      : null,
    previousSnapshot: previousSnapshot
      ? {
          generatedAt: previousSnapshot.generatedAt,
          session: previousSnapshot.session,
          timestamp: previousSnapshot.timestamp,
        }
      : null,
    marketOverview: {
      timestamp: snapshot.timestamp ?? "",
      description: snapshot.description ?? "",
      indices: currentSnapshot.indices,
    },
    summary: buildSummary(enrichedFunds),
    funds: enrichedFunds.map((fund) => ({
      ...fund,
      closeImpact: closeImpacts.get(fund.name) ?? null,
      closeStocks: closeStocks.get(fund.name) ?? [],
      previousImpact: previousImpacts.get(fund.id) ?? null,
    })),
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    new URL("history.json", OUTPUT_DIR),
    JSON.stringify({ latestBySession, snapshots }, null, 2),
    "utf8",
  );
  await writeFile(
    new URL("remote-funds.json", OUTPUT_DIR),
    JSON.stringify(dataset, null, 2),
    "utf8",
  );
  await writeFile(
    new URL("remote-funds.js", OUTPUT_DIR),
    `window.__REMOTE_FUNDS__ = ${JSON.stringify(dataset, null, 2)};\n`,
    "utf8",
  );
  await writeFile(
    new URL("last-good.json", OUTPUT_DIR),
    JSON.stringify(dataset, null, 2),
    "utf8",
  );

  console.log(
    `Synced ${enrichedFunds.length} funds at ${generatedAt} -> data/remote-funds.{json,js}`,
  );
}

async function loadExistingDataset() {
  try {
    return JSON.parse(
      await readFile(new URL("remote-funds.json", OUTPUT_DIR), "utf8"),
    );
  } catch {
    return null;
  }
}

async function loadCloseSnapshot(existingDataset) {
  try {
    return await scrapeCloseSnapshot();
  } catch (error) {
    console.warn(`Close snapshot unavailable, keeping cache: ${error.message}`);

    if (!existingDataset?.closeSnapshot) {
      return null;
    }

    return {
      ...existingDataset.closeSnapshot,
      funds: existingDataset.funds
        .filter((fund) => fund.closeImpact != null)
        .map((fund) => ({
          name: fund.name,
          impact: fund.closeImpact,
          stocks: fund.closeStocks ?? [],
        })),
    };
  }
}

async function scrapeCloseSnapshot() {
  const scraped = await scrapeCloseData();
  const funds = scraped.funds.map((fund) => ({
    name: fund.name,
    impact: normalizePercent(fund.impact),
    stocks: fund.stocks.map((stock) => ({
      name: stock.name,
      weight: normalizePercent(stock.weight),
      change: normalizePercent(stock.change),
    })),
  }));

  if (!funds.length) {
    throw new Error("收盘页未返回基金列表");
  }

  const indices = scraped.indices.map((item) => ({
    name: item.name,
    impact: normalizePercent(item.impact),
  }));

  return {
    generatedAt: new Date().toISOString(),
    timestamp: scraped.timestamp,
    description: "收盘持仓估算",
    indices,
    funds,
  };
}

async function loadHistory() {
  try {
    return JSON.parse(
      await readFile(new URL("history.json", OUTPUT_DIR), "utf8"),
    );
  } catch {
    return { snapshots: [] };
  }
}

function mergeSnapshots(snapshots, current) {
  const signature = snapshotSignature(current);
  const withoutDuplicate = snapshots.filter(
    (snapshot) => snapshotSignature(snapshot) !== signature,
  );
  return [current, ...withoutDuplicate].slice(0, 48);
}

function findPreviousSnapshot(snapshots, current) {
  return (
    snapshots
      .filter((snapshot) => snapshot.session !== current.session)
      .sort(
        (left, right) =>
          new Date(right.generatedAt).getTime() -
          new Date(left.generatedAt).getTime(),
      )[0] ?? null
  );
}

function buildLatestBySession(snapshots) {
  return snapshots.reduce((latest, snapshot) => {
    if (!latest[snapshot.session]) {
      latest[snapshot.session] = snapshot;
    }
    return latest;
  }, {});
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    session: snapshot.session,
    timestamp: snapshot.timestamp,
    indices: snapshot.indices,
    funds: snapshot.funds,
  });
}

function detectSession(timestamp = "") {
  if (timestamp.includes("盘前")) return "盘前";
  if (timestamp.includes("盘后") || timestamp.includes("夜盘")) return "盘后";
  return "正盘";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${url} -> ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${url} -> ${response.status}`);
  }

  return response.text();
}

function parsePayload(payload, decrypt) {
  if (payload?.encrypted && typeof payload.data === "string") {
    return JSON.parse(decrypt(payload.data));
  }
  return payload;
}

async function createDecryptor() {
  const siteBundle = await fetchCurrentBundle();
  const bundleDecoder = extractBundleDecoder(siteBundle);
  const payload = extractWasmBase64(siteBundle, bundleDecoder);
  const wasmBytes = Uint8Array.from(Buffer.from(payload, "base64"));
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const wasm = instance.exports;

  wasm.init();

  return (encoded) => {
    const input = Uint8Array.from(Buffer.from(encoded, "base64"));
    const memory = new Uint8Array(wasm.memory.buffer);
    const inputPtr = wasm.getInputPtr();
    const outputPtr = wasm.getOutputPtr();

    memory.set(input, inputPtr);
    const outputLength = wasm.decrypt(input.length);

    return new TextDecoder().decode(
      memory.slice(outputPtr, outputPtr + outputLength),
    );
  };
}

async function fetchCurrentBundle() {
  const homepage = await fetchText(BASE_URL);
  const match = homepage.match(/<script[^>]+src="([^"]*index-[^"]+\.js)"/i);

  if (!match) {
    throw new Error("未在首页找到 bundle 地址");
  }

  const bundleUrl = new URL(match[1], BASE_URL).toString();
  return fetchText(bundleUrl);
}

function extractWasmBase64(siteBundle, bundleDecoder) {
  const start = siteBundle.indexOf("const Pl=");
  const end = siteBundle.indexOf(",Rl=", start);

  if (start === -1 || end === -1) {
    throw new Error("未找到解密模块");
  }

  const expression = siteBundle
    .slice(start, end)
    .replace(/^const Pl=/, "")
    .replace(/_0x540869\((0x[0-9a-f]+)\)/g, (_, hex) =>
      JSON.stringify(bundleDecoder(Number(hex))),
    );

  return new Function(`return ${expression};`)();
}

function unescapeHex(value) {
  return value.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function extractBundleDecoder(siteBundle) {
  const arrStart = siteBundle.indexOf("function _0x13e3()");
  const arrEnd = siteBundle.indexOf("return _0x13e3();}", arrStart);
  const decStart = siteBundle.indexOf("function _0x3151", arrEnd);
  const decEnd = siteBundle.indexOf("_0x31512d;}", decStart);
  const rotStart = siteBundle.indexOf("(function(_0xfd5efe,_0x5769b1)");
  const rotEnd = siteBundle.indexOf(",(function(){", rotStart);

  if ([arrStart, arrEnd, decStart, decEnd, rotStart, rotEnd].some((value) => value === -1)) {
    throw new Error("未找到 bundle 解码器");
  }

  const arrCode = siteBundle.slice(
    arrStart,
    arrEnd + "return _0x13e3();}".length,
  );
  const decCode = siteBundle.slice(
    decStart,
    decEnd + "_0x31512d;}".length,
  );
  const rotCode = `${siteBundle.slice(rotStart, rotEnd)})`;

  return new Function(
    `${arrCode}\n${decCode}\n${rotCode}\nreturn _0x3151;`,
  )();
}

function normalizePercent(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const cleaned = value.replace("%", "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSummary(funds) {
  const totalFunds = funds.length;
  const averageImpact = average(funds.map((fund) => fund.impact));
  const positiveFunds = funds.filter((fund) => fund.impact > 0).length;
  const totalCategories = funds.reduce((sum, fund) => sum + fund.stocks.length, 0);

  return {
    totalFunds,
    positiveFunds,
    averageImpact,
    totalCategories,
  };
}

function parseStockRow(row) {
  if (typeof row !== "string") {
    return null;
  }

  const [name, weight, change] = row.split("|||");
  if (!name) {
    return null;
  }

  return {
    name: name.trim(),
    weight: normalizePercent(weight),
    change: normalizePercent(change),
  };
}

function average(numbers) {
  if (numbers.length === 0) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
