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
    }
  };

  // ── Wealthica SDK ────────────────────────────────────────────────────────────
  const addon = new Addon();

  addon.on('init', function (options) {
    state.wealthicaOptions = options;
    // Restore saved params if any, then clamp to valid ranges
    if (options.data && options.data.params) {
      Object.assign(state.params, options.data.params);
      clampParams(state.params);
      syncControlsToState();
    }
    fetchAllData(options);
  });

  addon.on('update', function (options) {
    state.wealthicaOptions = options;
    fetchAllData(options);
  });

  addon.on('reload', function () {
    fetchAllData(state.wealthicaOptions);
  });

  // ── Data Fetching ────────────────────────────────────────────────────────────
  function fetchAllData(options) {
    showLoading(true);

    const query = {
      groups: options.groups,
      institutions: options.institutions,
    };
    // Transactions: always fetch full history — ignore the dashboard date filter.
    // Retirement projections need lifetime contribution data, not just the current window.
    const txQuery = { ...query };

    Promise.all([
      addon.api.getPositions(query).catch(() => []),
      addon.api.getTransactions(txQuery).catch(() => []),
      addon.api.getLiabilities(query).catch(() => []),
      addon.api.getUser().catch(() => null),
    ]).then(([positions, transactions, liabilities, user]) => {
      state.positions = positions || [];
      state.transactions = transactions || [];
      state.liabilities = liabilities || [];
      state.user = user;
      showLoading(false);
      renderAll();
    }).catch(err => {
      console.error('Wealthica data fetch error:', err);
      showLoading(false);
      renderAll(); // render with empty/demo data
    });
  }

  // ── Render All Charts ────────────────────────────────────────────────────────
  function renderAll() {
    const currentYear = new Date().getFullYear();
    const currentAge = state.params.currentAge;
    const currentPortfolioValue = Retirement.sumPortfolio(state.positions);
    const totalLiabilities = Retirement.sumLiabilities(state.liabilities);

    const p = state.params;
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
      returnVolatility: 0.12,
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
    const projection = Retirement.projectPortfolio(calcParams);
    const retirementYear = currentYear + (p.retirementAge - currentAge);
    const mcResult = Retirement.monteCarlo(calcParams, 500);
    const withdrawalRates = Retirement.calcWithdrawalRates(projection, calcParams);
    const incomeSources = Retirement.buildIncomeSources(calcParams);

    // Render each chart
    Charts.renderPortfolioValue(historicalData, projection);
    Charts.renderContributions(historicalData);
    Charts.renderRunway(projection, retirementYear);
    Charts.renderMonteCarlo(mcResult);
    Charts.renderIncomeSources(incomeSources);
    Charts.renderWithdrawalRate(withdrawalRates);
    Charts.renderNetWorth(projection, totalLiabilities);
  }

  // ── Controls Wiring ──────────────────────────────────────────────────────────
  // Each def maps a range slider (id) + number input (valId) to a state key.
  // stateValue()  → what to store in state.params
  // displayValue() → what to show in the number input / slider
  const controlDefs = [
    { id: 'current-age',       valId: 'current-age-val',       stateKey: 'currentAge',        stateValue: v => parseInt(v),        displayValue: p => p.currentAge,              min: 20,    max: 70      },
    { id: 'retirement-age',    valId: 'retirement-age-val',    stateKey: 'retirementAge',     stateValue: v => parseInt(v),        displayValue: p => p.retirementAge,           min: 50,    max: 75      },
    { id: 'target-amount',     valId: 'target-amount-val',     stateKey: 'targetAmount',      stateValue: v => parseInt(v),        displayValue: p => p.targetAmount,            min: 250000, max: 5000000 },
    { id: 'return-rate',       valId: 'return-rate-val',       stateKey: 'annualReturnRate',  stateValue: v => parseFloat(v)/100,  displayValue: p => p.annualReturnRate * 100,  min: 1,     max: 12      },
    { id: 'extra-income',      valId: 'extra-income-val',      stateKey: 'extraMonthlyIncome',stateValue: v => parseInt(v),        displayValue: p => p.extraMonthlyIncome,      min: 0,     max: 5000    },
    { id: 'expenses',          valId: 'expenses-val',          stateKey: 'monthlyExpenses',   stateValue: v => parseInt(v),        displayValue: p => p.monthlyExpenses,         min: 500,   max: 15000   },
    { id: 'life-expectancy',   valId: 'life-expectancy-val',   stateKey: 'lifeExpectancy',    stateValue: v => parseInt(v),        displayValue: p => p.lifeExpectancy,          min: 75,    max: 100     },
  ];

  // Clamp saved params to valid ranges to prevent stale/invalid stored values.
  function clampParams(p) {
    controlDefs.forEach(def => {
      if (def.stateKey === 'annualReturnRate') {
        p.annualReturnRate = Math.min(0.12, Math.max(0.01, p.annualReturnRate || 0.06));
      } else if (p[def.stateKey] !== undefined) {
        p[def.stateKey] = Math.min(def.max, Math.max(def.min, p[def.stateKey]));
      }
    });
    return p;
  }

  // Push state.params into both the range slider and the number input.
  function syncControlsToState() {
    controlDefs.forEach(def => {
      const slider = document.getElementById(def.id);
      const numInput = document.getElementById(def.valId);
      if (!slider) return;
      const v = def.displayValue(state.params);
      slider.value   = v;
      if (numInput) numInput.value = v;
    });
  }

  let debounceTimer = null;
  function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderAll();
      addon.saveData({ params: state.params });
    }, 400);
  }

  function initControls() {
    controlDefs.forEach(def => {
      const slider   = document.getElementById(def.id);
      const numInput = document.getElementById(def.valId);
      if (!slider) return;

      // Range slider moved → update number input + state
      slider.addEventListener('input', () => {
        state.params[def.stateKey] = def.stateValue(slider.value);
        if (numInput) numInput.value = def.displayValue(state.params);
        debounceRender();
      });

      // Number input changed → update range slider + state
      if (numInput) {
        numInput.addEventListener('change', () => {
          const clamped = Math.min(def.max, Math.max(def.min, parseFloat(numInput.value) || def.min));
          numInput.value = clamped;
          slider.value   = clamped;
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
    initControls();
    initTabs();
    syncControlsToState();
  });

})();
