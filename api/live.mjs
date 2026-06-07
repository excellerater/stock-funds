import { readFile } from "node:fs/promises";
import { fetchLiveDataset } from "../live-source.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    const [live, cached] = await Promise.all([
      fetchLiveDataset(),
      loadCachedDataset(),
    ]);
    const cachedFunds = new Map(
      cached.funds.map((fund) => [fund.name, fund]),
    );

    response.status(200).json({
      ...cached,
      ...live,
      closeSnapshot: cached.closeSnapshot,
      previousSnapshot: cached.previousSnapshot,
      funds: live.funds.map((fund) => ({
        ...fund,
        closeImpact: cachedFunds.get(fund.name)?.closeImpact ?? null,
        closeStocks: cachedFunds.get(fund.name)?.closeStocks ?? [],
        previousImpact: cachedFunds.get(fund.name)?.previousImpact ?? null,
      })),
      syncStatus: {
        ok: true,
        cached: false,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const cached = await loadCachedDataset();
    response.status(200).json({
      ...cached,
      syncStatus: {
        ok: false,
        cached: true,
        error: error.message,
        checkedAt: new Date().toISOString(),
      },
    });
  }
}

async function loadCachedDataset() {
  const value = await readFile(
    new URL("../data/remote-funds.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(value);
}
