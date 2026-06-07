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
  portfolioValue: document.getElementById("portfolioValue"),
  portfolioPnl: document.getElementById("portfolioPnl"),
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
  ledgerHint: document.getElementById("ledgerHint"),
  ledgerDailyImpact: document.getElementById("ledgerDailyImpact"),
  ledgerEstimatedNav: document.getElementById("ledgerEstimatedNav"),
  ledgerShares: document.getElementById("ledgerShares"),
  ledgerUnitCost: document.getElementById("ledgerUnitCost"),
  ledgerRealized: document.getElementById("ledgerRealized"),
  ledgerValue: document.getElementById("ledgerValue"),
  ledgerPnlInput: document.getElementById("ledgerPnlInput"),
  ledgerReturnRateInput: document.getElementById("ledgerReturnRateInput"),
  ledgerDailyPnl: document.getElementById("ledgerDailyPnl"),
  costReverseHint: document.getElementById("costReverseHint"),
  saveReversedCostButton: document.getElementById("saveReversedCostButton"),
  navEstimateNote: document.getElementById("navEstimateNote"),
  confirmedNav: document.getElementById("confirmedNav"),
  confirmedNavDate: document.getElementById("confirmedNavDate"),
  saveNavButton: document.getElementById("saveNavButton"),
  addTransactionButton: document.getElementById("addTransactionButton"),
  transactionList: document.getElementById("transactionList"),
  transactionDialog: document.getElementById("transactionDialog"),
  transactionForm: document.getElementById("transactionForm"),
  transactionFundName: document.getElementById("transactionFundName"),
  transactionType: document.getElementById("transactionType"),
  transactionDate: document.getElementById("transactionDate"),
  transactionAmount: document.getElementById("transactionAmount"),
  transactionShares: document.getElementById("transactionShares"),
  transactionSharesField: document.getElementById("transactionSharesField"),
  transactionNav: document.getElementById("transactionNav"),
  transactionNavField: document.getElementById("transactionNavField"),
  transactionFee: document.getElementById("transactionFee"),
  transactionNotes: document.getElementById("transactionNotes"),
  transactionStatus: document.getElementById("transactionStatus"),
  closeTransactionDialog: document.getElementById("closeTransactionDialog"),
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
  navs: {},
  transactions: [],
  reversedCost: null,
  reversedFundId: null,
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
  renderLedger();
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
elements.addTransactionButton.addEventListener("click", openTransactionDialog);
elements.closeTransactionDialog.addEventListener("click", () =>
  elements.transactionDialog.close(),
);
elements.transactionType.addEventListener("change", updateTransactionFields);
elements.transactionForm.addEventListener("submit", saveTransaction);
elements.saveNavButton.addEventListener("click", saveConfirmedNav);
elements.ledgerPnlInput.addEventListener("input", () =>
  updateReversedCost("pnl"),
);
elements.ledgerReturnRateInput.addEventListener("input", () =>
  updateReversedCost("rate"),
);
elements.saveReversedCostButton.addEventListener("click", saveReversedCost);

render();
window.accountSync?.init(({ favorites, positions, transactions = [], navs = {} }) => {
  state.favorites = new Set(favorites.map(String));
  state.positions = positions;
  state.transactions = transactions;
  state.navs = navs;
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
  renderLedger();
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
  const summaries = appData.funds.map((fund) =>
    calculateLedger(String(fund.id), state.transactions),
  );
  const total = summaries.reduce((sum, summary) => sum + summary.netInvested, 0);
  const hasLedger = summaries.some((summary) => summary.count > 0);
  const hasCompleteValue =
    hasLedger &&
    summaries.every((summary, index) => {
      if (summary.shares <= 0) return true;
      return Number.isFinite(state.navs[String(appData.funds[index].id)]?.nav);
    });
  let portfolioValue = 0;
  let portfolioPnl = summaries.reduce(
    (sum, summary) => sum + summary.realized,
    0,
  );
  summaries.forEach((summary, index) => {
    const fund = appData.funds[index];
    const estimatedNav = getEstimatedNav(fund);
    if (Number.isFinite(estimatedNav)) {
      const value = summary.shares * estimatedNav;
      portfolioValue += value;
      portfolioPnl += value - summary.cost;
    }
  });
  const daily = appData.funds.reduce((sum, fund) => {
    const ledger = calculateLedger(String(fund.id), state.transactions);
    const estimatedNav = getEstimatedNav(fund);
    const amount = Number.isFinite(estimatedNav)
      ? ledger.shares * estimatedNav
      : Number(state.positions[String(fund.id)]) || 0;
    const impact = state.view === "close" ? fund.closeImpact : fund.impact;
    return sum + (amount * (Number(impact) || 0)) / 100;
  }, 0);

  elements.portfolioAmount.textContent = formatCurrency(total);
  elements.portfolioValue.textContent = hasCompleteValue
    ? formatCurrency(portfolioValue)
    : "--";
  elements.portfolioPnl.textContent = hasCompleteValue
    ? formatSignedCurrency(portfolioPnl)
    : "--";
  elements.portfolioPnl.className = hasCompleteValue
    ? impactClass(portfolioPnl)
    : "flat";
  elements.portfolioDaily.textContent = formatSignedCurrency(daily);
  elements.portfolioDaily.className = impactClass(daily);
}

function renderLedger() {
  const id = String(state.selectedId);
  if (state.reversedFundId !== id) {
    state.reversedCost = null;
    state.reversedFundId = id;
  }
  const summary = calculateLedger(id, state.transactions);
  const navRecord = state.navs[id];
  const signedIn = window.accountSync?.isSignedIn();
  const fund = appData.funds.find((item) => String(item.id) === id);
  const impact = fund
    ? Number(state.view === "close" ? fund.closeImpact : fund.impact)
    : null;
  const estimatedNav = fund ? getEstimatedNav(fund) : null;
  const referenceValue = Number(state.positions[id]) || 0;
  const canValue =
    referenceValue > 0 ||
    (summary.shares === 0 ? summary.count > 0 : Number.isFinite(estimatedNav));
  const value = canValue
    ? summary.shares > 0 && Number.isFinite(estimatedNav)
      ? summary.shares * estimatedNav
      : referenceValue
    : null;
  const holdingPnl =
    value == null || summary.cost <= 0 ? null : value - summary.cost;
  const returnRate =
    holdingPnl == null || summary.cost <= 0
      ? null
      : (holdingPnl / summary.cost) * 100;
  const unitCost = summary.shares > 0 ? summary.cost / summary.shares : null;
  const dailyPnl =
    navRecord && Number.isFinite(impact)
      ? summary.shares * navRecord.nav * (impact / 100)
      : null;

  elements.ledgerHint.textContent = signedIn
    ? `${summary.count} 笔交易${navRecord?.date ? ` · 基准净值 ${navRecord.date}` : ""}`
    : "登录后记录真实交易";
  setMetricPercent(elements.ledgerDailyImpact, impact);
  elements.ledgerEstimatedNav.textContent = Number.isFinite(estimatedNav)
    ? formatNumber(estimatedNav, 4)
    : "--";
  elements.ledgerShares.textContent = formatNumber(summary.shares, 4);
  elements.ledgerUnitCost.textContent =
    unitCost == null ? "--" : formatNumber(unitCost, 4);
  elements.ledgerRealized.textContent = formatSignedCurrency(summary.realized);
  elements.ledgerRealized.className = impactClass(summary.realized);
  elements.ledgerValue.textContent = value == null ? "--" : formatCurrency(value);
  if (document.activeElement !== elements.ledgerPnlInput) {
    elements.ledgerPnlInput.value =
      holdingPnl == null ? "" : roundForInput(holdingPnl, 2);
  }
  if (document.activeElement !== elements.ledgerReturnRateInput) {
    elements.ledgerReturnRateInput.value =
      returnRate == null ? "" : roundForInput(returnRate, 2);
  }
  elements.ledgerPnlInput.className =
    holdingPnl == null ? "flat" : impactClass(holdingPnl);
  elements.ledgerReturnRateInput.className =
    returnRate == null ? "flat" : impactClass(returnRate);
  elements.ledgerPnlInput.disabled = !signedIn;
  elements.ledgerReturnRateInput.disabled = !signedIn;
  elements.saveReversedCostButton.disabled =
    !signedIn || state.reversedCost == null;
  elements.ledgerDailyPnl.textContent =
    dailyPnl == null ? "--" : formatSignedCurrency(dailyPnl);
  elements.ledgerDailyPnl.className =
    dailyPnl == null ? "flat" : impactClass(dailyPnl);
  elements.navEstimateNote.textContent = navRecord
    ? `估算净值 = ${formatNumber(navRecord.nav, 4)} × (1 ${impact >= 0 ? "+" : "-"} ${formatNumber(Math.abs(impact || 0), 2)}%)。正式净值公布后请更新基准。`
    : "保存基金最近一次正式净值后，系统会结合当前涨跌自动计算估算净值。";
  elements.confirmedNav.value = navRecord?.nav || "";
  elements.confirmedNavDate.value = navRecord?.date || "";
  elements.confirmedNav.disabled = !signedIn;
  elements.confirmedNavDate.disabled = !signedIn;
  elements.saveNavButton.disabled = !signedIn;

  const transactions = state.transactions
    .filter((item) => item.fund_id === id)
    .slice()
    .sort((a, b) => b.trade_date.localeCompare(a.trade_date));
  elements.transactionList.innerHTML = transactions.length
    ? transactions
        .map(
          (item) => `
            <div class="transaction-row">
              <div>
                <strong>${transactionTypeName(item.transaction_type)}</strong>
                <span>${item.trade_date}${item.notes ? ` · ${escapeHtml(item.notes)}` : ""}</span>
              </div>
              <div>
                <strong>${formatCurrency(item.amount)}</strong>
                <span>${item.shares ? `${formatNumber(item.shares, 4)} 份` : ""}</span>
              </div>
              <button type="button" data-transaction-id="${item.id}" aria-label="删除交易">删除</button>
            </div>
          `,
        )
        .join("")
    : '<div class="empty-ledger">还没有交易记录</div>';
  elements.transactionList
    .querySelectorAll("[data-transaction-id]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        deleteTransaction(button.dataset.transactionId),
      ),
    );
}

function getEstimatedNav(fund) {
  const baseNav = state.navs[String(fund.id)]?.nav;
  const impact = Number(state.view === "close" ? fund.closeImpact : fund.impact);
  if (!Number.isFinite(baseNav) || !Number.isFinite(impact)) return null;
  return baseNav * (1 + impact / 100);
}

function setMetricPercent(element, value) {
  if (!Number.isFinite(value)) {
    element.textContent = "--";
    element.className = "flat";
    return;
  }
  element.textContent = formatPercent(value);
  element.className = impactClass(value);
}

function calculateLedger(fundId, transactions) {
  let shares = 0;
  let cost = 0;
  let realized = 0;
  let netInvested = 0;
  let count = 0;
  transactions
    .filter((item) => item.fund_id === fundId)
    .slice()
    .sort((a, b) =>
      `${a.trade_date}${a.created_at || ""}`.localeCompare(
        `${b.trade_date}${b.created_at || ""}`,
      ),
    )
    .forEach((item) => {
      count += 1;
      if (item.transaction_type === "buy") {
        shares += item.shares || 0;
        cost += item.amount + item.fee;
        netInvested += item.amount + item.fee;
      } else if (item.transaction_type === "sell") {
        const soldShares = Math.min(item.shares || 0, shares);
        const removedCost = shares > 0 ? (cost / shares) * soldShares : 0;
        shares -= soldShares;
        cost -= removedCost;
        realized += item.amount - item.fee - removedCost;
        netInvested -= item.amount - item.fee;
      } else if (item.transaction_type === "dividend") {
        realized += item.amount - item.fee;
        netInvested -= item.amount - item.fee;
      } else if (item.transaction_type === "cost_basis") {
        shares = item.shares || shares;
        cost = item.amount;
        netInvested = item.amount;
      }
    });
  return { shares, cost: Math.max(0, cost), realized, netInvested, count };
}

function updateReversedCost(source) {
  const fund = appData.funds.find((item) => item.id === state.selectedId);
  const summary = calculateLedger(String(state.selectedId), state.transactions);
  const estimatedNav = fund ? getEstimatedNav(fund) : null;
  const referenceValue =
    Number(state.positions[String(state.selectedId)]) || 0;
  const value =
    Number.isFinite(estimatedNav) && summary.shares > 0
      ? summary.shares * estimatedNav
      : referenceValue > 0
        ? referenceValue
        : null;
  if (value == null) {
    elements.costReverseHint.textContent =
      "请先填写上方“估值参考金额”作为当前持有金额";
    return clearReversedCost(false);
  }

  let cost;
  if (source === "pnl") {
    if (!elements.ledgerPnlInput.value.trim()) return clearReversedCost();
    const pnl = Number(elements.ledgerPnlInput.value);
    if (!Number.isFinite(pnl)) return clearReversedCost();
    cost = value - pnl;
  } else {
    if (!elements.ledgerReturnRateInput.value.trim()) return clearReversedCost();
    const rate = Number(elements.ledgerReturnRateInput.value);
    if (!Number.isFinite(rate) || rate <= -100) {
      elements.costReverseHint.textContent = "收益率必须大于 -100%";
      return clearReversedCost(false);
    }
    cost = value / (1 + rate / 100);
  }

  if (!(cost > 0)) {
    elements.costReverseHint.textContent = "反推后的成本必须大于 0";
    return clearReversedCost(false);
  }

  const pnl = value - cost;
  const rate = (pnl / cost) * 100;
  state.reversedCost = cost;
  state.reversedFundId = String(state.selectedId);
  if (source !== "pnl") {
    elements.ledgerPnlInput.value = roundForInput(pnl, 2);
  }
  if (source !== "rate") {
    elements.ledgerReturnRateInput.value = roundForInput(rate, 2);
  }
  elements.costReverseHint.textContent = `将当前持仓成本调整为 ${formatCurrency(cost)}`;
  elements.saveReversedCostButton.disabled = false;
}

function clearReversedCost(resetHint = true) {
  state.reversedCost = null;
  elements.saveReversedCostButton.disabled = true;
  if (resetHint) {
    elements.costReverseHint.textContent =
      "输入持有收益或收益率，可建立当前成本快照";
  }
}

async function saveReversedCost() {
  if (
    !(state.reversedCost > 0) ||
    state.reversedFundId !== String(state.selectedId)
  ) {
    return;
  }
  const id = String(state.selectedId);
  const summary = calculateLedger(id, state.transactions);
  const fund = appData.funds.find((item) => item.id === state.selectedId);
  const estimatedNav = fund ? getEstimatedNav(fund) : null;
  const referenceValue = Number(state.positions[id]) || 0;
  const snapshotShares =
    summary.shares > 0
      ? summary.shares
      : Number.isFinite(estimatedNav) && referenceValue > 0
        ? referenceValue / estimatedNav
        : 0;
  if (!(snapshotShares > 0)) {
    elements.costReverseHint.textContent =
      "请先保存上次确认净值，系统才能根据持有金额反推份额";
    return;
  }
  elements.saveReversedCostButton.disabled = true;
  elements.costReverseHint.textContent = "正在保存成本调整";
  const result = await window.accountSync.saveCostBasis(
    id,
    state.reversedCost,
    snapshotShares,
  );
  if (result.error) {
    elements.costReverseHint.textContent = result.error;
    elements.saveReversedCostButton.disabled = false;
    return;
  }
  state.transactions.push(result.data);
  state.reversedCost = null;
  renderPortfolio();
  renderLedger();
  elements.costReverseHint.textContent = "持仓成本已按输入值调整";
}

function openTransactionDialog() {
  if (!window.accountSync?.isSignedIn()) {
    document.getElementById("accountButton").click();
    return;
  }
  const fund = appData.funds.find((item) => item.id === state.selectedId);
  elements.transactionFundName.textContent = fund?.name || "";
  elements.transactionForm.reset();
  elements.transactionType.value = "buy";
  elements.transactionDate.value = new Date().toISOString().slice(0, 10);
  elements.transactionFee.value = "0";
  elements.transactionStatus.textContent = "";
  updateTransactionFields();
  elements.transactionDialog.showModal();
}

function updateTransactionFields() {
  const dividend = elements.transactionType.value === "dividend";
  elements.transactionSharesField.hidden = dividend;
  elements.transactionNavField.hidden = dividend;
  elements.transactionShares.required = !dividend;
}

async function saveTransaction(event) {
  event.preventDefault();
  const type = elements.transactionType.value;
  const amount = Number(elements.transactionAmount.value);
  const shares = Number(elements.transactionShares.value);
  if (!(amount > 0) || (type !== "dividend" && !(shares > 0))) {
    elements.transactionStatus.textContent = "请填写有效的金额和份额";
    return;
  }
  if (
    type === "sell" &&
    shares > calculateLedger(String(state.selectedId), state.transactions).shares
  ) {
    elements.transactionStatus.textContent = "卖出份额不能超过当前持有份额";
    return;
  }
  elements.transactionStatus.textContent = "正在保存";
  const result = await window.accountSync.addTransaction({
    fund_id: String(state.selectedId),
    transaction_type: type,
    trade_date: elements.transactionDate.value,
    amount,
    shares: type === "dividend" ? null : shares,
    nav:
      type === "dividend"
        ? null
        : Number(elements.transactionNav.value) || amount / shares,
    fee: Number(elements.transactionFee.value) || 0,
    notes: elements.transactionNotes.value.trim() || null,
  });
  if (result.error) {
    elements.transactionStatus.textContent = result.error;
    return;
  }
  state.transactions.push(result.data);
  elements.transactionDialog.close();
  renderPortfolio();
  renderLedger();
}

async function deleteTransaction(id) {
  if (!window.confirm("确定删除这笔交易吗？删除后收益会重新计算。")) {
    return;
  }
  const result = await window.accountSync.deleteTransaction(id);
  if (result.error) return;
  state.transactions = state.transactions.filter((item) => item.id !== id);
  renderPortfolio();
  renderLedger();
}

async function saveConfirmedNav() {
  const nav = Number(elements.confirmedNav.value);
  if (!(nav > 0) || !window.accountSync?.isSignedIn()) return;
  elements.saveNavButton.disabled = true;
  const result = await window.accountSync.saveConfirmedNav(
    state.selectedId,
    nav,
    elements.confirmedNavDate.value,
  );
  elements.saveNavButton.disabled = false;
  if (result.error) return;
  state.navs[String(state.selectedId)] = {
    nav,
    date: elements.confirmedNavDate.value || null,
  };
  renderPortfolio();
  renderLedger();
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

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
  });
}

function transactionTypeName(type) {
  return {
    buy: "买入",
    sell: "卖出",
    dividend: "分红",
    cost_basis: "成本调整",
  }[type] || type;
}

function roundForInput(value, digits) {
  return Number(value.toFixed(digits));
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
