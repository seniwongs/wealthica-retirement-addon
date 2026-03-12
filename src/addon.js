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
      cppMonthly: 800,
      oasMonthly: 700,
    }
  };

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
    fetchAllData(options);
  });

  addon.on('update', function (options) {
    console.log('[Retirement] update', options);
    state.wealthicaOptions = options;
    fetchAllData(options);
  });

  addon.on('reload', function () {
    console.log('[Retirement] reload');
    fetchAllData(state.wealthicaOptions);
  });

  // ── Data Fetching ────────────────────────────────────────────────────────────
  // Wealthica API expects groups/institutions as comma-separated strings.
  function toApiParam(val) {
    if (!val) return undefined;
    return Array.isArray(val) ? val.join(',') : val;
  }

  function fetchAllData(options) {
    showLoading(true);

    // SDK options use fromDate/toDate; API calls also use fromDate/toDate.
    const groups       = toApiParam(options.groups);
    const institutions = toApiParam(options.institutions);

    const query = {
      groups,
      institutions,
      fromDate: options.fromDate,
      toDate:   options.toDate,
    };
    // Transactions: no date range so we get full contribution history,
    // but still respect the group/institution filter.
    const txQuery = { groups, institutions };

    Promise.all([
      addon.api.getPositions(query)
        .catch(err => { console.error('[Retirement] getPositions error:', err); return []; }),
      addon.api.getTransactions(txQuery)
        .catch(err => { console.error('[Retirement] getTransactions error:', err); return []; }),
      addon.api.getLiabilities(query)
        .catch(err => { console.error('[Retirement] getLiabilities error:', err); return []; }),
      addon.api.getUser()
        .catch(err => { console.error('[Retirement] getUser error:', err); return null; }),
    ]).then(([positions, transactions, liabilities, user]) => {
      console.log('[Retirement] data received —',
        'positions:', positions?.length,
        'transactions:', transactions?.length,
        'liabilities:', liabilities?.length,
        'user:', user?.birthday);
      state.positions    = positions    || [];
      state.transactions = transactions || [];
      state.liabilities  = liabilities  || [];
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
      console.error('[Retirement] unexpected fetch error:', err);
      showLoading(false);
    });
  }

  // ── Render All Charts ────────────────────────────────────────────────────────
  function renderAll() {
    const currentYear = new Date().getFullYear();
    const currentAge = state.params.currentAge;
    const currentPortfolioValue = Retirement.sumPortfolio(state.positions);
    const totalLiabilities = Retirement.sumLiabilities(state.liabilities);

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

    setStatEl('stat-portfolio',     currentPortfolioValue);
    setStatEl('stat-contributed',   totalContributed);
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
    Charts.renderPortfolioValue(historicalData, projection, p.targetAmount);
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
    { id: 'target-amount',     valId: 'target-amount-val',     stateKey: 'targetAmount',      stateValue: v => parseInt(v),        displayValue: p => p.targetAmount,            min: 250000, max: 5000000, formatDisplay: v => Math.round(v).toLocaleString() },
    { id: 'return-rate',       valId: 'return-rate-val',       stateKey: 'annualReturnRate',  stateValue: v => parseFloat(v)/100,  displayValue: p => p.annualReturnRate * 100,  min: 1,     max: 12      },
    { id: 'extra-income',      valId: 'extra-income-val',      stateKey: 'extraMonthlyIncome',stateValue: v => parseInt(v),        displayValue: p => p.extraMonthlyIncome,      min: 0,     max: 5000    },
    { id: 'expenses',          valId: 'expenses-val',          stateKey: 'monthlyExpenses',   stateValue: v => parseInt(v),        displayValue: p => p.monthlyExpenses,         min: 500,   max: 15000,   formatDisplay: v => Math.round(v).toLocaleString() },
    { id: 'life-expectancy',   stateKey: 'lifeExpectancy',    stateValue: v => parseInt(v),        displayValue: p => p.lifeExpectancy,          min: 75,    max: 100,    type: 'select' },
    { id: 'cpp-monthly',       valId: 'cpp-monthly-val',       stateKey: 'cppMonthly',        stateValue: v => parseInt(v),        displayValue: p => p.cppMonthly,              min: 0,     max: 1400    },
    { id: 'oas-monthly',       valId: 'oas-monthly-val',       stateKey: 'oasMonthly',        stateValue: v => parseInt(v),        displayValue: p => p.oasMonthly,              min: 0,     max: 800     },
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
      const el = document.getElementById(def.id);
      if (!el) return;
      const v = def.displayValue(state.params);
      if (def.type === 'select') {
        el.value = v;
      } else {
        el.value = v;
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

      const slider   = el;
      const numInput = document.getElementById(def.valId);
      if (!slider) return;

      // Range slider moved → update number input + state
      slider.addEventListener('input', () => {
        state.params[def.stateKey] = def.stateValue(slider.value);
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
    document.getElementById('inflation-toggle')?.addEventListener('change', () => renderAll());
  });

})();
