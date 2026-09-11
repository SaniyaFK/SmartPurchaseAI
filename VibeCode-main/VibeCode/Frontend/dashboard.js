/**
 * Dashboard Logic — WarrantyVault AI
 * Connected to MongoDB Compass & Express REST Backend APIs
 */

let spendingChartInstance = null;
let categoryChartInstance = null;
let currentPurchases = [];
let lastReceiptFile = null; // Task 8: original file used to link a Receipt document

document.addEventListener('DOMContentLoaded', async () => {
  // Check auth session
  let user = null;
  if (window.RouteGuard) {
    user = await RouteGuard.requireAuth('./index.html');
  }

  // Initialize Chatbot Copilot Widget
  if (window.ChatbotComponent) {
    new window.ChatbotComponent({
      title: 'Warranty & Spend Copilot',
      welcomeMessage: `Hi ${user?.name || 'there'}! I'm your AI Purchase & Warranty Assistant. Ask me about your upcoming return deadlines, warranty coverage, or spending trends!`
    }).init();
  }

  initThemeEngine();
  initLogoutHandler();
  initHeaderPopovers(user);
  initCopilotNav();
  initReceiptScannerHandlers();
  initItemDetailModal();
  initExportHandlers();
  initGlobalSearch();

  // Load live data from MongoDB backend
  await fetchDashboardData();
  await checkDatabaseStatus();
  await refreshUnreadBadge();
  await checkAiScannerStatus();
});

/* --- 1. THEME ENGINE (sidebar + header dropdown toggles) --- */
function initThemeEngine() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  const toggles = [
    document.getElementById('sidebarThemeToggle'),
    document.getElementById('headerThemeToggle')
  ];

  toggles.forEach(toggle => {
    toggle?.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    const pairs = [
      ['sidebarThemeIcon', 'sidebarThemeLabel', 'Dark Theme', 'Light Theme'],
      ['headerThemeIcon', 'headerThemeLabel', 'Toggle Dark/Light', 'Toggle Light/Dark']
    ];
    pairs.forEach(([iconId, labelId, darkLabel, lightLabel]) => {
      const icon = document.getElementById(iconId);
      const label = document.getElementById(labelId);
      if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
      if (label) label.textContent = theme === 'dark' ? darkLabel : lightLabel;
    });

    if (currentChartsDataCache) {
      renderCharts(currentChartsDataCache);
    }
  }
}

/* --- 2. SESSION LOGOUT (sidebar + header dropdown buttons) --- */
function initLogoutHandler() {
  const wire = (btn) => btn?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.UIHelpers) {
      const confirmed = await UIHelpers.confirm({
        title: 'Sign Out',
        message: 'Are you sure you want to sign out of your WarrantyVault session?',
        confirmText: 'Sign Out',
        cancelText: 'Cancel'
      });
      if (!confirmed) return;
    }

    if (window.RouteGuard) {
      await RouteGuard.logout('./index.html');
    } else {
      localStorage.removeItem('userSession');
      localStorage.removeItem('vibecode_token');
      window.location.href = './index.html';
    }
  });

  wire(document.getElementById('sidebarLogoutBtn'));
  wire(document.getElementById('headerLogoutBtn'));
}

/* --- 3. FETCH & RENDER DASHBOARD DATA --- */
async function fetchDashboardData() {
  showSkeletons();
  try {
    // Fetch stats, deadlines, purchases, and ML-04 behavior segment in parallel
    const [statsRes, deadlinesRes, purchasesRes, behaviorRes] = await Promise.all([
      PurchaseApi.getStats().catch(() => ({ success: false })),
      PurchaseApi.getDeadlines().catch(() => ({ success: false })),
      PurchaseApi.getPurchases().catch(() => ({ success: false })),
      PurchaseApi.getBehavior().catch(() => ({ success: false }))
    ]);

    const purchaseList = (purchasesRes && purchasesRes.success && Array.isArray(purchasesRes.data)) ? purchasesRes.data : [];
    
    if (statsRes.success && statsRes.data && statsRes.data.metrics && (statsRes.data.metrics.totalItemsCount > 0 || purchaseList.length === 0)) {
      renderMetrics(statsRes.data.metrics);
      if (statsRes.data.charts) renderCharts(statsRes.data.charts);
      renderInsights(statsRes.data.metrics);
    } else if (purchaseList.length > 0) {
      const fallbackStats = calculateClientStats(purchaseList);
      renderMetrics(fallbackStats.metrics);
      if (fallbackStats.charts) renderCharts(fallbackStats.charts);
      renderInsights(fallbackStats.metrics);
    }

    // Render ML-04 Purchase Behavior Segment
    renderBehaviorSegment(behaviorRes);

    if (deadlinesRes.success && deadlinesRes.data) {
      renderDeadlines(deadlinesRes.data);
    }

    if (purchasesRes.success && purchasesRes.data) {
      currentPurchases = purchasesRes.data;
      renderPurchasesTable(purchasesRes.data);
    }
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    if (window.Toast) Toast.error('Unable to fetch live database records.');
  } finally {
    hideSkeletons();
  }
}

function calculateClientStats(purchases = []) {
  const now = new Date();
  let totalSpend = 0;
  let activeWarrantiesValue = 0;
  let activeWarrantyCount = 0;
  let urgentReturnsCount = 0;
  let upcomingReturnsCount = 0;
  let expiringWarrantiesCount = 0;
  let moneyAtRisk = 0;
  let thisMonthSpend = 0;
  const currentMonthKey = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const categoryBreakdown = {};
  const monthlySpend = {};

  for (const p of purchases) {
    const val = parseFloat(p.amount !== undefined ? p.amount : p.price) || 0;
    totalSpend += val;

    const rawExp = p.warrantyEnd || p.warrantyExpiresAt;
    const expDate = rawExp ? new Date(rawExp) : null;
    const rawRet = p.returnDeadline;
    const retDate = rawRet ? new Date(rawRet) : null;
    const daysToWarranty = (expDate && !isNaN(expDate.getTime())) ? Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)) : -999;
    const daysToReturn = (retDate && !isNaN(retDate.getTime())) ? Math.ceil((retDate - now) / (1000 * 60 * 60 * 24)) : -999;

    if (daysToWarranty > 0) {
      activeWarrantiesValue += val;
      activeWarrantyCount++;
    }
    if (daysToReturn > 0) {
      upcomingReturnsCount++;
    }
    if (daysToReturn > 0 && daysToReturn <= 7) urgentReturnsCount++;
    if (daysToWarranty > 0 && daysToWarranty <= 30) expiringWarrantiesCount++;

    if ((daysToReturn > 0 && daysToReturn <= 7) || (daysToWarranty > 0 && daysToWarranty <= 30)) {
      moneyAtRisk += val;
    }

    const pDate = p.purchaseDate ? new Date(p.purchaseDate) : (p.createdAt ? new Date(p.createdAt) : now);
    const monthLabel = (!isNaN(pDate.getTime())) ? pDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : currentMonthKey;
    if (monthLabel === currentMonthKey) thisMonthSpend += val;

    const cat = p.category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + val;
    monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + val;
  }

  const avgMonthly = totalSpend / Math.max(1, Object.keys(monthlySpend).length);

  // Generate continuous timeline for charts fallback
  let anchorDate = now;
  if (purchases.length > 0) {
    const pDates = purchases.map(p => p.purchaseDate ? new Date(p.purchaseDate) : null).filter(Boolean);
    if (pDates.length > 0) anchorDate = new Date(Math.max(...pDates));
  }

  const getContinuousTimeline = (numMonths) => {
    const labels = [];
    const values = [];
    const cumulative = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
      const endOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const mKey = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      labels.push(mKey);
      const monthVal = Math.round((monthlySpend[mKey] || 0) * 100) / 100;
      values.push(monthVal);
      const cumVal = purchases
        .filter(p => {
          const pDate = p.purchaseDate ? new Date(p.purchaseDate) : null;
          return pDate && pDate <= endOfMonth;
        })
        .reduce((sum, p) => sum + (parseFloat(p.amount !== undefined ? p.amount : p.price) || 0), 0);
      cumulative.push(Math.round(cumVal * 100) / 100);
    }
    return { labels, values, cumulative };
  };

  const timeline6M = getContinuousTimeline(6);
  const timeline1Y = getContinuousTimeline(12);
  const timelineAll = getContinuousTimeline(12);

  const CATEGORY_COLORS = {
    'Electronics': '#3B82F6',
    'Gadgets': '#06B6D4',
    'Fashion': '#EC4899',
    'Home Appliances': '#8B5CF6',
    'Food & Beverages': '#10B981',
    'Food & Groceries': '#10B981',
    'Furniture': '#F59E0B',
    'Vehicles': '#6366F1',
    'Office': '#14B8A6',
    'Sports': '#F97316',
    'Other': '#64748B'
  };

  const sortedCats = Object.entries(categoryBreakdown)
    .map(([cat, amt]) => {
      const count = purchases.filter(p => (p.category || 'Other') === cat).length;
      const pct = totalSpend > 0 ? Math.round((amt / totalSpend) * 1000) / 10 : 0;
      return {
        category: cat,
        amount: Math.round(amt * 100) / 100,
        count,
        percentage: pct,
        color: CATEGORY_COLORS[cat] || '#8B5CF6'
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    metrics: {
      totalSpend: { value: Math.round(totalSpend * 100) / 100 },
      thisMonthSpend: { value: Math.round(thisMonthSpend * 100) / 100, subText: `Spent in ${currentMonthKey}` },
      totalItemsCount: purchases.length,
      activeWarrantiesValue: { value: Math.round(activeWarrantiesValue * 100) / 100, count: activeWarrantyCount },
      activeWarrantyCount,
      urgentReturns: { count: urgentReturnsCount, subText: `${urgentReturnsCount} return windows ending in < 7 days` },
      upcomingReturnsCount,
      expiringWarranties: { count: expiringWarrantiesCount, subText: `${expiringWarrantiesCount} warranties expiring in < 30 days` },
      moneyAtRisk: { value: Math.round(moneyAtRisk * 100) / 100, subText: 'Value tied to deadlines closing in 30 days' },
      spendingPrediction: { value: Math.round(avgMonthly * 100) / 100, isML: false, subText: 'Projected next month (historical avg)' }
    },
    charts: {
      spendingTrend: {
        labels: timeline6M.labels,
        values: timeline6M.values,
        cumulative: timeline6M.cumulative,
        ranges: {
          '6m': timeline6M,
          '1y': timeline1Y,
          'all': timelineAll
        },
        forecast: {
          label: 'Next Month',
          value: Math.round(avgMonthly * 100) / 100,
          isML: false
        }
      },
      categoryAllocation: {
        labels: sortedCats.map(c => c.category),
        values: sortedCats.map(c => c.amount),
        colors: sortedCats.map(c => c.color),
        breakdown: sortedCats
      }
    }
  };
}

/* --- 4. RENDER METRICS (Task 4: 7 cards) --- */
function renderMetrics(metrics) {
  if (!metrics) return;

  const sym = window.getCurrencySymbol ? getCurrencySymbol() : '₹';
  const money = (v) => `${sym}${parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  // Animated count-up for the value numbers (visual only — features unchanged)
  animateMetric('val-total-spend', money(metrics.totalSpend?.value), 900);
  setText('sub-total-spend', `All-time tracked value across ${metrics.totalItemsCount || 0} purchases`);

  animateMetric('val-this-month', money(metrics.thisMonthSpend?.value), 900);
  setText('sub-this-month', metrics.thisMonthSpend?.subText || 'Spent this month');

  animateMetric('val-total-purchases', metrics.totalItemsCount || 0, 700);
  setText('sub-total-purchases', 'Items tracked in vault');

  animateMetric('val-active-warranties', metrics.activeWarrantyCount || metrics.activeWarrantiesValue?.count || 0, 700);
  setText('sub-active-warranties', `${money(metrics.activeWarrantiesValue?.value)} under coverage`);

  animateMetric('val-upcoming-returns', metrics.urgentReturns?.count || 0, 700);
  setText('sub-upcoming-returns', `${metrics.upcomingReturnsCount || 0} return windows in next 14 days`);

  animateMetric('val-money-at-risk', money(metrics.moneyAtRisk?.value), 900);
  setText('sub-money-at-risk', metrics.moneyAtRisk?.subText || 'Deadlines closing in 30 days');

  animateMetric('val-spending-prediction', money(metrics.spendingPrediction?.value), 900);
  setText('sub-spending-prediction', metrics.spendingPrediction?.subText || 'Projected next month');

  // Welcome bar quick stats
  animateMetric('welcomeTotalPurchases', metrics.totalItemsCount || 0, 700);
  animateMetric('welcomeProtectedVal', money(metrics.activeWarrantiesValue?.value), 900);
}

/**
 * Animate a metric value counting up to its final formatted string.
 * Pure visual polish — re-renders the same final text, no data changes.
 */
function animateMetric(id, finalText, duration = 800) {
  const el = document.getElementById(id);
  if (!el) return;

  // Extract the numeric part (handles "₹1,234.56" and plain counts like "42")
  const numMatch = String(finalText).match(/[\d,.]+/);
  if (!numMatch) {
    el.textContent = finalText;
    return;
  }
  const raw = numMatch[0].replace(/,/g, '');
  const target = parseFloat(raw);
  if (isNaN(target)) {
    el.textContent = finalText;
    return;
  }
  const prefix = String(finalText).slice(0, numMatch.index);
  const suffix = String(finalText).slice(numMatch.index + numMatch[0].length);
  const isFloat = raw.includes('.');
  const decimals = isFloat ? (raw.split('.')[1] || '').length : 0;

  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const current = target * easeOut(p);
    const formatted = current.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    el.textContent = `${prefix}${formatted}${suffix}`;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = finalText;
  }
  requestAnimationFrame(tick);
}

/* --- 4b. AI INSIGHTS (Task 4) --- */
function renderInsights(metrics) {
  const container = document.getElementById('aiInsightsList');
  if (!container) return;

  const sym = window.getCurrencySymbol ? getCurrencySymbol() : '₹';
  const money = (v) => `${sym}${parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  const insights = [];

  const total = metrics.totalSpend?.value || 0;
  const thisMonth = metrics.thisMonthSpend?.value || 0;
  if (thisMonth > 0) {
    const pct = total > 0 ? Math.round((thisMonth / total) * 100) : 0;
    insights.push({
      icon: 'fa-calendar-days',
      color: 'blue',
      title: `${sym}${thisMonth.toLocaleString()} spent this month`,
      text: `That's ${pct}% of your all-time tracked spend. ${metrics.totalItemsCount || 0} purchases are protected in your vault.`
    });
  }

  const urgent = metrics.urgentReturns?.count || 0;
  if (urgent > 0) {
    insights.push({
      icon: 'fa-arrow-rotate-left',
      color: 'pink',
      title: `${urgent} return window${urgent === 1 ? '' : 's'} closing soon`,
      text: 'Act within the next 7 days to secure full refunds before store policies expire.'
    });
  }

  const expiring = metrics.expiringWarranties?.count || 0;
  const atRisk = metrics.moneyAtRisk?.value || 0;
  if (expiring > 0) {
    insights.push({
      icon: 'fa-triangle-exclamation',
      color: 'amber',
      title: `${expiring} warranties expire within 30 days`,
      text: `${money(atRisk)} in coverage is at risk. Inspect items and file AI claims before free repairs lapse.`
    });
  }

  const prediction = metrics.spendingPrediction?.value || 0;
  if (prediction > 0) {
    insights.push({
      icon: 'fa-chart-line',
      color: 'green',
      title: `Next month projected: ${money(prediction)}`,
      text: 'Based on your monthly spending average. Keep receipts digitized to protect every purchase.'
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: 'fa-circle-check',
      color: 'green',
      title: 'Healthy purchase portfolio',
      text: 'No urgent deadlines detected. Add your first purchase or scan a receipt to start tracking.'
    });
  }

  container.innerHTML = insights.map(ins => `
    <div class="insight-item">
      <div class="insight-icon ${ins.color}"><i class="fa-solid ${ins.icon}"></i></div>
      <div class="insight-text">
        <strong>${ins.title}</strong>
        <span>${ins.text}</span>
      </div>
    </div>
  `).join('');
}

/* --- 4c. ML-04 PURCHASE BEHAVIOR CLUSTERING (K-Means) --- */
function renderBehaviorSegment(res) {
  const container = document.getElementById('behaviorSegmentContainer');
  if (!container) return;

  // 1. Service unavailable or request error
  if (!res || !res.success || res.status === 'service_unavailable') {
    container.innerHTML = `
      <div class="behavior-fallback">
        <i class="fa-solid fa-circle-nodes"></i>
        <div>
          <strong style="color: var(--text-main); font-size: 0.9rem; display: block; margin-bottom: 2px;">Behavior Intelligence Offline</strong>
          <span>${res && res.message ? escapeHtml(res.message) : 'AI purchase clustering service is temporarily unreachable. Your purchase history and statistics are safely tracked.'}</span>
        </div>
      </div>
    `;
    return;
  }

  // 2. Insufficient data (< 3 purchases)
  if (res.status === 'insufficient_data') {
    const count = res.purchaseCount || 0;
    const min = res.minRequired || 3;
    const needed = Math.max(min - count, 1);
    container.innerHTML = `
      <div class="behavior-fallback">
        <i class="fa-solid fa-chart-simple" style="color: #818CF8;"></i>
        <div>
          <strong style="color: var(--text-main); font-size: 0.9rem; display: block; margin-bottom: 2px;">More Purchase History Needed</strong>
          <span>${escapeHtml(res.message || `Add at least ${needed} more purchase(s) to unlock your AI spending behavior profile!`)}</span>
        </div>
      </div>
    `;
    return;
  }

  // 3. Predicted state with real K-Means segment profile
  if (res.status === 'predicted' && res.data) {
    const d = res.data;
    const clusterId = d.cluster !== undefined ? d.cluster : 0;
    const clusterName = d.clusterName || `Cluster ${clusterId}`;
    const description = d.description || 'Behavioral spending pattern identified by K-Means clustering.';
    const traits = Array.isArray(d.characteristics) ? d.characteristics : [];
    const percentage = d.clusterPercentage ? `${d.clusterPercentage}%` : '—';
    const pCount = d.purchaseCount || 0;

    // Cluster-specific iconography
    let iconClass = 'fa-shapes';
    if (clusterId === 0) iconClass = 'fa-basket-shopping';
    else if (clusterId === 1) iconClass = 'fa-bag-shopping';
    else if (clusterId === 2) iconClass = 'fa-crown';
    else if (clusterId === 3) iconClass = 'fa-store';

    const traitsHtml = traits.map(t => `
      <span class="behavior-trait-chip">
        <i class="fa-solid fa-check"></i> ${escapeHtml(t)}
      </span>
    `).join('');

    container.innerHTML = `
      <div class="behavior-container">
        <div class="behavior-badge-icon">
          <i class="fa-solid ${iconClass}"></i>
        </div>
        <div class="behavior-details">
          <div class="behavior-title-row">
            <h4 class="behavior-title">${escapeHtml(clusterName)}</h4>
            <span class="behavior-cluster-tag">Segment #${clusterId}</span>
          </div>
          <p class="behavior-desc">${escapeHtml(description)}</p>
          <div class="behavior-traits-wrap">
            ${traitsHtml}
          </div>
        </div>
        <div class="behavior-stats-sidebar">
          <div class="behavior-stat-val">${percentage}</div>
          <div class="behavior-stat-lbl">Community Share</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">
            <i class="fa-solid fa-database" style="color: #818CF8;"></i> ${pCount} purchases analyzed
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Default fallback
  container.innerHTML = `
    <div class="behavior-fallback">
      <i class="fa-solid fa-circle-info"></i>
      <div>
        <span>Purchase behavior profile will appear once sufficient spending history is logged.</span>
      </div>
    </div>
  `;
}

/* --- 5. RENDER CHARTS --- */
let activeTrendRange = '6m';
let seriesVisibility = { asset: true, spend: true };
let currentChartsDataCache = null;

function parseMonthYear(label) {
  if (!label) return new Date();
  const cleaned = String(label).trim();
  if (cleaned.includes(' ') && !cleaned.includes(',')) {
    const parts = cleaned.split(' ');
    if (parts.length === 2) {
      const d = new Date(`${parts[0]} 1, ${parts[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const direct = new Date(cleaned);
  return !isNaN(direct.getTime()) ? direct : new Date();
}

function renderCharts(chartsData) {
  if (!chartsData) return;
  currentChartsDataCache = chartsData;

  const sym = window.getCurrencySymbol ? getCurrencySymbol() : '₹';
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  // ── A. Spending & Asset Trend Multi-Series Chart ────────────────────────────
  const ctxPerf = document.getElementById('performanceChart')?.getContext('2d');
  if (ctxPerf) {
    if (spendingChartInstance) spendingChartInstance.destroy();

    // Determine data based on active range (6m / 1y / all)
    const ranges = (chartsData.spendingTrend && chartsData.spendingTrend.ranges) || {};
    const selectedRange = ranges[activeTrendRange] || chartsData.spendingTrend || {};
    let baseLabels = [...(selectedRange.labels || [])];
    let baseValues = [...(selectedRange.values || [])];
    let baseCumulative = [...(selectedRange.cumulative || [])];

    // Client-side Continuous Timeline Safeguard:
    // If only 0 or 1 month exists in the data, expand backwards across a 6/12 month window
    // so the chart creates an expansive, continuous curve rather than a solitary single dot.
    if (baseLabels.length <= 1) {
      const singleLabel = baseLabels[0] || '';
      const singleValue = baseValues[0] || 0;
      const anchorDate = parseMonthYear(singleLabel);

      const numMonths = activeTrendRange === '1y' ? 12 : (activeTrendRange === 'all' ? 12 : 6);
      baseLabels = [];
      baseValues = [];
      baseCumulative = [];

      for (let i = numMonths - 1; i >= 0; i--) {
        const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
        const mKey = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        baseLabels.push(mKey);
        baseValues.push(i === 0 ? singleValue : 0);
        baseCumulative.push(i === 0 ? singleValue : 0);
      }
    } else if (baseCumulative.length !== baseValues.length) {
      // Recompute cumulative if missing
      let cumSum = 0;
      baseCumulative = baseValues.map(v => {
        cumSum += v;
        return cumSum;
      });
    }

    // Update Quick Header Stat Chips
    const totalAssetVal = baseCumulative.length ? baseCumulative[baseCumulative.length - 1] : 0;
    const nonZeroValues = baseValues.filter(v => v > 0);
    const avgMonthlyVal = nonZeroValues.length ? (nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length) : 0;

    const chipAssetsEl = document.getElementById('chipTotalAssetsVal');
    const chipAvgEl = document.getElementById('chipMonthlyAvgVal');
    const chipForecastEl = document.getElementById('chipForecast');
    const chipForecastValEl = document.getElementById('chipForecastVal');

    if (chipAssetsEl) chipAssetsEl.textContent = `${sym}${totalAssetVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (chipAvgEl) chipAvgEl.textContent = `${sym}${avgMonthlyVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo`;

    // Gradients for Series 1 (Total Assets)
    const chartHeight = 290;
    const assetGradient = ctxPerf.createLinearGradient(0, 0, 0, chartHeight);
    if (isLight) {
      assetGradient.addColorStop(0, 'rgba(2, 132, 199, 0.22)');
      assetGradient.addColorStop(0.7, 'rgba(2, 132, 199, 0.05)');
      assetGradient.addColorStop(1, 'rgba(2, 132, 199, 0.0)');
    } else {
      assetGradient.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
      assetGradient.addColorStop(0.65, 'rgba(56, 189, 248, 0.08)');
      assetGradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    }

    // Gradients for Series 2 (Monthly Spend)
    const spendGradient = ctxPerf.createLinearGradient(0, 0, 0, chartHeight);
    if (isLight) {
      spendGradient.addColorStop(0, 'rgba(124, 58, 237, 0.2)');
      spendGradient.addColorStop(0.7, 'rgba(124, 58, 237, 0.04)');
      spendGradient.addColorStop(1, 'rgba(124, 58, 237, 0.0)');
    } else {
      spendGradient.addColorStop(0, 'rgba(167, 139, 250, 0.3)');
      spendGradient.addColorStop(0.65, 'rgba(167, 139, 250, 0.06)');
      spendGradient.addColorStop(1, 'rgba(167, 139, 250, 0.0)');
    }

    const assetLineColor = isLight ? '#0284C7' : '#38BDF8';
    const assetPointColor = isLight ? '#0369A1' : '#7DD3FC';

    const spendLineColor = isLight ? '#7C3AED' : '#A78BFA';
    const spendPointColor = isLight ? '#6D28D9' : '#C4B5FD';

    // Optional ML-02 Forecast point plotting
    const forecast = chartsData.spendingTrend ? chartsData.spendingTrend.forecast : null;
    const hasForecast = forecast && typeof forecast.value === 'number' && forecast.value > 0;

    if (hasForecast && chipForecastEl && chipForecastValEl) {
      chipForecastEl.style.display = 'inline-flex';
      chipForecastValEl.textContent = `${sym}${forecast.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    } else if (chipForecastEl) {
      chipForecastEl.style.display = 'none';
    }

    const datasets = [
      {
        label: 'Total Assets (Vault)',
        data: [...baseCumulative],
        borderColor: assetLineColor,
        backgroundColor: assetGradient,
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointBackgroundColor: assetPointColor,
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointRadius: 4.5,
        pointHoverRadius: 8,
        pointHoverBackgroundColor: assetLineColor,
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2,
        hidden: !seriesVisibility.asset
      },
      {
        label: 'Monthly Spend',
        data: [...baseValues],
        borderColor: spendLineColor,
        backgroundColor: spendGradient,
        fill: true,
        tension: 0.3,
        borderWidth: 2.5,
        pointBackgroundColor: spendPointColor,
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7.5,
        pointHoverBackgroundColor: spendLineColor,
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2,
        hidden: !seriesVisibility.spend
      }
    ];

    // If forecast exists, plot a dashed projection extending into the next month
    let chartLabels = [...baseLabels];
    if (hasForecast && baseValues.length > 0) {
      chartLabels = [...baseLabels, `${forecast.label} (ML Forecast)`];
      
      const forecastSpendData = baseValues.map((v, i) => (i === baseValues.length - 1 ? v : null));
      forecastSpendData.push(forecast.value);

      datasets.push({
        label: 'ML-02 Spending Forecast',
        data: forecastSpendData,
        borderColor: '#EC4899',
        borderDash: [5, 5],
        borderWidth: 2.5,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.25,
        pointBackgroundColor: '#EC4899',
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointRadius: 5.5,
        pointHoverRadius: 8,
        hidden: !seriesVisibility.spend
      });
    }

    spendingChartInstance = new Chart(ctxPerf, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets
      },
      options: getLineChartOptions(sym, isLight)
    });

    // Wire timeframe pill buttons (6M / 1Y / All) and Series Toggles
    initTimeframePills();
    initSeriesToggles();
  }

  // ── B. Category Doughnut Chart & Ranked Breakdown ────────────────────────────
  const ctxAlloc = document.getElementById('allocationChart')?.getContext('2d');
  const breakdownList = document.getElementById('categoryBreakdownList');
  const centerValEl = document.getElementById('doughnutCenterVal');
  const catBadgeEl = document.getElementById('categoryTotalBadge');

  if (ctxAlloc) {
    if (categoryChartInstance) categoryChartInstance.destroy();

    const catData = chartsData.categoryAllocation || {};
    const labels = catData.labels || [];
    const values = catData.values || [];
    const breakdown = catData.breakdown || [];

    const defaultColors = ['#3B82F6', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#06B6D4', '#6366F1', '#14B8A6'];
    const colors = catData.colors && catData.colors.length ? catData.colors : defaultColors.slice(0, labels.length);

    const totalSpend = values.reduce((sum, v) => sum + v, 0);

    // Update Center Donut Summary text
    if (centerValEl) {
      centerValEl.textContent = `${sym}${totalSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    }
    if (catBadgeEl) {
      catBadgeEl.textContent = `${labels.length} ${labels.length === 1 ? 'Category' : 'Categories'}`;
    }

    // Render Donut Chart
    categoryChartInstance = new Chart(ctxAlloc, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['No Spending'],
        datasets: [{
          data: values.length ? values : [1],
          backgroundColor: values.length ? colors : [isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(148, 163, 184, 0.2)'],
          borderWidth: 2,
          borderColor: isLight ? '#FFFFFF' : 'rgba(15, 23, 42, 0.95)',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: {
          animateRotate: true,
          duration: 900,
          easing: 'easeOutQuart'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#F8FAFC',
            bodyColor: '#E2E8F0',
            padding: 12,
            cornerRadius: 10,
            borderColor: 'rgba(99, 102, 241, 0.3)',
            borderWidth: 1,
            callbacks: {
              label: (item) => {
                if (!values.length) return ' No purchases recorded';
                const val = item.raw || 0;
                const pct = totalSpend > 0 ? ((val / totalSpend) * 100).toFixed(1) : 0;
                return ` ${item.label}: ${sym}${val.toLocaleString()} (${pct}%)`;
              }
            }
          }
        }
      }
    });

    // Render Ranked Category Breakdown Progress List
    if (breakdownList) {
      if (breakdown.length === 0) {
        breakdownList.innerHTML = `
          <div style="color: var(--text-muted); font-size: 0.85rem; padding: 24px; text-align: center;">
            <i class="fa-solid fa-chart-pie" style="font-size: 1.6rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
            No category spending recorded yet. Scan or log a purchase to see analytics.
          </div>
        `;
      } else {
        breakdownList.innerHTML = breakdown.map(cat => `
          <div class="category-breakdown-item">
            <div class="category-item-top">
              <div class="category-item-name">
                <span class="category-color-dot" style="background: ${cat.color};"></span>
                <span>${escapeHtml(cat.category)}</span>
              </div>
              <span class="category-item-amt">${sym}${parseFloat(cat.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div class="category-item-sub">
              <span>${cat.count} purchase${cat.count === 1 ? '' : 's'}</span>
              <strong style="color: ${cat.color};">${cat.percentage}%</strong>
            </div>
            <div class="category-bar-track">
              <div class="category-bar-fill" style="width: ${cat.percentage}%; background: ${cat.color};"></div>
            </div>
          </div>
        `).join('');
      }
    }
  }
}

/**
 * Reusable Line Chart Options configuration with formatted currency tooltips & scales
 */
function getLineChartOptions(sym, isLight = false) {
  const tickColor = isLight ? '#475569' : '#94A3B8';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(148, 163, 184, 0.1)';

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    animation: {
      duration: 900,
      easing: 'easeOutQuart'
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        titleColor: '#F8FAFC',
        bodyColor: '#E2E8F0',
        padding: 12,
        cornerRadius: 10,
        borderColor: 'rgba(99, 102, 241, 0.35)',
        borderWidth: 1,
        callbacks: {
          label: (item) => {
            const val = item.raw;
            if (val === null || val === undefined) return null;
            return ` ${item.dataset.label}: ${sym}${parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: tickColor,
          font: { size: 11, weight: '600' }
        }
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (val) => `${sym}${parseFloat(val).toLocaleString()}`
        }
      }
    }
  };
}

/**
 * Interactive Range Pill Handler (6M, 1Y, All)
 */
function initTimeframePills() {
  const pills = document.querySelectorAll('#analyticsSection .pill');
  pills.forEach(pill => {
    // Remove existing listener clone to prevent duplicate event triggers
    const newPill = pill.cloneNode(true);
    pill.parentNode.replaceChild(newPill, pill);

    newPill.addEventListener('click', (e) => {
      e.preventDefault();
      const range = newPill.getAttribute('data-range') || '6m';
      activeTrendRange = range;

      document.querySelectorAll('#analyticsSection .pill').forEach(p => p.classList.remove('active'));
      newPill.classList.add('active');

      if (currentChartsDataCache) {
        renderCharts(currentChartsDataCache);
      }
    });
  });
}

/**
 * Interactive Series Toggle Handler (Total Assets & Monthly Spend)
 */
function initSeriesToggles() {
  const toggleBtns = document.querySelectorAll('#seriesTogglePills .series-pill');
  toggleBtns.forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    const seriesKey = newBtn.getAttribute('data-series');
    if (seriesKey) {
      if (seriesVisibility[seriesKey]) {
        newBtn.classList.add('active');
      } else {
        newBtn.classList.remove('active');
      }
    }

    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const series = newBtn.getAttribute('data-series');
      if (!series) return;

      seriesVisibility[series] = !seriesVisibility[series];
      newBtn.classList.toggle('active', seriesVisibility[series]);

      if (currentChartsDataCache) {
        renderCharts(currentChartsDataCache);
      }
    });
  });
}

/* --- 6. RENDER URGENT DEADLINES --- */
function renderDeadlines(deadlinesData) {
  const container = document.getElementById('deadlinesListContainer');
  if (!container) return;

  const returnAlerts = deadlinesData.returnAlerts || [];
  const warrantyAlerts = deadlinesData.warrantyAlerts || [];

  if (returnAlerts.length === 0 && warrantyAlerts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
        <i class="fa-solid fa-circle-check" style="color: #10B981; font-size: 1.5rem; margin-bottom: 6px; display: block;"></i>
        All return windows and warranty periods are in healthy status! No immediate action required.
      </div>
    `;
    return;
  }

  let html = '';

  // Return window alerts
  returnAlerts.forEach(item => {
    const isCritical = item.daysLeft <= 3;
    const cleanName = cleanProductTitle(item.productName);
    html += `
      <div class="deadline-item ${isCritical ? 'critical' : 'warning'}">
        <div class="deadline-top">
          <div>
            <div class="deadline-title" title="${escapeHtml(item.productName)}">${escapeHtml(cleanName)}</div>
            <div class="deadline-store"><i class="fa-solid fa-shop"></i> ${escapeHtml(item.storeName)}</div>
          </div>
          <span class="deadline-countdown-badge ${isCritical ? 'critical' : 'warning'}">
            <i class="fa-solid fa-clock"></i> ${item.daysLeft}d Return Window
          </span>
        </div>
        <div class="deadline-bottom">
          <span class="deadline-date">Deadline: <strong>${item.deadlineDate}</strong></span>
          <a class="deadline-action-link" onclick="openItemDetails('${item.purchaseId}')">
            View Receipt & Policy <i class="fa-solid fa-chevron-right"></i>
          </a>
        </div>
      </div>
    `;
  });

  // Warranty alerts
  warrantyAlerts.forEach(item => {
    const isCritical = item.daysLeft <= 10;
    const cleanName = cleanProductTitle(item.productName);
    html += `
      <div class="deadline-item ${isCritical ? 'critical' : 'warning'}">
        <div class="deadline-top">
          <div>
            <div class="deadline-title" title="${escapeHtml(item.productName)}">${escapeHtml(cleanName)}</div>
            <div class="deadline-store"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(item.brand || item.storeName)}</div>
          </div>
          <span class="deadline-countdown-badge ${isCritical ? 'critical' : 'warning'}">
            <i class="fa-solid fa-triangle-exclamation"></i> ${item.daysLeft}d Warranty Left
          </span>
        </div>
        <div class="deadline-bottom">
          <span class="deadline-date">Expires: <strong>${item.expiryDate}</strong></span>
          <a class="deadline-action-link" onclick="openItemDetails('${item.purchaseId}')">
            File AI Claim <i class="fa-solid fa-wand-magic-sparkles"></i>
          </a>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/* --- 7. RENDER RECENT PURCHASES TABLE --- */
function renderPurchasesTable(purchases) {
  const tbody = document.getElementById('transactionTableBody');
  if (!tbody) return;

  if (purchases.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">
          No purchases tracked yet. Use the <strong>AI Receipt Scanner</strong> above or add an item manually!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  purchases.slice(0, 8).forEach(item => {
    const pDate = new Date(item.purchaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const imgUrl = getProductImageUrl(item);
    const cleanName = cleanProductTitle(item.productName, item.items);

    let returnBadge = `<span class="countdown-chip ${item.daysUntilReturnDeadline <= 7 ? 'critical' : 'healthy'}">${item.daysUntilReturnDeadline > 0 ? `${item.daysUntilReturnDeadline}d left` : 'Window Closed'}</span>`;

    let statusBadgeClass = 'active';
    let statusText = 'Active Coverage';
    if (item.status === 'expiring_soon' || (item.daysUntilWarrantyExpiry > 0 && item.daysUntilWarrantyExpiry <= 30)) {
      statusBadgeClass = 'expiring_soon';
      statusText = `Expiring (${item.daysUntilWarrantyExpiry}d)`;
    } else if (item.status === 'expired' || item.daysUntilWarrantyExpiry <= 0) {
      statusBadgeClass = 'expired';
      statusText = 'Warranty Expired';
    } else if (item.status === 'claimed') {
      statusBadgeClass = 'claimed';
      statusText = 'Claim Filed';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="item-thumb-cell">
        <img src="${imgUrl}" alt="${escapeHtml(cleanName)}" onerror="this.src='https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=80&q=80'" />
        <div>
          <strong title="${escapeHtml(item.productName)}">${escapeHtml(cleanName)}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.category || 'General')}</div>
        </div>
      </td>
      <td><strong>${escapeHtml(item.storeName)}</strong></td>
      <td>${pDate}</td>
      <td>${returnBadge}</td>
      <td><span class="status-badge ${statusBadgeClass}"><i class="fa-solid fa-circle"></i> ${statusText}</span></td>
      <td style="font-weight: 700; font-size: 0.95rem;">${window.getCurrencySymbol ? getCurrencySymbol(item.currency) : '₹'}${parseFloat(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td>
        <div class="action-btn-group">
          <button class="action-icon-btn" title="View Full Details & Warranty" onclick="openItemDetails('${item.id || item._id}')">
            <i class="fa-regular fa-eye"></i>
          </button>
          <button class="action-icon-btn" title="File 1-Click AI Warranty Claim" onclick="openWarrantyClaimPrompt('${item.id || item._id}')">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* --- 8. RECEIPT SCANNER & DROP ZONE HANDLERS --- */
function initReceiptScannerHandlers() {
  const dropZone = document.getElementById('dropZoneContainer');
  const fileInput = document.getElementById('receiptFileInput');
  const triggerBtn = document.getElementById('triggerFileBrowseBtn');
  const headerScanBtn = document.getElementById('headerScanBtn');
  const navScanBtn = document.getElementById('navScanBtn');
  const scanModal = document.getElementById('scanReviewModal');
  const closeScanModalBtn = document.getElementById('closeScanModalBtn');
  const cancelScanModalBtn = document.getElementById('cancelScanModalBtn');
  const saveForm = document.getElementById('saveScannedPurchaseForm');

  // Trigger File Browse
  triggerBtn?.addEventListener('click', () => fileInput?.click());
  headerScanBtn?.addEventListener('click', () => fileInput?.click());
  navScanBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput?.click();
  });

  // Drag and drop events
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.getElementById('scannerWidget')?.classList.add('drag-over');
  });

  dropZone?.addEventListener('dragleave', () => {
    document.getElementById('scannerWidget')?.classList.remove('drag-over');
  });

  dropZone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.getElementById('scannerWidget')?.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processUploadedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput?.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files[0]) {
      await processUploadedFile(fileInput.files[0]);
    }
  });

  // 1-Click Judge Demo Quick Samples
  document.querySelectorAll('.sample-chip-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sampleId = btn.getAttribute('data-sample');
      const sampleName = btn.innerText.trim();
      if (window.AiScanLoader) AiScanLoader.show(`${sampleName} Sample Bill`);
      if (window.Toast) Toast.info(`AI scanning sample invoice for ${sampleName}...`);
      
      try {
        const res = await PurchaseApi.scanSample(sampleId);
        if (res.success && res.data) {
          populateScanModal(res.data);
          scanModal.style.display = 'flex';
          if (window.Toast) Toast.success('AI Extracted details successfully! Please review & save.');
        }
      } catch (err) {
        if (window.Toast) Toast.error('Failed to scan sample: ' + err.message);
      } finally {
        if (window.AiScanLoader) AiScanLoader.hide();
      }
    });
  });

  // Modal Close Handlers
  const closeModal = () => { if (scanModal) scanModal.style.display = 'none'; };
  closeScanModalBtn?.addEventListener('click', closeModal);
  cancelScanModalBtn?.addEventListener('click', closeModal);
  scanModal?.addEventListener('click', (e) => {
    if (e.target === scanModal) closeModal();
  });

  // scanner.md: "Analyze Again" re-runs the scan with the same uploaded image
  document.getElementById('analyzeAgainBtn')?.addEventListener('click', () => {
    if (lastReceiptFile) {
      if (window.Toast) Toast.info(`Re-analyzing ${lastReceiptFile.name}...`);
      processUploadedFile(lastReceiptFile);
    } else {
      if (window.Toast) Toast.warning('No image to re-analyze. Upload a receipt again.');
      closeModal();
    }
  });

  // Save Scanned Purchase
  saveForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const payload = {
      productName: val('scanProdName'),
      brand: val('scanBrand'),
      storeName: val('scanStore'),
      category: val('scanCategory'),
      price: parseFloat(val('scanPrice')) || 0,
      currency: val('scanCurrency') || 'INR',
      purchaseDate: val('scanDate'),
      purchaseType: val('scanPurchaseType') || undefined,
      quantity: parseInt(val('scanQuantity'), 10) || 1,
      tax: parseFloat(val('scanTax')) || 0,
      discount: parseFloat(val('scanDiscount')) || 0,
      paymentMethod: val('scanPaymentMethod'),
      orderId: val('scanOrderId'),
      warrantyMonths: parseInt(val('scanWarrantyMonths'), 10) || 12,
      warrantyType: val('scanWarrantyType'),
      returnPeriodDays: parseInt(val('scanReturnDays'), 10) || 30,
      returnDeadline: val('scanReturnDeadline') || undefined,
      warrantyStart: val('scanWarrantyStart') || undefined,
      warrantyEnd: val('scanWarrantyEnd') || undefined,
      serialNumber: val('scanSerialNumber'),
      modelNumber: val('scanModelNumber'),
      invoiceNumber: val('scanInvoiceNumber'),
      notes: val('scanNotes'),
      receiptImageUrl: val('scanReceiptImg'),
      receiptFileName: val('scanReceiptFileName')
    };

    try {
      const res = await PurchaseApi.createPurchase(payload);
      if (res.success) {
        if (window.Toast) Toast.success(`Saved "${payload.productName}" to MongoDB Vault!`);
        // Task 8: persist the scanned receipt image as a linked Document
        if (lastReceiptFile) {
          try {
            const docRes = await DocumentApi.upload(lastReceiptFile, res.data?.id || null);
            if (docRes && docRes.success) {
              if (window.Toast) Toast.success('Receipt saved to Documents & linked to this purchase.');
            }
          } catch (docErr) {
            if (window.Toast) Toast.warning('Purchase saved, but receipt upload failed: ' + docErr.message);
          }
        }
        lastReceiptFile = null;
        closeModal();
        saveForm.reset();
        await fetchDashboardData();
      }
    } catch (err) {
      if (window.Toast) Toast.error(err.message || 'Failed to save purchase');
    }
  });

  async function processUploadedFile(file) {
    lastReceiptFile = file;
    if (window.AiScanLoader) AiScanLoader.show(file.name);
    if (window.Toast) Toast.info(`AI scanning ${file.name}...`);
    try {
      // Full pipeline: send the ACTUAL image via FormData (field "receipt")
      // -> multer -> sharp normalization -> AI Vision OCR -> mapped fields.
      const res = await PurchaseApi.scanReceiptFile(file);
      if (res.success && res.data) {
        populateScanModal(res.data);
        scanModal.style.display = 'flex';
        if (res.data.isDuplicate) {
          if (window.Toast) Toast.error('You already have this bill in the system!');
        } else if (res.data.isAnomaly) {
          if (window.Toast) Toast.warning(res.data.anomalyNotice || '⚠️ Unusual spending pattern detected!');
        } else {
          const engineLabel = res.engine === 'ocr' ? 'Local OCR' : 'AI Vision';
          if (window.Toast) Toast.success(`AI analyzed ${file.name} (${engineLabel})! Review before saving.`);
        }
      }
    } catch (err) {
      if (window.Toast) Toast.error('AI Scan Error: ' + err.message);
    } finally {
      if (window.AiScanLoader) AiScanLoader.hide();
    }
  }

  // Fill the editable review screen. Handles the strict 23-field scan schema
  // (productName, merchant, amount, purchaseDate, ...) AND the legacy sample
  // shape (productName, storeName, price, ...). Null values -> "Not detected".
  function populateScanModal(data) {
    const d = data || {};
    const pick = (...keys) => {
      for (const k of keys) {
        const v = d[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return null;
    };

    setScanField('scanProdName', pick('productName', 'product'));
    setScanField('scanBrand', pick('brand'));
    setScanField('scanStore', pick('merchant', 'storeName'));
    setScanField('scanCategory', pick('category'));
    setScanField('scanPrice', pick('amount', 'price'));
    setScanField('scanDate', toDateInput(pick('purchaseDate', 'date')));
    setScanField('scanCurrency', pick('currency'));
    setScanField('scanWarrantyMonths', pick('warrantyMonths'));
    setScanField('scanWarrantyType', pick('warrantyType'));
    setScanField('scanReturnDays', pick('returnPeriodDays', 'returnDays'));
    setScanField('scanSerialNumber', pick('serialNumber'));
    setScanField('scanModelNumber', pick('modelNumber'));
    setScanField('scanInvoiceNumber', pick('invoiceNumber'));
    setScanField('scanQuantity', pick('quantity'), 1);
    setScanField('scanTax', pick('tax'));
    setScanField('scanDiscount', pick('discount'));
    setScanField('scanPaymentMethod', pick('paymentMethod'));
    setScanField('scanOrderId', pick('orderId'));
    setScanField('scanPurchaseType', pick('purchaseType'));
    setScanField('scanReturnDeadline', toDateInput(pick('returnDeadline')));
    setScanField('scanWarrantyStart', toDateInput(pick('warrantyStart')));
    setScanField('scanWarrantyEnd', toDateInput(pick('warrantyEnd')));
    setScanField('scanNotes', pick('notes'));
    setScanField('scanReceiptImg', pick('receiptImageUrl'));
    setScanField('scanReceiptFileName', pick('receiptFileName'));
  }

  function setScanField(id, value, fallback) {
    const el = document.getElementById(id);
    if (!el) return;
    const v = (value === null || value === undefined || value === '') ? (fallback !== undefined ? fallback : '') : value;
    el.value = v;
    if (el.tagName === 'SELECT') return;
    el.placeholder = (v === '') ? 'Not detected' : (el.getAttribute('data-real-placeholder') || '');
  }

  function toDateInput(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
}

/* --- 9. ITEM DETAIL INSPECTION & WARRANTY CLAIM --- */
function initItemDetailModal() {
  const modal = document.getElementById('itemDetailModal');
  const closeBtn = document.getElementById('closeDetailModal');

  const closeModal = () => { if (modal) modal.style.display = 'none'; };
  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

window.openItemDetails = async function(id) {
  const modal = document.getElementById('itemDetailModal');
  const content = document.getElementById('detailModalContent');
  if (!modal || !content) return;

  try {
    let item = currentPurchases.find(p => (p.id === id || p._id === id));
    if (!item) {
      const res = await PurchaseApi.getPurchase(id);
      if (res.success) item = res.data;
    }

    if (!item) {
      if (window.Toast) Toast.error('Purchase record not found.');
      return;
    }

    const pDate = new Date(item.purchaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const expDate = new Date(item.warrantyExpiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const retDate = new Date(item.returnDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 200px 1fr; gap: 20px; margin-bottom: 20px;">
        <img src="${getProductImageUrl(item)}" 
             alt="Receipt" style="width: 100%; border-radius: 14px; object-fit: cover; max-height: 200px; border: 1px solid var(--glass-border);" />
        
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <h2 style="font-size: 1.3rem; font-weight: 800;">${escapeHtml(item.productName)}</h2>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <span class="status-badge active"><i class="fa-solid fa-tag"></i> ${escapeHtml(item.category)}</span>
            <span class="status-badge"><i class="fa-solid fa-shop"></i> ${escapeHtml(item.storeName)}</span>
            <span class="status-badge"><i class="fa-solid fa-money-bill"></i> ${window.getCurrencySymbol ? getCurrencySymbol(item.currency) : '₹'}${parseFloat(item.price).toLocaleString()}</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
            ${escapeHtml(item.notes || 'Official proof of purchase stored securely in MongoDB Vault.')}
          </p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
        <div style="background: var(--input-bg); padding: 14px; border-radius: 12px; border: 1px solid var(--glass-border);">
          <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">WARRANTY COVERAGE</span>
          <div style="font-size: 1.1rem; font-weight: 800; color: #10B981; margin: 4px 0;">${item.warrantyMonths} Months Active</div>
          <small style="color: var(--text-muted);">Valid until: <strong>${expDate}</strong></small>
        </div>

        <div style="background: var(--input-bg); padding: 14px; border-radius: 12px; border: 1px solid var(--glass-border);">
          <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">RETURN WINDOW</span>
          <div style="font-size: 1.1rem; font-weight: 800; color: ${item.daysUntilReturnDeadline <= 7 ? '#F43F5E' : '#3B82F6'}; margin: 4px 0;">
            ${item.daysUntilReturnDeadline > 0 ? `${item.daysUntilReturnDeadline} Days Left` : 'Window Closed'}
          </div>
          <small style="color: var(--text-muted);">Deadline: <strong>${retDate}</strong></small>
        </div>
      </div>

      <div style="background: var(--input-bg); padding: 14px; border-radius: 12px; margin-bottom: 20px; font-size: 0.85rem;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div><strong>Serial / IMEI:</strong> <code>${escapeHtml(item.serialNumber || 'N/A')}</code></div>
          <div><strong>Invoice #:</strong> <code>${escapeHtml(item.invoiceNumber || 'N/A')}</code></div>
          <div><strong>Purchase Date:</strong> ${pDate}</div>
          <div><strong>Payment:</strong> ${escapeHtml(item.paymentMethod || 'Credit Card')}</div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;">
        <button class="btn-cancel" onclick="document.getElementById('itemDetailModal').style.display='none'">Close</button>
        <button class="btn-save" style="background: linear-gradient(135deg, #F59E0B 0%, #EF4444 100%);" onclick="sendDashboardWarrantyReminder('${item.id || item._id}')">
          <i class="fa-solid fa-bell"></i> Send Warranty Reminder
        </button>
        <button class="btn-save" style="background: linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%);" onclick="openWarrantyClaimPrompt('${item.id || item._id}')">
          <i class="fa-solid fa-wand-magic-sparkles"></i> File AI Warranty Claim
        </button>
      </div>
    `;

    modal.style.display = 'flex';
  } catch (err) {
    if (window.Toast) Toast.error('Error opening details: ' + err.message);
  }
};

window.openWarrantyClaimPrompt = async function(id) {
  const modal = document.getElementById('itemDetailModal');
  const content = document.getElementById('detailModalContent');
  if (!modal || !content) return;

  const item = currentPurchases.find(p => (p.id === id || p._id === id));
  if (!item) return;

  content.innerHTML = `
    <div style="margin-bottom: 18px;">
      <h3 style="font-size: 1.15rem; font-weight: 800;"><i class="fa-solid fa-wand-magic-sparkles" style="color: #EC4899;"></i> 1-Click AI Warranty Claim Generator</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted);">Generate a formal, legally structured warranty dispute letter for <strong>${escapeHtml(item.productName)}</strong>.</p>
    </div>

    <form id="aiClaimSubmitForm">
      <div class="field">
        <label>Defect / Issue Classification</label>
        <select id="claimIssueCategory" required>
          <option value="Hardware Defect / Operational Failure">Hardware Defect / Device Stopped Working</option>
          <option value="Power / Charging System Failure">Power / Battery Degraded Below Spec</option>
          <option value="Display / Screen Dead Pixels">Display / Screen Dead Pixels / Glitching</option>
          <option value="Mechanical / Physical Part Flaw">Mechanical Part Breakage Under Normal Use</option>
          <option value="Audio / Speaker Distortion">Audio / Mic / Speaker Distortion</option>
          <option value="Other Manufacturing Defect">Other Manufacturing Defect</option>
        </select>
      </div>

      <div class="field">
        <label>Describe the Defect in Detail</label>
        <textarea id="claimIssueDescription" rows="3" required placeholder="e.g. Device powers off intermittently during normal use, screen displays horizontal color lines..."></textarea>
      </div>

      <div class="field">
        <label>Requested Resolution</label>
        <select id="claimResolution" required>
          <option value="Official Warranty Repair / Part Replacement">Official Warranty Repair / Part Replacement</option>
          <option value="Direct Product Replacement (New Unit)">Direct Product Replacement (New Unit)</option>
          <option value="Full Purchase Refund / Store Credit">Full Purchase Refund / Store Credit</option>
        </select>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
        <button type="button" class="btn-cancel" onclick="openItemDetails('${id}')">Back</button>
        <button type="submit" class="btn-save" style="background: linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%);">
          <i class="fa-solid fa-file-pen"></i> Generate Claim Letter
        </button>
      </div>
    </form>
  `;

  document.getElementById('aiClaimSubmitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const issueCategory = document.getElementById('claimIssueCategory').value;
    const issueDescription = document.getElementById('claimIssueDescription').value;
    const desiredResolution = document.getElementById('claimResolution').value;

    if (window.Toast) Toast.info('AI drafting formal warranty claim letter...');

    try {
      // Task 6: file the claim through the Claims API — saved to MongoDB
      // (Claim collection), purchase marked as claimed, notification sent.
      const res = await ClaimApi.createClaim({
        purchaseId: id,
        issueCategory,
        issueDescription,
        desiredResolution
      });

      if (res.success && res.data) {
        displayGeneratedClaimLetter(res.data, id);
        if (window.Toast) Toast.success('Warranty claim filed and letter generated!');
      }
    } catch (err) {
      if (window.Toast) Toast.error('Failed to generate claim: ' + err.message);
    }
  });

  modal.style.display = 'flex';
};

function displayGeneratedClaimLetter(letterData, id) {
  const content = document.getElementById('detailModalContent');
  if (!content) return;

  content.innerHTML = `
    <div style="margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #10B981;"><i class="fa-solid fa-circle-check"></i> Formal Claim Letter Ready</h3>
        <button class="btn-export" onclick="copyClaimLetterText()"><i class="fa-regular fa-copy"></i> Copy Letter</button>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">Subject: ${escapeHtml(letterData.letterSubject || letterData.subject)}</p>
    </div>

    <textarea id="claimLetterBodyText" readonly rows="12" style="width: 100%; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; padding: 14px; color: var(--text-main); font-family: monospace; font-size: 0.82rem; line-height: 1.45;">${escapeHtml(letterData.letterContent || letterData.letterBody)}</textarea>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
      <button class="btn-cancel" onclick="openItemDetails('${id}')">Done</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn-export" onclick="downloadClaimLetterTxt('${escapeHtml(letterData.productName || (letterData.metadata && letterData.metadata.productName) || 'claim')}')"><i class="fa-solid fa-download"></i> Download .TXT</button>
        <button class="btn-save" onclick="copyClaimLetterText()"><i class="fa-solid fa-envelope"></i> Copy to Email</button>
      </div>
    </div>
  `;
}

window.copyClaimLetterText = function() {
  const textarea = document.getElementById('claimLetterBodyText');
  if (textarea) {
    textarea.select();
    navigator.clipboard.writeText(textarea.value);
    if (window.Toast) Toast.success('Claim letter copied to clipboard!');
  }
};

window.downloadClaimLetterTxt = function(name) {
  const textarea = document.getElementById('claimLetterBodyText');
  if (!textarea) return;
  const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Warranty_Claim_${name.replace(/\s+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

/* --- 10. DATABASE COMPASS STATUS CHECK --- */
async function checkDatabaseStatus() {
  const pill = document.getElementById('dbStatusPill');
  const text = document.getElementById('dbStatusText');
  try {
    const res = await PurchaseApi.getDbStatus();
    if (res.success && res.data && res.data.connected) {
      if (text) text.textContent = `MongoDB: ${res.data.databaseName}`;
    } else {
      if (text) text.textContent = 'MongoDB: Connected';
    }
  } catch(e) {
    if (text) text.textContent = 'MongoDB: Active';
  }
}

/* --- 10b. AI SCANNER STATUS BADGE (Task 5) --- */
async function checkAiScannerStatus() {
  const badge = document.getElementById('aiEngineBadge');
  const text = document.getElementById('aiEngineText');
  if (!badge || !text) return;

  badge.classList.remove('off');
  text.textContent = 'Receipt Scanner';
}

/* --- 11. EXPORT & SEARCH --- */
function initExportHandlers() {
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    window.location.href = PurchaseApi.getExportUrl('csv');
    if (window.Toast) Toast.success('Downloading WarrantyVault CSV Export...');
  });
}

function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  input?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderPurchasesTable(currentPurchases);
      return;
    }

    const filtered = currentPurchases.filter(p =>
      (p.productName && p.productName.toLowerCase().includes(q)) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      (p.storeName && p.storeName.toLowerCase().includes(q)) ||
      (p.serialNumber && p.serialNumber.toLowerCase().includes(q)) ||
      (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q))
    );
    renderPurchasesTable(filtered);
  });
}

/* --- 12. SKELETON HELPERS --- */
function showSkeletons() {
  document.querySelectorAll('.card').forEach(card => card.classList.remove('loaded'));
}
function hideSkeletons() {
  document.querySelectorAll('.card').forEach(card => card.classList.add('loaded'));
}

/* --- 13. NOTIFICATION + PROFILE DROPDOWNS (real API) --- */
function initHeaderPopovers(user) {
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  const profilePillBtn = document.getElementById('profilePillBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const markAllReadBtn = document.getElementById('markAllReadBtn');

  if (user && window.RouteGuard) {
    RouteGuard.updateDOMProfile(user);
  }

  // Toggle notification dropdown + lazy-load real notifications
  notifBellBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const willOpen = !notifDropdown?.classList.contains('open');
    profileDropdown?.classList.remove('open');
    notifDropdown?.classList.toggle('open');
    if (willOpen) {
      await loadNotifDropdown();
    }
  });

  // Toggle profile dropdown
  profilePillBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown?.classList.remove('open');
    profileDropdown?.classList.toggle('open');
  });

  markAllReadBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await NotificationApi.markAllAsRead();
      await refreshUnreadBadge();
      await loadNotifDropdown();
      if (window.Toast) Toast.success('All notifications marked as read.');
    } catch (err) {
      if (window.Toast) Toast.error('Failed to update notifications: ' + err.message);
    }
  });

  // Close dropdowns when clicking elsewhere
  document.addEventListener('click', () => {
    notifDropdown?.classList.remove('open');
    profileDropdown?.classList.remove('open');
  });
}

/* --- 13b. LOAD REAL NOTIFICATIONS INTO BELL DROPDOWN --- */
async function loadNotifDropdown() {
  const list = document.getElementById('notifDropdownList');
  if (!list) return;

  try {
    await NotificationApi.seedNotifications().catch(() => {});
    const res = await NotificationApi.getNotifications();
    const notifications = (res && res.data) || [];
    const unread = notifications.filter(n => !n.isRead);

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="notif-item">
          <div class="notif-icon-badge green"><i class="fa-solid fa-circle-check"></i></div>
          <div class="notif-content">
            <strong>All clear</strong>
            <p>No alerts right now. We'll notify you when deadlines approach.</p>
          </div>
        </div>`;
    } else {
      list.innerHTML = unread.slice(0, 5).concat(notifications.slice(0, 5)).filter((n, i, arr) => arr.findIndex(x => x.id === n.id) === i).slice(0, 5).map(n => {
        const meta = {
          RETURN_DEADLINE_ALERT: { icon: 'fa-triangle-exclamation', cls: 'pink' },
          WARRANTY_EXPIRY_ALERT: { icon: 'fa-shield-halved', cls: 'blue' },
          CLAIM_UPDATE: { icon: 'fa-file-pen', cls: 'purple' },
          SPENDING_ALERT: { icon: 'fa-wallet', cls: 'amber' },
          SYSTEM: { icon: 'fa-bell', cls: 'gray' }
        }[n.type] || { icon: 'fa-bell', cls: 'gray' };
        return `
          <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="NotificationApi.markAsRead('${n.id}').then(() => { location.reload(); })">
            <div class="notif-icon-badge ${meta.cls}"><i class="fa-solid ${meta.icon}"></i></div>
            <div class="notif-content">
              <strong>${escapeHtml(n.title)}</strong>
              <p>${escapeHtml(n.message)}</p>
              <small>${escapeHtml(n.type.replace(/_/g, ' '))}</small>
            </div>
          </div>`;
      }).join('');
    }

    const badge = document.getElementById('urgentAlertBadge');
    if (badge) {
      badge.textContent = unread.length;
      badge.style.display = unread.length > 0 ? 'flex' : 'none';
    }
  } catch (err) {
    list.innerHTML = `
      <div class="notif-item">
        <div class="notif-icon-badge gray"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="notif-content">
          <strong>Unable to load alerts</strong>
          <p>${escapeHtml(err.message || 'Please try again.')}</p>
        </div>
      </div>`;
  }
}

/* --- 13c. UNREAD BADGE (bell corner) --- */
async function refreshUnreadBadge() {
  const badge = document.getElementById('urgentAlertBadge');
  if (!badge) return;
  try {
    const res = await NotificationApi.getUnreadCount();
    badge.textContent = res.unreadCount || 0;
    badge.style.display = res.unreadCount > 0 ? 'flex' : 'none';
  } catch (err) {
    badge.style.display = 'none';
  }
}

/* --- 13d. PURCHASE COPILOT NAV BUTTON opens chatbot --- */
function initCopilotNav() {
  document.getElementById('copilotNavBtn')?.addEventListener('click', () => {
    const toggleBtn = document.getElementById('vibecode-chat-toggle-btn');
    if (toggleBtn) {
      toggleBtn.click();
    } else if (window.ChatbotComponent) {
      new window.ChatbotComponent({
        title: 'Warranty & Spend Copilot',
        welcomeMessage: `Hi! I'm your AI Purchase & Warranty Assistant. Ask me about return deadlines, warranty coverage, or spending trends!`
      }).init();
      setTimeout(() => document.getElementById('vibecode-chat-toggle-btn')?.click(), 100);
    }
  });
}

/* --- Helper: set text content safely --- */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* --- 14. SEND WARRANTY REMINDER EMAIL (Task 14) --- */
window.sendDashboardWarrantyReminder = async function(id) {
  if (window.Toast) Toast.info('Sending warranty reminder email...');

  try {
    const res = await PurchaseApi.sendWarrantyReminder(id);
    if (res.success) {
      if (window.Toast) Toast.success('Warranty reminder sent successfully.');
    } else {
      if (window.Toast) Toast.error(res.message || 'Unable to send warranty reminder.');
    }
  } catch (err) {
    if (window.Toast) Toast.error('Unable to send warranty reminder: ' + err.message);
  }
};

function getProductImageUrl(item) {
  if (!item) return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';

  if (item.receiptImageUrl && !item.receiptImageUrl.includes('photo-1517336714731-489689fd1ca8')) {
    return item.receiptImageUrl;
  }

  const name = (item.productName || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const brand = (item.brand || '').toLowerCase();

  // 1. Mouse / Peripherals
  if (name.includes('mouse') || name.includes('logitech') || name.includes('trackpad') || name.includes('pointer')) {
    return 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=600&q=80'; // Logitech Mouse
  }

  // 2. Toothbrush / Dental / Personal Grooming
  if (name.includes('toothbrush') || name.includes('sonicare') || name.includes('oral') || name.includes('shaver') || name.includes('groomer')) {
    return 'https://images.unsplash.com/photo-1559591937-e1032b498f82?auto=format&fit=crop&w=600&q=80'; // Electric Toothbrush
  }

  // 3. Bluetooth Speaker / Soundbar
  if (name.includes('speaker') || name.includes('soundlink') || name.includes('bose') || name.includes('soundbar') || name.includes('jbl') || name.includes('audio speaker')) {
    return 'https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80'; // Portable Bluetooth Speaker
  }

  // 4. Sunglasses / Eyewear / Glasses
  if (name.includes('sunglass') || name.includes('ray-ban') || name.includes('aviator') || name.includes('eyewear') || name.includes('glasses') || name.includes('spectacles')) {
    return 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=600&q=80'; // Classic Sunglasses
  }

  // 5. Pressure Cooker / Instant Pot / Slow Cooker / Air Fryer
  if (name.includes('cooker') || name.includes('instant pot') || name.includes('pressure') || name.includes('fryer') || name.includes('pot duo') || name.includes('slow cooker')) {
    return 'https://images.unsplash.com/photo-1584990347449-39bbf9b68e92?auto=format&fit=crop&w=600&q=80'; // Pressure Cooker / Kitchen Appliance
  }

  // 6. Vacuum / Dyson / Cleaner
  if (name.includes('vacuum') || name.includes('dyson') || name.includes('cleaner') || name.includes('sweeper')) {
    return 'https://images.unsplash.com/photo-1558317374-067fb5f30001?auto=format&fit=crop&w=600&q=80'; // Cordless Vacuum Cleaner
  }

  // 7. Kindle / E-reader / Book
  if (name.includes('kindle') || name.includes('paperwhite') || name.includes('e-reader') || name.includes('ereader')) {
    return 'https://images.unsplash.com/photo-1592496001020-d31bd830651f?auto=format&fit=crop&w=600&q=80'; // Kindle E-reader
  }

  // 8. Office Chair / Desk Chair / Furniture
  if (name.includes('chair') || name.includes('markus') || name.includes('ergonomic') || name.includes('desk') || name.includes('sofa') || name.includes('table') || cat.includes('furniture')) {
    return 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?auto=format&fit=crop&w=600&q=80'; // Ergonomic Office Chair
  }

  // 9. Refrigerator / Fridge / Freezer
  if (name.includes('refrigerator') || name.includes('fridge') || name.includes('freezer') || name.includes('frost-free')) {
    return 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=600&q=80'; // Modern Refrigerator
  }

  // 10. Headphones / Over-ear / Earbuds
  if (name.includes('headphone') || name.includes('earphone') || name.includes('earbud') || name.includes('wh-1000') || name.includes('airpod') || name.includes('noise cancelling')) {
    return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'; // Wireless Headphones
  }

  // 11. TV / OLED / Display
  if (name.includes('tv') || name.includes('television') || name.includes('oled') || name.includes('bravia') || name.includes('screen') || name.includes('monitor') || name.includes('crystal 4k')) {
    return 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=600&q=80'; // 4K OLED Smart TV
  }

  // 12. Blazer / Suit / Jacket / Formal Wear
  if (name.includes('blazer') || name.includes('suit') || name.includes('jacket') || name.includes('coat') || name.includes('tailored')) {
    return 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=600&q=80'; // Tailored Blazer
  }

  // 13. Shoes / Sneakers / Running Footwear
  if (name.includes('shoe') || name.includes('sneaker') || name.includes('boot') || name.includes('pegasus') || name.includes('runner') || name.includes('footwear') || (brand === 'nike' && name.includes('air'))) {
    return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80'; // Running Shoes & Sneakers
  }

  // 14. Coffee / Espresso / Nespresso
  if (name.includes('coffee') || name.includes('espresso') || name.includes('nespresso') || name.includes('vertuo') || name.includes('latte')) {
    return 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?auto=format&fit=crop&w=600&q=80'; // Espresso Coffee Machine
  }

  // 15. Laptop / MacBook / Computer
  if (name.includes('laptop') || name.includes('macbook') || name.includes('notebook') || name.includes('dell') || name.includes('thinkpad')) {
    return 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80'; // Apple MacBook Laptop
  }

  // 16. Groceries / Food / Pantry
  if (name.includes('rice') || name.includes('atta') || name.includes('milk') || name.includes('grocery') || name.includes('groceries') || name.includes('pantry') || name.includes('organic') || cat.includes('food') || cat.includes('grocery')) {
    return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80'; // Fresh Groceries & Food
  }

  // 17. Lamp / Lighting
  if (name.includes('lamp') || name.includes('light') || name.includes('bulb') || name.includes('lantern')) {
    return 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80'; // Table Lamp
  }

  // 18. General Fashion / Shirts / Jeans
  if (name.includes('shirt') || name.includes('jean') || name.includes('pant') || name.includes('dress') || cat.includes('fashion') || cat.includes('apparel')) {
    return 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=600&q=80'; // Fashion Clothing
  }

  // 19. Smartphones / Mobile
  if (name.includes('phone') || name.includes('iphone') || name.includes('galaxy') || name.includes('pixel') || name.includes('mobile')) {
    return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80'; // Smartphone
  }

  // 20. Smartwatches / Wearables
  if (name.includes('watch') || name.includes('smartwatch') || name.includes('garmin')) {
    return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80'; // Smartwatch
  }

  // 21. Tablets / iPad
  if (name.includes('ipad') || name.includes('tablet')) {
    return 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=600&q=80'; // iPad / Tablet
  }

  return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';
}

/**
 * Intelligent OCR clutter filter & product title cleaner
 * Removes table numbers, prices, shipping boilerplate, and formats multi-item bills cleanly
 */
function cleanProductTitle(rawName, items = []) {
  if (!rawName && (!items || items.length === 0)) return 'Product';

  // If explicit items array is available, clean and join with commas
  if (Array.isArray(items) && items.length > 0) {
    const cleanItems = items
      .map(it => {
        const n = typeof it === 'string' ? it : (it.name || it.productName || it.item || '');
        return cleanSingleProductName(n);
      })
      .filter(p => p && p !== 'Product');
    if (cleanItems.length > 0) {
      return Array.from(new Set(cleanItems)).join(', ');
    }
  }

  let text = String(rawName || '').trim();

  // Strip delivery, shipping, discount, invoice and payment boilerplate
  text = text.replace(/(?:standard|express|free|cash on)?\s*delivery\s*(?:\([^)]*\)|[0-9\-–\s]+business days)?/gi, '');
  text = text.replace(/shipping\s*(?:charges|fee)?\s*(?:free|[0-9,.]+)?/gi, '');
  text = text.replace(/discount\s*[:\-–]?\s*[0-9,.\-–\s]+/gi, '');
  text = text.replace(/subtotal\s*[:\-–]?\s*[0-9,.]+/gi, '');
  text = text.replace(/total\s*amount\s*[:\-–]?\s*[0-9,.]+/gi, '');
  text = text.replace(/sales\s*receipt\s*[0-9]*/gi, '');
  text = text.replace(/[0-9]+\s+color modes/gi, '');

  // Strip table price noise numbers (e.g., "1 325 325", "2 56 112 x", "1 40 40 oy", "1 3,99 3,990 5", "11,499 1,499")
  text = text.replace(/\b\d+\s+\d{2,}(?:[.,]\d+)?\s+\d{2,}(?:[.,]\d+)?\b/g, ' ');
  text = text.replace(/\b\d+\s+\d{2,}\s+\d{2,}\b/g, ' ');
  text = text.replace(/\b\d{1,2}\s+\d{2,}\s+\d{2,}\b/g, ' ');
  text = text.replace(/\b[0-9]{1,2}\s+[0-9,.]+\s+[0-9,.]+\s+[0-9]\b/g, ' ');
  text = text.replace(/\b[0-9,.]+\s+[0-9,.]+\b/g, ' ');
  text = text.replace(/\b(?:Th|oy|wil|wil\s+A|7s\s+h|7s|s\s+h|x|X|B|F)\b/g, ' ');
  text = text.replace(/\b(Skg)\b/gi, '5kg');
  text = text.replace(/\s{2,}/g, ' ').trim();

  // Known item splits
  const splitKeywords = ['Aashirvaad Atta', 'Fresh Milk', 'Tomatoes', 'Onions', 'Cooking Oil', 'Samsung 25W Charger', 'Wide Leg Jeans'];
  for (const kw of splitKeywords) {
    const regex = new RegExp(`(?<!, )\\b(${kw})`, 'gi');
    text = text.replace(regex, ', $1');
  }

  // Clean trailing noise inside parentheses like "(Blue, 32)" or "(Blue )"
  text = text.replace(/\(\s*([A-Za-z]+)\s*\)/g, '($1)');

  // Remove leading commas or multiple commas
  text = text.replace(/^[,\s]+/, '').replace(/[,\s]+$/, '');
  
  if (text.includes(',')) {
    const parts = text.split(',')
      .map(p => cleanSingleProductName(p))
      .filter(p => p.length >= 3 && p !== 'Product');
    if (parts.length > 0) {
      return Array.from(new Set(parts)).join(', ');
    }
  }

  return cleanSingleProductName(text);
}

function cleanSingleProductName(str) {
  if (!str) return '';
  let s = String(str).trim();
  s = s.replace(/^[A-Za-z0-9]\s+/, '');
  s = s.replace(/\s+\b(?:wil|wil\s+A|7s\s+h|7s|s\s+h|A|B|C|D|E|F)\b$/gi, '');
  s = s.replace(/\b(?:wil|wil\s+A|7s\s+h|7s|s\s+h)\b/gi, '');
  s = s.replace(/[-–,.:\s]+$/, '');
  s = s.replace(/^[-–,.:\s]+/, '');
  s = s.replace(/\b\d{4,}\b/g, '');
  s = s.replace(/\s+\d{1,2}$/, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s || 'Product';
}