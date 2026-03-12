/**
 * retirement.js
 * Pure calculation module — no DOM or Chart.js dependencies.
 * All functions take plain inputs and return plain data structures.
 */

const Retirement = (() => {

  /**
   * Build year-by-year historical portfolio values from transactions.
   * Returns array of { year, portfolioValue, contributions, returns }
   */
  function buildHistoricalData(transactions, currentPortfolioValue) {
    if (!transactions || transactions.length === 0) return [];

    const byYear = {};

    transactions.forEach(tx => {
      const year = new Date(tx.date).getFullYear();
      if (!byYear[year]) byYear[year] = { contributions: 0, withdrawals: 0 };
      const amount = tx.amount || 0;
      // Positive = deposit/contribution, negative = withdrawal
      if (amount > 0) byYear[year].contributions += amount;
      else byYear[year].withdrawals += Math.abs(amount);
    });

    const years = Object.keys(byYear).map(Number).sort();
    if (years.length === 0) return [];

    const currentYear = new Date().getFullYear();
    let runningContributions = 0;
    const result = [];

    years.forEach((year, i) => {
      runningContributions += byYear[year].contributions - byYear[year].withdrawals;
      result.push({ year, contributions: runningContributions });
    });

    // Anchor last year to current portfolio value, back-calculate returns
    const totalContributions = runningContributions;
    result.forEach(row => {
      // Approximate portfolio value by scaling contributions to current value
      const fraction = totalContributions > 0 ? row.contributions / totalContributions : 1;
      row.portfolioValue = Math.round(currentPortfolioValue * fraction);
      row.returns = Math.max(0, row.portfolioValue - row.contributions);
    });

    return result;
  }

  /**
   * Project portfolio forward from today to retirement, then through retirement.
   * Returns array of { year, value, phase: 'accumulation'|'retirement' }
   */
  function projectPortfolio(params) {
    const {
      currentValue,
      currentYear,
      retirementAge,
      currentAge,
      lifeExpectancy,
      annualReturnRate,    // e.g. 0.06
      monthlyExpenses,
      extraMonthlyIncome,  // CPP, OAS, part-time, etc.
      targetAmount,
    } = params;

    const yearsToRetirement = retirementAge - currentAge;
    const retirementYear = currentYear + yearsToRetirement;
    const endYear = currentYear + (lifeExpectancy - currentAge);

    const result = [];
    let value = currentValue;

    // Accumulation phase
    for (let y = currentYear; y <= retirementYear; y++) {
      result.push({ year: y, value: Math.round(value), phase: 'accumulation' });
      value = value * (1 + annualReturnRate);
    }

    // Retirement phase
    const annualWithdrawalNet = (monthlyExpenses - extraMonthlyIncome) * 12;
    for (let y = retirementYear + 1; y <= endYear; y++) {
      value = value * (1 + annualReturnRate) - Math.max(0, annualWithdrawalNet);
      result.push({ year: y, value: Math.max(0, Math.round(value)), phase: 'retirement' });
      if (value <= 0) break;
    }

    // Pad zeros if portfolio depleted before life expectancy
    const lastYear = result[result.length - 1].year;
    for (let y = lastYear + 1; y <= endYear; y++) {
      result.push({ year: y, value: 0, phase: 'retirement' });
    }

    return result;
  }

  /**
   * Monte Carlo simulation — 1000 runs with randomized annual returns.
   * Returns { percentiles: { p10, p25, p50, p75, p90 }, successRate, runs }
   * Each percentile is an array of { year, value }
   */
  function monteCarlo(params, numSimulations = 1000) {
    const {
      currentValue,
      currentYear,
      retirementAge,
      currentAge,
      lifeExpectancy,
      annualReturnRate,
      returnVolatility = 0.12,  // stddev of annual returns
      monthlyExpenses,
      extraMonthlyIncome,
    } = params;

    const yearsToRetirement = retirementAge - currentAge;
    const totalYears = lifeExpectancy - currentAge;
    const annualNetWithdrawal = Math.max(0, (monthlyExpenses - extraMonthlyIncome) * 12);

    // Box-Muller normal random
    function randn() {
      const u = 1 - Math.random();
      const v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    const allRuns = [];
    let successCount = 0;

    for (let sim = 0; sim < numSimulations; sim++) {
      let value = currentValue;
      const run = [value];
      let depleted = false;

      for (let y = 0; y < totalYears; y++) {
        const r = annualReturnRate + returnVolatility * randn();
        if (y < yearsToRetirement) {
          value = value * (1 + r);
        } else {
          value = value * (1 + r) - annualNetWithdrawal;
        }
        value = Math.max(0, value);
        run.push(Math.round(value));
        if (value <= 0 && !depleted) depleted = true;
      }

      if (!depleted) successCount++;
      allRuns.push(run);
    }

    // Build year-by-year percentile arrays
    const years = Array.from({ length: totalYears + 1 }, (_, i) => currentYear + i);
    const p = [10, 25, 50, 75, 90];
    const percentiles = {};
    p.forEach(pct => { percentiles[`p${pct}`] = []; });

    for (let y = 0; y <= totalYears; y++) {
      const vals = allRuns.map(r => r[y]).sort((a, b) => a - b);
      p.forEach(pct => {
        const idx = Math.floor((pct / 100) * (vals.length - 1));
        percentiles[`p${pct}`].push({ year: years[y], value: vals[idx] });
      });
    }

    return {
      percentiles,
      successRate: Math.round((successCount / numSimulations) * 100),
      years,
    };
  }

  /**
   * Calculate year-by-year withdrawal rate during retirement.
   * Returns array of { year, withdrawalRate, portfolioValue, annualWithdrawal }
   */
  function calcWithdrawalRates(projection, params) {
    const { monthlyExpenses, extraMonthlyIncome, retirementAge, currentAge, currentYear } = params;
    const retirementYear = currentYear + (retirementAge - currentAge);
    const annualWithdrawal = Math.max(0, (monthlyExpenses - extraMonthlyIncome) * 12);

    return projection
      .filter(p => p.phase === 'retirement' && p.value > 0)
      .map(p => ({
        year: p.year,
        portfolioValue: p.value,
        annualWithdrawal,
        withdrawalRate: p.value > 0 ? (annualWithdrawal / p.value) * 100 : 0,
      }));
  }

  /**
   * Build retirement income sources per year.
   * CPP assumed to start at 65, OAS at 65 (simplified).
   */
  function buildIncomeSources(params) {
    const {
      currentAge,
      retirementAge,
      lifeExpectancy,
      currentYear,
      monthlyExpenses,
      extraMonthlyIncome,
      cppMonthly = 800,
      oasMonthly = 700,
    } = params;

    const retirementYear = currentYear + (retirementAge - currentAge);
    const endYear = currentYear + (lifeExpectancy - currentAge);
    const result = [];

    for (let y = retirementYear; y <= endYear; y++) {
      const age = retirementAge + (y - retirementYear);
      const cpp = age >= 65 ? cppMonthly * 12 : 0;
      const oas = age >= 65 ? oasMonthly * 12 : 0;
      const extra = extraMonthlyIncome * 12;
      const totalPassive = cpp + oas + extra;
      const totalNeeded = monthlyExpenses * 12;
      const portfolioWithdrawal = Math.max(0, totalNeeded - totalPassive);
      const grossIncome = portfolioWithdrawal + cpp + oas + extra;
      const estimatedTax = estimateAnnualTax(grossIncome);
      result.push({ year: y, portfolioWithdrawal, cpp, oas, extra, estimatedTax });
    }

    return result;
  }

  /**
   * Monthly savings required to reach targetAmount by retirement.
   * Returns 0 if current portfolio alone will exceed the target.
   */
  function calcRequiredMonthlySavings(params) {
    const { currentValue, targetAmount, retirementAge, currentAge, annualReturnRate } = params;
    const years = retirementAge - currentAge;
    if (years <= 0) return 0;
    const fvCurrent = currentValue * Math.pow(1 + annualReturnRate, years);
    const needed = targetAmount - fvCurrent;
    if (needed <= 0) return 0;
    const monthlyRate = Math.pow(1 + annualReturnRate, 1 / 12) - 1;
    const months = years * 12;
    return Math.ceil(needed * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1));
  }

  /**
   * FIRE number: portfolio needed to sustain expenses indefinitely at 4% SWR.
   * Uses net expenses after CPP, OAS, and extra income.
   */
  function calcFireNumber(params) {
    const { monthlyExpenses, cppMonthly = 0, oasMonthly = 0, extraMonthlyIncome = 0 } = params;
    const annualNetExpenses = Math.max(0, (monthlyExpenses - cppMonthly - oasMonthly - extraMonthlyIncome) * 12);
    return Math.round(annualNetExpenses / 0.04);
  }

  /**
   * Simplified Canadian combined federal + provincial effective tax on RRSP withdrawal income.
   */
  function estimateAnnualTax(grossAnnualIncome) {
    const bpa = 16_000; // ~basic personal amount
    if (grossAnnualIncome <= bpa) return 0;
    const taxable = grossAnnualIncome - bpa;
    // Blended federal + average provincial marginal rates
    const brackets = [
      [45_000, 0.205],
      [50_000, 0.305],
      [60_000, 0.370],
      [Infinity, 0.430],
    ];
    let tax = 0, prev = 0;
    for (const [limit, rate] of brackets) {
      const slice = Math.min(taxable - prev, limit - prev);
      if (slice <= 0) break;
      tax += slice * rate;
      prev = limit;
      if (prev >= taxable) break;
    }
    return Math.round(tax);
  }

  /**
   * Estimate current age from user data or fallback to 40.
   */
  function estimateCurrentAge(userData) {
    if (!userData || !userData.birthday) return 40;
    const birth = new Date(userData.birthday);
    const today = new Date();
    return today.getFullYear() - birth.getFullYear();
  }

  /**
   * Compute total portfolio value from positions array.
   */
  function sumPortfolio(positions) {
    if (!positions || positions.length === 0) return 0;
    return positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
  }

  /**
   * Compute total liabilities value.
   */
  function sumLiabilities(liabilities) {
    if (!liabilities || liabilities.length === 0) return 0;
    return liabilities.reduce((sum, l) => sum + Math.abs(l.market_value || 0), 0);
  }

  return {
    buildHistoricalData,
    projectPortfolio,
    monteCarlo,
    calcWithdrawalRates,
    buildIncomeSources,
    calcRequiredMonthlySavings,
    calcFireNumber,
    estimateCurrentAge,
    sumPortfolio,
    sumLiabilities,
  };
})();
