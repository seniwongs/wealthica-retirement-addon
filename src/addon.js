/**
 * addon.js
 * Main entry point — Wealthica SDK lifecycle, data fetching, controls wiring.
 */

// Dev-mode stub: use demo mode when either:
//   1. wealthica.js CDN failed to load (Addon undefined), OR
//   2. page is NOT inside a Wealthica iframe (window === window.parent)
//      — the SDK requires a parent frame to postMessage with.
const _inWealthicaFrame = (function () {
  try { return window.self !== window.top; } catch (e) { return false; }
})();

if (typeof Addon === 'undefined' || !_inWealthicaFrame) {
  console.warn('[RetirementAddon] Running in demo mode (not inside Wealthica iframe)');
  window.Addon = function () {
    this._handlers = {};
    const self = this;
    this.api = {
      getPositions:    () => Promise.resolve(DEMO_DATA.positions),
      getTransactions: () => Promise.resolve(DEMO_DATA.transactions),
      getLiabilities:  () => Promise.resolve(DEMO_DATA.liabilities),
      getAssets:       () => Promise.resolve(DEMO_DATA.assets),
      getUser:         () => Promise.resolve(DEMO_DATA.user),
    };
    this.on = function (event, fn) { self._handlers[event] = fn; return self; };
    this.saveData = function () {};
    this.setLoadingStatus = function () {};
    setTimeout(() => {
      if (self._handlers['init']) self._handlers['init']({ groups: null, institutions: null });
    }, 300);
  };

  // Demo data — realistic Canadian portfolio snapshot
  const DEMO_DATA = {
    user: { birthday: '1984-06-15' },
    positions: [
      { name: 'XEQT.TO',  market_value: 145000 },
      { name: 'VCN.TO',   market_value:  55000 },
      { name: 'ZAG.TO',   market_value:  38000 },
      { name: 'CASH',     market_value:  12000 },
    ],
    assets: [
      { name: 'Primary Residence', market_value: 750000 },
      { name: 'Vehicle',           market_value:  25000 },
    ],
    liabilities: [
      { name: 'Mortgage', market_value: -280000 },
    ],
    transactions: (() => {
      const txs = [];
      const now = new Date();
      // ~10 years of monthly $1500 contributions
      for (let m = 120; m >= 0; m--) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - m);
        txs.push({ date: d.toISOString().slice(0, 10), amount: 1500 });
      }
      return txs;
    })(),
  };
}

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────────
  const state = {
    positions: [],
    transactions: [],
    liabilities: [],
    assets: [],
    user: null,
    wealthicaOptions: {},
    // User-controlled assumption params
    params: {
      currentAge: 40,
      retirementAge: 65,
      targetAmount: 1_000_000,
      annualReturnRate: 0.06,
      extraMonthlyIncome: 0,
      monthlyExpenses: 3_000,
      lifeExpectancy: 90,
      cppMonthly: 800,
      oasMonthly: 700,
    }
  };

  // Sensitivity overrides for the Runway chart (null = use base params)
  const runwaySensitivity = { returnRate: null, inflationRate: null };

  // Latest Monte Carlo result — populated in renderAll(), used by initMcTooltip()
  let _lastMcResult = null;

  // ── Wealthica SDK ────────────────────────────────────────────────────────────
  const addon = new Addon();

  addon.on('init', function (options) {
    console.log('[Retirement] init', options);
    state.wealthicaOptions = options;
    // Restore saved params if any, then clamp to valid ranges
    if (options.data && options.data.params) {
      Object.assign(state.params, options.data.params);
      clampParams(state.params);
      syncControlsToState();
    }
    _suppressUpdateUntil = Date.now() + 2000;
    fetchAllData(options);
  });

  let _ignoringNextUpdate = false;
  let _fetchGen = 0;
  let _suppressUpdateUntil = 0;
  let _lastFetchedFilterKey = null;

  function getFilterKey(options) {
    const groups       = toApiParam(options.groupsFilter       || options.groups);
    const institutions = toApiParam(options.institutionsFilter || options.institutions);
    const dateRange    = options.dateRangeFilter;
    const fromDate     = (dateRange && dateRange[0]) || options.fromDate;
    const toDate       = (dateRange && dateRange[1]) || options.toDate;
    return JSON.stringify({ groups, institutions, fromDate, toDate });
  }

  addon.on('update', function (options) {
    console.log('[Retirement] update', options);
    if (_ignoringNextUpdate) {
      _ignoringNextUpdate = false;
      return; // echo from our own saveData — filter unchanged, no re-fetch needed
    }
    if (Date.now() < _suppressUpdateUntil) {
      console.log('[Retirement] update suppressed (post-init window)');
      state.wealthicaOptions = options; // still capture latest options
      return;
    }
    // Viewport-only update (browser resize) — no filter data, nothing to re-fetch
    const FILTER_FIELDS = ['institutionsFilter','groupsFilter','dateRangeFilter','institutions','groups','fromDate','toDate'];
    if (!FILTER_FIELDS.some(k => k in options)) {
      console.log('[Retirement] update ignored — viewport only');
      return; // do NOT overwrite state.wealthicaOptions — preserve init filter for reload
    }
    // Only re-fetch if the effective filter params actually changed
    const newKey = getFilterKey(options);
    if (newKey === _lastFetchedFilterKey) {
      console.log('[Retirement] update ignored — filter unchanged');
      state.wealthicaOptions = options; // still capture options
      return;
    }
    state.wealthicaOptions = options;
    fetchAllData(options);
  });

  addon.on('reload', function () {
    // Re-fetch with current options — no options update
    fetchAllData(state.wealthicaOptions);
  });

  // ── Data Fetching ────────────────────────────────────────────────────────────
  // Wealthica SDK passes filter state in the options object using these fields:
  //   options.institutionsFilter  — array of institution objects ({ _id, ... }) or strings
  //   options.groupsFilter        — array of group objects or strings
  //   options.dateRangeFilter     — [fromDate, toDate] array
  // The API expects groups/institutions as comma-separated ID strings.
  function toApiParam(val) {
    if (!val) return undefined;
    if (Array.isArray(val)) {
      if (val.length === 0) return undefined;
      // Institution/group entries may be objects with _id or plain strings
      return val.map(item => (item && typeof item === 'object' ? item._id : item)).join(',');
    }
    return val;
  }

  function fetchAllData(options) {
    showLoading(true);
    const myGen = ++_fetchGen; // snapshot this fetch's generation
    _lastFetchedFilterKey = getFilterKey(options);

    // SDK options use xFilter field names; API calls use groups/institutions/fromDate/toDate.
    // Support both the real SDK format (xFilter) and any legacy direct fields.
    const groups       = toApiParam(options.groupsFilter       || options.groups);
    const institutions = toApiParam(options.institutionsFilter || options.institutions);
    const dateRange    = options.dateRangeFilter;
    const fromDate     = (dateRange && dateRange[0]) || options.fromDate;
    const toDate       = (dateRange && dateRange[1]) || options.toDate;

    const query = {
      groups,
      institutions,
      fromDate,
      toDate,
    };
    // Transactions: no date range so we get full contribution history,
    // but still respect the group/institution filter.
    const txQuery = { groups, institutions };
    // Liabilities/assets are snapshots — no date range, just filter by group/institution.
    const snapshotQuery = { groups, institutions };

    Promise.all([
      addon.api.getPositions(snapshotQuery)
        .catch(err => { console.error('[Retirement] getPositions error:', err); return []; }),
      addon.api.getTransactions(txQuery)
        .catch(err => { console.error('[Retirement] getTransactions error:', err); return []; }),
      addon.api.getLiabilities(snapshotQuery)
        .catch(err => { console.error('[Retirement] getLiabilities error:', err); return []; }),
      addon.api.getAssets(snapshotQuery)
        .catch(err => { console.error('[Retirement] getAssets error:', err); return []; }),
      addon.api.getUser()
        .catch(err => { console.error('[Retirement] getUser error:', err); return null; }),
    ]).then(([positions, transactions, liabilities, assets, user]) => {
      if (myGen !== _fetchGen) return; // stale — a newer fetch supersedes this one
      console.log('[Retirement] data received —',
        'positions:', positions?.length,
        'transactions:', transactions?.length,
        'liabilities:', liabilities?.length, liabilities?.[0],
        'assets:', assets?.length, assets?.[0],
        'user:', user?.birthday);
      state.positions    = positions    || [];
      state.transactions = transactions || [];
      state.liabilities  = liabilities  || [];
      state.assets       = assets       || [];
      state.user = user;
      // Auto-fill current age from Wealthica birthday
      if (user && user.birthday) {
        const age = Retirement.estimateCurrentAge(user);
        state.params.currentAge = Math.min(70, Math.max(20, age));
        syncControlsToState();
      }
      showLoading(false);
      renderAll();
    }).catch(err => {
      if (myGen !== _fetchGen) return;
      console.error('[Retirement] unexpected fetch error:', err);
      showLoading(false);
    });
  }

  // ── Render All Charts ────────────────────────────────────────────────────────
  function renderAll() {
    const currentYear = new Date().getFullYear();
    const currentAge = state.params.currentAge;
    const currentPortfolioValue = Retirement.sumPortfolio(state.positions);
    console.log('[Retirement] renderAll — portfolio:', currentPortfolioValue,
      'positions count:', state.positions.length,
      'lifeExpectancy:', state.params.lifeExpectancy,
      'fetchGen:', _fetchGen,
      'filterKey:', _lastFetchedFilterKey);
    const totalLiabilities = Retirement.sumLiabilities(state.liabilities);
    const totalAssets = Retirement.sumPortfolio(state.assets);

    const p = state.params;
    const inflationRate = document.getElementById('inflation-toggle')?.checked ? 0.02 : 0;

    const calcParams = {
      currentValue: currentPortfolioValue,
      currentYear,
      currentAge,
      retirementAge: p.retirementAge,
      lifeExpectancy: p.lifeExpectancy,
      annualReturnRate: p.annualReturnRate,
      monthlyExpenses: p.monthlyExpenses,
      extraMonthlyIncome: p.extraMonthlyIncome,
      targetAmount: p.targetAmount,
      cppMonthly: p.cppMonthly,
      oasMonthly: p.oasMonthly,
      returnVolatility: 0.12,
      inflationRate,
    };

    // Update sidebar summary
    document.getElementById('summary-portfolio').textContent =
      Charts.fmt(currentPortfolioValue);
    document.getElementById('summary-years').textContent =
      Math.max(0, p.retirementAge - currentAge) + ' yrs';

    // Build datasets
    const historicalData = Retirement.buildHistoricalData(
      state.transactions, currentPortfolioValue
    );
    const rawProjection = Retirement.projectPortfolio(calcParams);
    // Apply inflation deflation so charts show values in today's dollars
    const projection = inflationRate > 0
      ? rawProjection.map(d => ({
          ...d,
          value: Math.round(d.value / Math.pow(1 + inflationRate, d.year - currentYear))
        }))
      : rawProjection;
    const retirementYear = currentYear + (p.retirementAge - currentAge);
    const mcResult = Retirement.monteCarlo(calcParams, 500);
    _lastMcResult = { ...mcResult, params: calcParams };
    const withdrawalRates = Retirement.calcWithdrawalRates(projection, calcParams);
    const incomeSources = Retirement.buildIncomeSources(calcParams);

    // ── Stats strip ────────────────────────────────────────────────────────────
    const lastHistorical = historicalData[historicalData.length - 1];
    const totalContributed = lastHistorical ? Math.max(0, lastHistorical.contributions) : 0;
    const investmentGains  = currentPortfolioValue - totalContributed;

    const retirementPoint  = projection.find(d => d.year === retirementYear);
    const lastPoint        = projection[projection.length - 1];

    function setStatEl(id, value, isGain) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = Charts.fmt(value);
      if (isGain) el.className = 'stat-value' + (value < 0 ? ' negative' : '');
    }

    const fireNumber       = Retirement.calcFireNumber(calcParams);
    const monthlySavingsNeeded = Retirement.calcRequiredMonthlySavings(calcParams);
    const projectedAtRetirement = retirementPoint ? retirementPoint.value : 0;
    const surplus = projectedAtRetirement - p.targetAmount;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const last12Contributions = (state.transactions || [])
      .filter(tx => tx.amount > 0 && new Date(tx.date) >= twelveMonthsAgo)
      .reduce((sum, tx) => sum + tx.amount, 0);
    const avgMonthlySavings = last12Contributions / 12;

    setStatEl('stat-portfolio',     currentPortfolioValue);
    setStatEl('stat-contributed',   totalContributed);
    setStatEl('stat-avg-savings',   avgMonthlySavings);
    setStatEl('stat-gains',         investmentGains, true);
    setStatEl('stat-at-retirement', projectedAtRetirement);
    setStatEl('stat-fire',          fireNumber);
    setStatEl('stat-save-needed',   monthlySavingsNeeded);
    setStatEl('stat-remaining',     lastPoint ? lastPoint.value : 0);

    // ── On-track banner ────────────────────────────────────────────────────────
    const banner  = document.getElementById('track-banner');
    const iconEl  = document.getElementById('track-icon');
    const msgEl   = document.getElementById('track-message');
    const detEl   = document.getElementById('track-detail');
    if (banner && projectedAtRetirement > 0) {
      banner.classList.remove('hidden', 'on-track', 'off-track');
      if (surplus >= 0) {
        banner.classList.add('on-track');
        iconEl.textContent  = '✅';
        msgEl.textContent   = 'You are on track!';
        detEl.textContent   = 'Projected surplus of ' + Charts.fmt(surplus) + ' at retirement.';
      } else {
        banner.classList.add('off-track');
        iconEl.textContent  = '⚠️';
        msgEl.textContent   = 'Shortfall of ' + Charts.fmt(Math.abs(surplus));
        detEl.textContent   = monthlySavingsNeeded > 0
          ? 'Save an extra ' + Charts.fmt(monthlySavingsNeeded) + '/mo to reach your goal.'
          : 'Adjust your target or retirement age.';
      }
    }

    // Render each chart
    Charts.renderPortfolioValue(historicalData, projection, p.targetAmount, retirementYear);
    Charts.renderContributions(historicalData);
    renderRunwayChart();
    Charts.renderMonteCarlo(mcResult);
    Charts.renderIncomeSources(incomeSources);
    Charts.renderWithdrawalRate(withdrawalRates);
    Charts.renderNetWorth(projection, totalLiabilities, totalAssets);
  }

  // ── Runway Chart (with sensitivity overrides) ────────────────────────────────
  function renderRunwayChart() {
    const p = state.params;
    const currentYear = new Date().getFullYear();
    const currentPortfolioValue = Retirement.sumPortfolio(state.positions);
    const inflationRate = runwaySensitivity.inflationRate !== null
      ? runwaySensitivity.inflationRate
      : (document.getElementById('inflation-toggle')?.checked ? 0.02 : 0);
    const annualReturnRate = runwaySensitivity.returnRate !== null
      ? runwaySensitivity.returnRate
      : p.annualReturnRate;

    const calcParams = {
      currentValue: currentPortfolioValue,
      currentYear,
      currentAge: p.currentAge,
      retirementAge: p.retirementAge,
      lifeExpectancy: p.lifeExpectancy,
      annualReturnRate,
      monthlyExpenses: p.monthlyExpenses,
      extraMonthlyIncome: p.extraMonthlyIncome,
      cppMonthly: p.cppMonthly,
      oasMonthly: p.oasMonthly,
      inflationRate,
    };

    const rawProjection = Retirement.projectPortfolio(calcParams);
    const projection = inflationRate > 0
      ? rawProjection.map(d => ({
          ...d,
          value: Math.round(d.value / Math.pow(1 + inflationRate, d.year - currentYear))
        }))
      : rawProjection;
    const retirementYear = currentYear + (p.retirementAge - p.currentAge);
    Charts.renderRunway(projection, retirementYear, calcParams);
  }

  function initRunwaySensitivity() {
    document.querySelectorAll('[data-runway-return]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-runway-return]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const v = btn.dataset.runwayReturn;
        runwaySensitivity.returnRate = v === 'base' ? null : parseFloat(v);
        renderRunwayChart();
      });
    });
    document.querySelectorAll('[data-runway-inflation]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-runway-inflation]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const v = btn.dataset.runwayInflation;
        runwaySensitivity.inflationRate = v === 'base' ? null : parseFloat(v);
        renderRunwayChart();
      });
    });
  }

  // ── Controls Wiring ──────────────────────────────────────────────────────────
  // Each def maps a range slider (id) + number input (valId) to a state key.
  // stateValue()  → what to store in state.params
  // displayValue() → what to show in the number input / slider
  const controlDefs = [
    { id: 'current-age',       valId: 'current-age-val',       stateKey: 'currentAge',        stateValue: v => parseInt(v),        displayValue: p => p.currentAge,              min: 20,    max: 70      },
    { id: 'retirement-age',    valId: 'retirement-age-val',    stateKey: 'retirementAge',     stateValue: v => parseInt(v),        displayValue: p => p.retirementAge,           min: 50,    max: 75      },
    { id: 'target-amount',     valId: 'target-amount-val',     stateKey: 'targetAmount',      stateValue: v => parseInt(v),        displayValue: p => p.targetAmount,            min: 250000, max: 5000000, formatDisplay: v => Math.round(v).toLocaleString() },
    { id: 'return-rate',       valId: 'return-rate-val',       stateKey: 'annualReturnRate',  stateValue: v => parseFloat(v)/100,  displayValue: p => p.annualReturnRate * 100,  formatDisplay: v => +v.toFixed(1),  min: 1,     max: 12      },
    { id: 'extra-income',      valId: 'extra-income-val',      stateKey: 'extraMonthlyIncome',stateValue: v => parseInt(v),        displayValue: p => p.extraMonthlyIncome,      min: 0,     max: 20000   },
    { id: 'expenses',          valId: 'expenses-val',          stateKey: 'monthlyExpenses',   stateValue: v => parseInt(v),        displayValue: p => p.monthlyExpenses,         min: 500,   max: 15000,   formatDisplay: v => Math.round(v).toLocaleString() },
    { id: 'life-expectancy',   stateKey: 'lifeExpectancy',    stateValue: v => parseInt(v),        displayValue: p => p.lifeExpectancy,          min: 75,    max: 100,    type: 'select' },
    { id: 'cpp-monthly',       valId: 'cpp-monthly-val',       stateKey: 'cppMonthly',        stateValue: v => parseInt(v),        displayValue: p => p.cppMonthly,              min: 0,     max: 1400    },
    { id: 'oas-monthly',       valId: 'oas-monthly-val',       stateKey: 'oasMonthly',        stateValue: v => parseInt(v),        displayValue: p => p.oasMonthly,              min: 0,     max: 800     },
  ];

  // Clamp saved params to valid ranges to prevent stale/invalid stored values.
  function clampParams(p) {
    controlDefs.forEach(def => {
      if (def.stateKey === 'annualReturnRate') {
        p.annualReturnRate = Math.min(0.12, Math.max(0.01, p.annualReturnRate));
      } else if (p[def.stateKey] !== undefined) {
        p[def.stateKey] = Math.min(def.max, Math.max(def.min, p[def.stateKey]));
      }
    });
    return p;
  }

  // Push state.params into both the range slider and the number input.
  function syncControlsToState() {
    controlDefs.forEach(def => {
      const el = document.getElementById(def.id);
      if (!el) return;
      const v = def.displayValue(state.params);
      el.value = v;
      if (def.type !== 'select') {
        const numInput = document.getElementById(def.valId);
        if (numInput) numInput.value = def.formatDisplay ? def.formatDisplay(v) : v;
      }
    });
  }

  let debounceTimer = null;
  function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderAll();
      _ignoringNextUpdate = true;
      addon.saveData({ params: state.params });
    }, 400);
  }

  function initControls() {
    controlDefs.forEach(def => {
      const el = document.getElementById(def.id);
      if (!el) return;

      if (def.type === 'select') {
        for (let v = def.min; v <= def.max; v++) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          el.appendChild(opt);
        }
        el.value = def.displayValue(state.params);
        el.addEventListener('change', () => {
          state.params[def.stateKey] = def.stateValue(el.value);
          debounceRender();
        });
        return;
      }

      const numInput = document.getElementById(def.valId);

      // Range slider moved → update number input + state
      el.addEventListener('input', () => {
        state.params[def.stateKey] = def.stateValue(el.value);
        const v = def.displayValue(state.params);
        if (numInput) numInput.value = def.formatDisplay ? def.formatDisplay(v) : v;
        debounceRender();
      });

      // Number input changed → update range slider + state
      if (numInput) {
        numInput.addEventListener('change', () => {
          const raw = parseFloat(numInput.value.replace(/,/g, '')) || def.min;
          const clamped = Math.min(def.max, Math.max(def.min, raw));
          numInput.value = def.formatDisplay ? def.formatDisplay(clamped) : clamped;
          el.value = clamped;
          state.params[def.stateKey] = def.stateValue(clamped);
          debounceRender();
        });
      }
    });
  }

  // ── Tab Navigation ────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.chart-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + target)?.classList.add('active');
      });
    });
  }

  // ── Loading State ─────────────────────────────────────────────────────────────
  function showLoading(visible) {
    const el = document.getElementById('loading');
    if (el) el.classList.toggle('hidden', !visible);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initControls();
    initTabs();
    initTooltips();
    initMcTooltip();
    initRunwaySensitivity();
    syncControlsToState();
    document.getElementById('inflation-toggle')?.addEventListener('change', () => renderAll());
  });

  function initTooltips() {
    const tip = document.createElement('div');
    tip.id = 'tip';
    document.body.appendChild(tip);

    const TIP_WIDTH = 210;

    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tooltip]');
      if (!el) return;
      tip.textContent = el.dataset.tooltip;
      tip.style.width = TIP_WIDTH + 'px';
      tip.classList.add('visible');

      const rect = el.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - TIP_WIDTH / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - TIP_WIDTH - 8));
      tip.style.left = left + 'px';

      // Show above element; fall back to below if too close to top
      if (rect.top > 70) {
        tip.style.top  = '';
        tip.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      } else {
        tip.style.bottom = '';
        tip.style.top = (rect.bottom + 8) + 'px';
      }
    });

    document.addEventListener('mouseout', e => {
      if (e.target.closest('[data-tooltip]')) tip.classList.remove('visible');
    });
  }

  function initMcTooltip() {
    const wrap = document.querySelector('.mc-circle-wrap');
    const tip  = document.getElementById('tip');
    if (!wrap || !tip) return;

    wrap.addEventListener('mouseenter', () => {
      if (!_lastMcResult) return;
      const { successRate, percentiles } = _lastMcResult;

      const tier =
        successRate >= 90 ? '✅ Very Strong' :
        successRate >= 80 ? '✅ Strong' :
        successRate >= 60 ? '⚠️ Moderate' : '❌ At Risk';

      const suggestion =
        successRate >= 90 ? 'On track. Consider a slightly lower return assumption for conservatism.' :
        successRate >= 80 ? 'Small increases in savings or a slightly higher return add meaningful buffer.' :
        successRate >= 60 ? 'Try saving more each month, reducing expenses, or delaying retirement 1–2 years.' :
                            'High risk of running out. Reduce expenses, retire later, or increase savings rate significantly.';

      const fmt = v => v == null ? '—' : '$' + Math.round(v).toLocaleString();

      const lastIdx = percentiles.p50.length - 1;
      const p50 = fmt(percentiles.p50[lastIdx]?.value);
      const p10 = fmt(percentiles.p10[lastIdx]?.value);
      const p90 = fmt(percentiles.p90[lastIdx]?.value);

      tip.innerHTML = `
        <div class="mc-tip-title">${tier} &nbsp;·&nbsp; ${successRate}%</div>
        <div class="mc-tip-sub">500 simulations · portfolio never depleted = success</div>
        <div class="mc-tip-row"><span>Median (p50)</span><span>${p50}</span></div>
        <div class="mc-tip-row"><span>Best 10% (p90)</span><span>${p90}</span></div>
        <div class="mc-tip-row"><span>Worst 10% (p10)</span><span>${p10}</span></div>
        <div class="mc-tip-hint">💡 ${suggestion}</div>
      `;
      tip.style.width = '260px';
      tip.classList.add('visible');

      const rect = wrap.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - 130;
      left = Math.max(8, Math.min(left, window.innerWidth - 268));
      tip.style.left = left + 'px';
      if (rect.top > 70) {
        tip.style.top = '';
        tip.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      } else {
        tip.style.bottom = '';
        tip.style.top = (rect.bottom + 8) + 'px';
      }
    });

    wrap.addEventListener('mouseleave', () => {
      tip.classList.remove('visible');
    });
  }

  function initTheme() {
    const root = document.documentElement;
    const btn  = document.getElementById('theme-toggle');
    if (!btn) return;
    // Apply saved preference (default: dark)
    const saved = localStorage.getItem('ret-theme') || 'dark';
    root.setAttribute('data-theme', saved);
    btn.textContent = saved === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      btn.textContent = next === 'dark' ? '☀️ Light' : '🌙 Dark';
      localStorage.setItem('ret-theme', next);
      renderAll(); // re-render charts with new theme colours
    });
  }

})();
