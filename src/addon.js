/**
 * addon.js
 * Main entry point — Wealthica SDK lifecycle, data fetching, controls wiring.
 */

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
    // Restore saved params if any
    if (options.data && options.data.params) {
      Object.assign(state.params, options.data.params);
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
    const txQuery = {
      ...query,
      from: options.fromDate,
      to: options.toDate,
    };

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
    const currentAge = Retirement.estimateCurrentAge(state.user);
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
  const controlDefs = [
    {
      id: 'retirement-age',
      stateKey: 'retirementAge',
      displayId: 'retirement-age-val',
      transform: v => parseInt(v),
      format: v => v,
    },
    {
      id: 'target-amount',
      stateKey: 'targetAmount',
      displayId: 'target-amount-val',
      transform: v => parseInt(v),
      format: v => parseInt(v).toLocaleString(),
    },
    {
      id: 'return-rate',
      stateKey: 'annualReturnRate',
      displayId: 'return-rate-val',
      transform: v => parseFloat(v) / 100,
      format: v => parseFloat(v),
    },
    {
      id: 'extra-income',
      stateKey: 'extraMonthlyIncome',
      displayId: 'extra-income-val',
      transform: v => parseInt(v),
      format: v => parseInt(v).toLocaleString(),
    },
    {
      id: 'expenses',
      stateKey: 'monthlyExpenses',
      displayId: 'expenses-val',
      transform: v => parseInt(v),
      format: v => parseInt(v).toLocaleString(),
    },
    {
      id: 'life-expectancy',
      stateKey: 'lifeExpectancy',
      displayId: 'life-expectancy-val',
      transform: v => parseInt(v),
      format: v => v,
    },
  ];

  function syncControlsToState() {
    controlDefs.forEach(def => {
      const el = document.getElementById(def.id);
      const display = document.getElementById(def.displayId);
      if (!el) return;

      // Set slider value from state (reverse transform for display)
      if (def.stateKey === 'annualReturnRate') {
        el.value = state.params.annualReturnRate * 100;
        if (display) display.textContent = state.params.annualReturnRate * 100;
      } else {
        el.value = state.params[def.stateKey];
        if (display) display.textContent = def.format(state.params[def.stateKey]);
      }
    });
  }

  let debounceTimer = null;
  function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderAll();
      // Persist params
      addon.saveData({ params: state.params });
    }, 400);
  }

  function initControls() {
    controlDefs.forEach(def => {
      const el = document.getElementById(def.id);
      const display = document.getElementById(def.displayId);
      if (!el) return;

      el.addEventListener('input', () => {
        state.params[def.stateKey] = def.transform(el.value);
        if (display) {
          const rawVal = def.stateKey === 'annualReturnRate'
            ? parseFloat(el.value)
            : def.transform(el.value);
          display.textContent = def.format(rawVal);
        }
        debounceRender();
      });
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
