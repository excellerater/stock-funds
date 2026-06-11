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
  const wasmFunction = findFunctionContaining(siteBundle, "WebAssembly");
  const payloadMatch = wasmFunction.code.match(
    /atob,\s*([A-Za-z_$][\w$]*)\)/,
  );
  if (!payloadMatch) throw new Error("未找到解密模块数据");

  const declaration = findDeclarationBefore(
    siteBundle,
    payloadMatch[1],
    wasmFunction.start,
  );
  const end = findExpressionEnd(siteBundle, declaration.valueStart);
  if (end === -1) throw new Error("解密模块数据不完整");

  let expression = siteBundle.slice(declaration.valueStart, end);
  for (const name of bundleDecoder.names) {
    expression = expression.replace(
      new RegExp(`${escapeRegExp(name)}\\((0x[0-9a-f]+)\\)`, "gi"),
      (_, hex) => JSON.stringify(bundleDecoder.decode(Number(hex))),
    );
  }

  return new Function(`return ${expression};`)();
}

function extractBundleDecoder(siteBundle) {
  const bootstrap = siteBundle.match(
    /^\s*const\s+(_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+);\s*(?=\(function)/i,
  );
  if (!bootstrap) throw new Error("未找到 bundle 解码器入口");

  const [, aliasName, decoderName] = bootstrap;
  const rotStart = siteBundle.indexOf("(function", bootstrap.index);
  const rotEnd = siteBundle.indexOf(",(function(){", rotStart);
  if (rotStart === -1 || rotEnd === -1) {
    throw new Error("未找到 bundle 字符串表初始化器");
  }

  const rotationCode = siteBundle.slice(rotStart, rotEnd);
  const arrayMatch = rotationCode.match(
    /\}\((_0x[0-9a-f]+),\s*0x[0-9a-f]+\)$/i,
  );
  if (!arrayMatch) throw new Error("未找到 bundle 字符串表");

  const arrayCode = extractFunction(siteBundle, arrayMatch[1]).code;
  const decoderCode = extractFunction(siteBundle, decoderName).code;
  const decode = new Function(
    `${arrayCode}\n${decoderCode}\n${rotationCode});\nreturn ${decoderName};`,
  )();

  return {
    decode,
    names: [...new Set([aliasName, decoderName])],
  };
}

function findFunctionContaining(source, needle) {
  const matcher = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  let match;

  while ((match = matcher.exec(source))) {
    const found = extractFunction(source, match[1], match.index);
    if (found.code.includes(needle)) return found;
    matcher.lastIndex = found.end;
  }

  throw new Error(`未找到包含 ${needle} 的函数`);
}

function extractFunction(source, name, fromIndex = 0) {
  const start = source.indexOf(`function ${name}`, fromIndex);
  if (start === -1) throw new Error(`未找到函数 ${name}`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) {
      return {
        start,
        end: index + 1,
        code: source.slice(start, index + 1),
      };
    }
  }

  throw new Error(`函数 ${name} 不完整`);
}

function findDeclarationBefore(source, name, beforeIndex) {
  const prefixes = ["const", "let", "var"];
  let start = -1;
  let prefix = "";

  for (const candidate of prefixes) {
    const found = source.lastIndexOf(`${candidate} ${name}=`, beforeIndex);
    if (found > start) {
      start = found;
      prefix = `${candidate} ${name}=`;
    }
  }

  if (start === -1) throw new Error(`未找到 ${name} 的声明`);
  return { valueStart: start + prefix.length };
}

function findExpressionEnd(source, start) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (depth === 0 && (char === "," || char === ";")) return index;
  }

  return -1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
