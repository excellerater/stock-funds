let appData = window.__REMOTE_FUNDS__;

const elements = {
  sessionLabel: document.getElementById("sessionLabel"),
  marketTime: document.getElementById("marketTime"),
  generatedAt: document.getElementById("generatedAt"),
  refreshButton: document.getElementById("refreshButton"),
  liveTabLabel: document.getElementById("liveTabLabel"),
  viewTabs: [...document.querySelectorAll(".view-tab")],
  marketStrip: document.getElementById("marketStrip"),
  portfolioAmount: document.getElementById("portfolioAmount"),
  portfolioDaily: document.getElementById("portfolioDaily"),
  fundCount: document.getElementById("fundCount"),
  fundSearch: document.getElementById("fundSearch"),
  fundSort: document.getElementById("fundSort"),
  favoritesOnly: document.getElementById("favoritesOnly"),
  fundList: document.getElementById("fundList"),
  detailSession: document.getElementById("detailSession"),
  detailName: document.getElementById("detailName"),
  favoriteButton: document.getElementById("favoriteButton"),
  detailImpactLabel: document.getElementById("detailImpactLabel"),
  detailImpact: document.getElementById("detailImpact"),
  positionAmount: document.getElementById("positionAmount"),
  positionDaily: document.getElementById("positionDaily"),
  holdingsSection: document.getElementById("holdingsSection"),
  holdingCount: document.getElementById("holdingCount"),
  toggleStocks: document.getElementById("toggleStocks"),
  stockTable: document.getElementById("stockTable"),
  delayNote: document.getElementById("delayNote"),
  description: document.getElementById("description"),
};

const state = {
  view: "live",
  selectedId: appData?.funds?.[0]?.id ?? null,
  expandedStocks: false,
  refreshing: false,
  search: "",
  sort: "default",
  favoritesOnly: false,
  favorites: loadLocalSet("fund-favorites"),
  positions: loadLocalObject("fund-positions"),
};

elements.refreshButton.addEventListener("click", () => refreshData(true));
elements.fundSearch.addEventListener("input", () => {
  state.search = elements.fundSearch.value.trim().toLowerCase();
  renderFundList();
});
elements.fundSort.addEventListener("change", () => {
  state.sort = elements.fundSort.value;
  renderFundList();
});
elements.favoritesOnly.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  elements.favoritesOnly.classList.toggle("active", state.favoritesOnly);
  renderFundList();
});
elements.favoriteButton.addEventListener("click", () => {
  const id = String(state.selectedId);
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  saveLocal("fund-favorites", [...state.favorites]);
  window.accountSync?.saveFavorites(state.favorites);
  renderFundList();
  renderDetail();
});
elements.positionAmount.addEventListener("input", () => {
  const value = Math.max(0, Number(elements.positionAmount.value) || 0);
  if (value) {
    state.positions[String(state.selectedId)] = value;
  } else {
    delete state.positions[String(state.selectedId)];
  }
  saveLocal("fund-positions", state.positions);
  window.accountSync?.savePosition(state.selectedId, value);
  renderPortfolio();
  renderPosition();
});
elements.viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.expandedStocks = false;
    render();
  });
});
elements.toggleStocks.addEventListener("click", () => {
  state.expandedStocks = !state.expandedStocks;
  renderDetail();
});

render();
window.accountSync?.init(({ favorites, positions }) => {
  state.favorites = new Set(favorites.map(String));
  state.positions = positions;
  render();
});

if (location.protocol !== "file:") {
  elements.generatedAt.textContent = "正在获取最新数据";
  refreshData(false);
  setInterval(() => refreshData(false), 60_000);
}

function render() {
  if (!appData?.funds?.length) {
    elements.fundList.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }

  if (!appData.funds.some((fund) => fund.id === state.selectedId)) {
    state.selectedId = appData.funds[0].id;
  }

  const isCloseView = state.view === "close";
  elements.sessionLabel.textContent = isCloseView ? "收盘" : appData.session;
  elements.marketTime.textContent = isCloseView
    ? appData.closeSnapshot?.timestamp ?? "--"
    : appData.marketOverview.timestamp;
  elements.generatedAt.textContent = `获取 ${formatTime(appData.generatedAt)}`;
  if (appData.syncStatus?.cached) {
    elements.generatedAt.textContent = `本地缓存 ${formatTime(appData.generatedAt)}`;
  }
  elements.fundCount.textContent = appData.funds.length;
  elements.refreshButton.textContent = isStaticHosting() ? "检查更新" : "刷新";
  elements.liveTabLabel.textContent = `${appData.session}估值`;
  elements.viewTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  renderMarketStrip();
  renderPortfolio();
  renderFundList();
  renderDetail();
}

function renderMarketStrip() {
  const indices =
    state.view === "close"
      ? appData.closeSnapshot?.indices ?? []
      : appData.marketOverview.indices;

  elements.marketStrip.innerHTML = indices
    .map(
      (item) => `
        <article>
          <span>${escapeHtml(item.name)}</span>
          <strong class="${impactClass(item.impact)}">${formatPercent(item.impact)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderFundList() {
  elements.fundList.innerHTML = "";
  const funds = getVisibleFunds();
  elements.fundCount.textContent = `${funds.length}/${appData.funds.length}`;
  elements.favoritesOnly.textContent = state.favoritesOnly
    ? `显示全部 (${state.favorites.size})`
    : `我的自选 (${state.favorites.size})`;

  funds.forEach((fund) => {
    const impact = state.view === "close" ? fund.closeImpact : fund.impact;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fund-row${fund.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = `
      <span>
        <strong>${state.favorites.has(String(fund.id)) ? "★ " : ""}${escapeHtml(fund.name)}</strong>
        <small>${state.view === "close" ? "收盘估值" : `${fund.stocks.length} 只持仓`}</small>
      </span>
      <b class="${impactClass(impact)}">${formatPercentOrDash(impact)}</b>
    `;
    button.addEventListener("click", () => {
      state.selectedId = fund.id;
      state.expandedStocks = false;
      renderFundList();
      renderDetail();
    });
    elements.fundList.appendChild(button);
  });

  if (!funds.length) {
    elements.fundList.innerHTML = '<div class="empty-state">没有匹配的基金</div>';
  }
}

function renderDetail() {
  const fund = appData.funds.find((item) => item.id === state.selectedId);
  if (!fund) return;

  const isCloseView = state.view === "close";
  elements.detailSession.textContent = isCloseView
    ? `收盘 · ${appData.closeSnapshot?.timestamp ?? "--"}`
    : `${appData.session} · ${fund.timestamp}`;
  elements.detailName.textContent = fund.name;
  const favorite = state.favorites.has(String(fund.id));
  elements.favoriteButton.textContent = favorite ? "★ 已自选" : "☆ 加入自选";
  elements.favoriteButton.classList.toggle("active", favorite);
  elements.favoriteButton.setAttribute(
    "aria-label",
    favorite ? "移出自选" : "加入自选",
  );
  elements.detailImpactLabel.textContent = isCloseView ? "收盘估值" : "最新估值";
  setImpact(elements.detailImpact, isCloseView ? fund.closeImpact : fund.impact);
  elements.holdingsSection.hidden = false;
  elements.delayNote.textContent = isCloseView ? "" : fund.delayNote;
  elements.description.textContent = isCloseView
    ? appData.closeSnapshot?.description ?? ""
    : fund.description;

  const stocks = isCloseView ? fund.closeStocks ?? [] : fund.stocks;
  renderPosition();
  elements.holdingCount.textContent = `${stocks.length} 只`;

  const visibleStocks = state.expandedStocks
    ? stocks
    : stocks.slice(0, 12);
  elements.toggleStocks.hidden = stocks.length <= 12;
  elements.toggleStocks.textContent = state.expandedStocks ? "收起" : "展开全部";

  elements.stockTable.innerHTML = `
    <div class="stock-row stock-head">
      <span>名称</span><span>占比</span><span>涨跌</span><span>贡献</span>
    </div>
    ${visibleStocks
      .map(
        (stock) => `
          <div class="stock-row">
            <strong>${escapeHtml(stock.name)}</strong>
            <span>${formatWeight(stock.weight)}</span>
            <b class="${impactClass(stock.change)}">${formatPercent(stock.change)}</b>
            <b class="${impactClass(stockContribution(stock))}">${formatContribution(stock)}</b>
          </div>
        `,
      )
      .join("")}
  `;
}

function getVisibleFunds() {
  const impactFor = (fund) =>
    Number(state.view === "close" ? fund.closeImpact : fund.impact) || 0;
  const funds = appData.funds.filter((fund) => {
    const matchesSearch = fund.name.toLowerCase().includes(state.search);
    const matchesFavorite =
      !state.favoritesOnly || state.favorites.has(String(fund.id));
    return matchesSearch && matchesFavorite;
  });

  return funds.sort((left, right) => {
    if (state.sort === "impact-desc") return impactFor(right) - impactFor(left);
    if (state.sort === "impact-asc") return impactFor(left) - impactFor(right);
    if (state.sort === "name") return left.name.localeCompare(right.name, "zh-CN");
    return 0;
  });
}

function renderPortfolio() {
  const total = appData.funds.reduce(
    (sum, fund) => sum + (Number(state.positions[String(fund.id)]) || 0),
    0,
  );
  const daily = appData.funds.reduce((sum, fund) => {
    const amount = Number(state.positions[String(fund.id)]) || 0;
    const impact = state.view === "close" ? fund.closeImpact : fund.impact;
    return sum + (amount * (Number(impact) || 0)) / 100;
  }, 0);

  elements.portfolioAmount.textContent = formatCurrency(total);
  elements.portfolioDaily.textContent = formatSignedCurrency(daily);
  elements.portfolioDaily.className = impactClass(daily);
}

function renderPosition() {
  const fund = appData.funds.find((item) => item.id === state.selectedId);
  if (!fund) return;
  const amount = Number(state.positions[String(fund.id)]) || 0;
  const impact = state.view === "close" ? fund.closeImpact : fund.impact;
  const daily = (amount * (Number(impact) || 0)) / 100;

  if (document.activeElement !== elements.positionAmount) {
    elements.positionAmount.value = amount || "";
  }
  elements.positionDaily.textContent = formatSignedCurrency(daily);
  elements.positionDaily.className = impactClass(daily);
}

async function refreshData(manual) {
  if (state.refreshing || location.protocol === "file:") {
    if (manual && location.protocol === "file:") {
      elements.generatedAt.textContent = "请通过本地服务打开以实时刷新";
    }
    return;
  }

  state.refreshing = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = isStaticHosting() ? "检查中" : "同步中";

  try {
    const staticHosting = isStaticHosting();
    const previousGeneratedAt = appData?.generatedAt;
    const endpoint = isVercelHosting()
      ? `/api/live?t=${Date.now()}`
      : staticHosting
      ? `data/remote-funds.json?t=${Date.now()}`
      : manual
        ? "/api/refresh"
        : `/api/data?t=${Date.now()}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    appData = await response.json();
    render();
    if (manual && staticHosting && !isVercelHosting()) {
      elements.generatedAt.textContent =
        appData.generatedAt !== previousGeneratedAt
          ? `已更新 ${formatTime(appData.generatedAt)}`
          : `当前已是最新 ${formatTime(appData.generatedAt)}`;
    }
  } catch {
    elements.generatedAt.textContent = "更新失败，保留当前数据";
  } finally {
    state.refreshing = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = isStaticHosting() ? "检查更新" : "刷新";
  }
}

function isStaticHosting() {
  return (
    location.hostname.endsWith(".github.io") || location.protocol === "file:"
  );
}

function isVercelHosting() {
  return location.hostname.endsWith(".vercel.app");
}

function setImpact(element, value) {
  if (value == null || !Number.isFinite(Number(value))) {
    element.textContent = "--";
    element.className = "flat";
    return;
  }
  element.textContent = formatPercent(value);
  element.className = impactClass(value);
}

function formatPercent(value) {
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatPercentOrDash(value) {
  return value == null || !Number.isFinite(Number(value))
    ? "--"
    : formatPercent(value);
}

function formatWeight(value) {
  return `${Number(value).toFixed(2)}%`;
}

function stockContribution(stock) {
  return (Number(stock.weight) * Number(stock.change)) / 100;
}

function formatContribution(stock) {
  const value = stockContribution(stock);
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function formatCurrency(value) {
  return `¥${Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedCurrency(value) {
  const number = Number(value);
  const formatted = Math.abs(number).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}¥${formatted}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function impactClass(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function loadLocalSet(key) {
  return new Set(loadLocalArray(key).map(String));
}

function loadLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadLocalObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or storage policies may disable local persistence.
  }
}
