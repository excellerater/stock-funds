const BASE_URL = "https://web1.345569.xyz";
const LIST_PATH = "/api/lkjhgfdsa";
const DETAIL_PATH = "/api/detail";

export async function fetchLiveDataset() {
  const decrypt = await createDecryptor();
  const listPayload = await fetchJson(`${BASE_URL}${LIST_PATH}`);
  const listData = parsePayload(listPayload, decrypt);
  const snapshot = listData?.b?.c;
  const funds = snapshot?.categ0ry1mpacts;

  if (!snapshot || !Array.isArray(funds)) {
    throw new Error("列表数据结构不符合预期");
  }

  const enrichedFunds = await Promise.all(
    funds.map(async (fund) => {
      const detailPayload = await fetchJson(
        `${BASE_URL}${DETAIL_PATH}?id=${encodeURIComponent(fund.id)}`,
      );
      const detailData = parsePayload(detailPayload, decrypt);
      const detail = detailData?.b?.c ?? {};

      return {
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
      };
    }),
  );
  const generatedAt = new Date().toISOString();

  return {
    source: BASE_URL,
    generatedAt,
    session: detectSession(snapshot.timestamp),
    marketOverview: {
      timestamp: snapshot.timestamp ?? "",
      description: snapshot.description ?? "",
      indices: Array.isArray(snapshot.indexs)
        ? snapshot.indexs.map((item) => ({
            name: item.inxnm,
            impact: normalizePercent(item.rise_fall_per),
          }))
        : [],
    },
    summary: buildSummary(enrichedFunds),
    funds: enrichedFunds,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${url} -> ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
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
  if (!match) throw new Error("未在首页找到 bundle 地址");
  return fetchText(new URL(match[1], BASE_URL).toString());
}

function extractWasmBase64(siteBundle, bundleDecoder) {
  const start = siteBundle.indexOf("const Pl=");
  const end = siteBundle.indexOf(",Rl=", start);
  if (start === -1 || end === -1) throw new Error("未找到解密模块");

  const expression = siteBundle
    .slice(start, end)
    .replace(/^const Pl=/, "")
    .replace(/_0x540869\((0x[0-9a-f]+)\)/g, (_, hex) =>
      JSON.stringify(bundleDecoder(Number(hex))),
    );

  return new Function(`return ${expression};`)();
}

function extractBundleDecoder(siteBundle) {
  const arrStart = siteBundle.indexOf("function _0x13e3()");
  const arrEnd = siteBundle.indexOf("return _0x13e3();}", arrStart);
  const decStart = siteBundle.indexOf("function _0x3151", arrEnd);
  const decEnd = siteBundle.indexOf("_0x31512d;}", decStart);
  const rotStart = siteBundle.indexOf("(function(_0xfd5efe,_0x5769b1)");
  const rotEnd = siteBundle.indexOf(",(function(){", rotStart);

  if (
    [arrStart, arrEnd, decStart, decEnd, rotStart, rotEnd].some(
      (value) => value === -1,
    )
  ) {
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

function detectSession(timestamp = "") {
  if (timestamp.includes("盘前")) return "盘前";
  if (timestamp.includes("盘后") || timestamp.includes("夜盘")) return "盘后";
  return "正盘";
}

function normalizePercent(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStockRow(row) {
  if (typeof row !== "string") return null;
  const [name, weight, change] = row.split("|||");
  if (!name) return null;
  return {
    name: name.trim(),
    weight: normalizePercent(weight),
    change: normalizePercent(change),
  };
}

function buildSummary(funds) {
  return {
    totalFunds: funds.length,
    positiveFunds: funds.filter((fund) => fund.impact > 0).length,
    averageImpact:
      funds.reduce((sum, fund) => sum + fund.impact, 0) / funds.length,
    totalCategories: funds.reduce(
      (sum, fund) => sum + fund.stocks.length,
      0,
    ),
  };
}
