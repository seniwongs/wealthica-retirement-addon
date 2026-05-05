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

    let runningContributions = 0;
    const result = [];

    years.forEach(year => {
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
   *
   * Fixes applied:
   * - Accumulation phase now adds annualContribution each year
   * - Retirement phase subtracts CPP/OAS income (gated by start age)
   */
  function projectPortfolio(params) {
    const {
      currentValue,
      currentYear,
      retirementAge,
      currentAge,
      lifeExpectancy,
      annualReturnRate,
      annualContribution = 0,
      monthlyExpenses,
      extraMonthlyIncome = 0,
      cppMonthly = 0,
      oasMonthly = 0,
      cppStartAge = 65,
      oasStartAge = 65,
      targetAmount,
      inflationRate = 0,
    } = params;

    const yearsToRetirement = retirementAge - currentAge;
    const retirementYear = currentYear + yearsToRetirement;
    const endYear = currentYear + (lifeExpectancy - currentAge);

    const result = [];
    let value = currentValue;

    // Accumulation phase — grow portfolio and add annual contributions
    for (let y = currentYear; y <= retirementYear; y++) {
      result.push({ year: y, value: Math.round(value), phase: 'accumulation' });
      value = value * (1 + annualReturnRate) + annualContribution;
    }

    // Retirement phase — withdraw net of CPP/OAS income + OAS clawback
    const annualBaseExpenses = monthlyExpenses * 12;
    const annualBaseExtra    = extraMonthlyIncome * 12;
    for (let y = retirementYear + 1; y <= endYear; y++) {
      const age = retirementAge + (y - retirementYear);
      const inflFactor = inflationRate > 0 ? Math.pow(1 + inflationRate, y - retirementYear) : 1;
      const cpp   = age >= cppStartAge ? cppMonthly * 12 * inflFactor : 0;
      const oas   = age >= oasStartAge ? oasMonthly * 12 * inflFactor : 0;
      const extra = annualBaseExtra * inflFactor;
      const inflatedExpenses = annualBaseExpenses * inflFactor;
      const portfolioWithdrawal = Math.max(0, inflatedExpenses - cpp - oas - extra);
      const grossIncome = portfolioWithdrawal + cpp + oas + extra;
      const oasClawback = calculateOASClawback(grossIncome, oas, inflFactor);
      const withdrawal = portfolioWithdrawal + oasClawback;
      value = value * (1 + annualReturnRate) - withdrawal;
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
   * Seeded PRNG (Mulberry32) — deterministic random for Monte Carlo.
   * Same inputs always produce the same sequence.
   */
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Monte Carlo simulation — randomized annual return scenarios.
   * Returns { percentiles: { p10, p25, p50, p75, p90 }, successRate, years }
   *
   * Fixes applied:
   * - Seeded PRNG so same inputs always produce the same success rate
   * - Accumulation phase now adds annualContribution each year
   * - Retirement phase subtracts CPP/OAS income (gated by start age)
   */
  function monteCarlo(params, numSimulations = 1000) {
    const {
      currentValue,
      currentYear,
      retirementAge,
      currentAge,
      lifeExpectancy,
      annualReturnRate,
      annualContribution = 0,
      returnVolatility = 0.12,
      monthlyExpenses,
      extraMonthlyIncome = 0,
      cppMonthly = 0,
      oasMonthly = 0,
      cppStartAge = 65,
      oasStartAge = 65,
      inflationRate = 0,
    } = params;

    const yearsToRetirement = retirementAge - currentAge;
    const totalYears = lifeExpectancy - currentAge;
    const annualBaseExpenses = monthlyExpenses * 12;

    // Deterministic seed derived from key inputs
    const seed = Math.abs(
      Math.round(currentValue / 100) * 7 +
      Math.round(annualReturnRate * 10000) * 13 +
      yearsToRetirement * 17 +
      totalYears * 19 +
      cppStartAge * 23 +
      oasStartAge * 29 +
      Math.round(cppMonthly) * 31 +
      Math.round(oasMonthly) * 37
    ) % 2147483647;
    const rand = mulberry32(seed);

    // Box-Muller normal random using seeded PRNG
    function randn() {
      const u = 1 - rand();
      const v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    const allRuns = [];
    let successCount = 0;

    for (let sim = 0; sim < numSimulations; sim++) {
      let value = currentValue;
      const run = [value];
      let depleted = false;

      for (let y = 0; y < totalYears; y++) {
        const age = currentAge + y;
        // Lognormal return — geometric mean equals user's expected return (no volatility drag)
        const sigma = returnVolatility;
        const muLog = Math.log(1 + annualReturnRate) - 0.5 * sigma * sigma;
        const r = Math.exp(muLog + sigma * randn()) - 1;
        if (y < yearsToRetirement) {
          value = value * (1 + r) + annualContribution;
        } else {
          const yearsRetired = y - yearsToRetirement;
          const inflFactor = inflationRate > 0 ? Math.pow(1 + inflationRate, yearsRetired) : 1;
          const cppIncome   = age >= cppStartAge ? cppMonthly * 12 * inflFactor : 0;
          const oasIncome   = age >= oasStartAge ? oasMonthly * 12 * inflFactor : 0;
          const extraIncome = extraMonthlyIncome * 12 * inflFactor;
          const portfolioWithdrawal = Math.max(0, annualBaseExpenses * inflFactor - cppIncome - oasIncome - extraIncome);
          const grossIncome = portfolioWithdrawal + cppIncome + oasIncome + extraIncome;
          const oasClawback = calculateOASClawback(grossIncome, oasIncome, inflFactor);
          const netWithdrawal = portfolioWithdrawal + oasClawback;
          value = value * (1 + r) - netWithdrawal;
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
   * Uses actual portfolio withdrawal (net of CPP/OAS) for accurate rates.
   *
   * Fix: now derives annualWithdrawal from incomeSources to account for CPP/OAS.
   */
  function calcWithdrawalRates(projection, params) {
    const {
      monthlyExpenses, extraMonthlyIncome = 0,
      retirementAge, currentAge, currentYear,
      cppMonthly = 0, oasMonthly = 0,
      cppStartAge = 65, oasStartAge = 65,
    } = params;
    const retirementYear = currentYear + (retirementAge - currentAge);

    return projection
      .filter(p => p.phase === 'retirement' && p.value > 0)
      .map(p => {
        const age = retirementAge + (p.year - retirementYear);
        const cpp = age >= cppStartAge ? cppMonthly * 12 : 0;
        const oas = age >= oasStartAge ? oasMonthly * 12 : 0;
        const annualWithdrawal = Math.max(0, (monthlyExpenses - extraMonthlyIncome) * 12 - cpp - oas);
        return {
          year: p.year,
          portfolioValue: p.value,
          annualWithdrawal,
          withdrawalRate: p.value > 0 ? (annualWithdrawal / p.value) * 100 : 0,
        };
      });
  }

  /**
   * Build retirement income sources per year.
   * CPP and OAS start at user-specified ages (default 65).
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
      cppStartAge = 65,
      oasStartAge = 65,
    } = params;

    const retirementYear = currentYear + (retirementAge - currentAge);
    const endYear = currentYear + (lifeExpectancy - currentAge);
    const result = [];

    const inflationRate = params.inflationRate || 0;
    for (let y = retirementYear; y <= endYear; y++) {
      const age = retirementAge + (y - retirementYear);
      const inflFactor = inflationRate > 0 ? Math.pow(1 + inflationRate, y - retirementYear) : 1;
      const cpp   = age >= cppStartAge ? cppMonthly * 12 * inflFactor : 0;
      const oas   = age >= oasStartAge ? oasMonthly * 12 * inflFactor : 0;
      const extra = extraMonthlyIncome * 12 * inflFactor;
      const totalNeeded = monthlyExpenses * 12 * inflFactor;
      const totalPassive = cpp + oas + extra;
      const portfolioWithdrawal = Math.max(0, totalNeeded - totalPassive);
      const grossIncome = portfolioWithdrawal + cpp + oas + extra;
      const oasClawback = calculateOASClawback(grossIncome, oas, inflFactor);
      const estimatedTax = estimateAnnualTax(grossIncome, age);
      result.push({ year: y, portfolioWithdrawal, cpp, oas, extra, estimatedTax, oasClawback });
    }

    return result;
  }

  /**
   * Monthly savings required to reach targetAmount by retirement.
   * Accounts for future value of both current portfolio AND existing annual contributions.
   * Returns 0 if current portfolio + contributions will exceed the target.
   *
   * Fix: now subtracts FV of existing annualContribution from the gap calculation.
   */
  function calcRequiredMonthlySavings(params) {
    const { currentValue, targetAmount, retirementAge, currentAge, annualReturnRate, annualContribution = 0 } = params;
    const years = retirementAge - currentAge;
    if (years <= 0) return 0;
    const monthlyRate = Math.pow(1 + annualReturnRate, 1 / 12) - 1;
    const months = years * 12;
    const fvCurrent = currentValue * Math.pow(1 + annualReturnRate, years);
    // FV of existing annual contributions as level monthly payments
    const fvExisting = monthlyRate > 0
      ? (annualContribution / 12) * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate
      : (annualContribution / 12) * months;
    const needed = targetAmount - fvCurrent - fvExisting;
    if (needed <= 0) return 0;
    return Math.ceil(needed * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1));
  }

  /**
   * FIRE number: portfolio needed to sustain expenses indefinitely at 4% SWR.
   * Only subtracts CPP/OAS if they're active at retirement (start age <= retirement age).
   */
  function calcFireNumber(params) {
    const { monthlyExpenses, cppMonthly = 0, oasMonthly = 0, extraMonthlyIncome = 0,
            retirementAge = 65, cppStartAge = 65, oasStartAge = 65,
            safeWithdrawalRate = 0.04 } = params;
    const cpp = retirementAge >= cppStartAge ? cppMonthly : 0;
    const oas = retirementAge >= oasStartAge ? oasMonthly : 0;
    const annualNetExpenses = Math.max(0, (monthlyExpenses - cpp - oas - extraMonthlyIncome) * 12);
    return Math.round(annualNetExpenses / safeWithdrawalRate);
  }

  // 2025 federal BPA (indexed)
  const CA_BPA = 16_129;

  // 2025 CRA federal income tax brackets
  const CA_FEDERAL_BRACKETS = [
    [57_375,   0.15],
    [114_750,  0.205],
    [158_468,  0.26],
    [220_000,  0.29],
    [Infinity, 0.33],
  ];

  // Age amount (2025): $8,790, clawed back at 15% above $44,325
  const CA_AGE_AMOUNT = 8_790;
  const CA_AGE_CLAWBACK_THRESHOLD = 44_325;

  // OAS recovery tax (2025 indexed threshold)
  const OAS_CLAWBACK_THRESHOLD = 93_454;

  function estimateAnnualTax(grossAnnualIncome, age = 0) {
    if (grossAnnualIncome <= CA_BPA) return 0;
    const taxable = grossAnnualIncome - CA_BPA;

    let tax = 0, prev = 0;
    for (const [limit, rate] of CA_FEDERAL_BRACKETS) {
      const slice = Math.min(taxable - prev, limit - prev);
      if (slice <= 0) break;
      tax += slice * rate;
      prev = limit;
    }

    // Age amount credit for 65+
    if (age >= 65) {
      const eligibleAgeAmount = Math.max(
        0,
        CA_AGE_AMOUNT - Math.max(0, grossAnnualIncome - CA_AGE_CLAWBACK_THRESHOLD) * 0.15,
      );
      tax -= eligibleAgeAmount * 0.15;
    }

    // Approximate provincial tax (~10% blended average)
    const provincial = (grossAnnualIncome - CA_BPA) * 0.10;

    return Math.max(0, Math.round(tax + provincial));
  }

  // OAS Recovery Tax (clawback) — capped at OAS amount
  function calculateOASClawback(grossIncome, oasAnnual, inflFactor = 1) {
    const threshold = OAS_CLAWBACK_THRESHOLD * inflFactor;
    if (grossIncome <= threshold || oasAnnual <= 0) return 0;
    const excess = grossIncome - threshold;
    return Math.min(Math.round(excess * 0.15), oasAnnual);
  }

  /**
   * Adjust CPP monthly benefit for claiming age. Baseline: 65.
   * Early (<65): −0.6%/month. Late (>65): +0.7%/month. Clamped to [60, 70].
   */
  function adjustCPP(baseMonthly, startAge) {
    const clamped = Math.max(60, Math.min(70, startAge));
    const months = (clamped - 65) * 12;
    const rate = months < 0 ? 0.006 : 0.007;
    return Math.round(baseMonthly * (1 + months * rate));
  }

  /**
   * Adjust OAS monthly benefit for deferral past 65. +0.6%/month. Clamped to [65, 70].
   */
  function adjustOAS(baseMonthly, startAge) {
    const clamped = Math.max(65, Math.min(70, startAge));
    const months = (clamped - 65) * 12;
    return Math.round(baseMonthly * (1 + months * 0.006));
  }

  /**
   * Sequence-of-returns risk: 3 deterministic retirement scenarios showing how
   * crash timing affects portfolio survival.
   * Returns { labels (ages), base, earlyCrash, lateCrash } — each an array of values.
   *
   * Fix: portfolioAtRetirement now includes future value of annual contributions.
   */
  function sequenceOfReturns(params) {
    const {
      currentValue,
      retirementAge,
      currentAge,
      lifeExpectancy,
      annualReturnRate,
      annualContribution = 0,
      monthlyExpenses,
      extraMonthlyIncome = 0,
      cppMonthly = 0,
      oasMonthly = 0,
      cppStartAge = 65,
      oasStartAge = 65,
    } = params;

    const yearsToRetirement = Math.max(0, retirementAge - currentAge);
    const retirementYears = Math.max(1, lifeExpectancy - retirementAge);
    const r = annualReturnRate;
    const CRASH = 0.30;

    // Include future value of contributions in retirement starting portfolio
    const fvCurrent = currentValue * Math.pow(1 + r, yearsToRetirement);
    const fvContrib = r > 0
      ? annualContribution * (Math.pow(1 + r, yearsToRetirement) - 1) / r
      : annualContribution * yearsToRetirement;
    const portfolioAtRetirement = fvCurrent + fvContrib;

    function simulate(crashYearIndex) {
      let value = portfolioAtRetirement;
      const values = [Math.round(value)];
      for (let y = 0; y < retirementYears; y++) {
        const age = retirementAge + y;
        const cpp = age >= cppStartAge ? cppMonthly * 12 : 0;
        const oas = age >= oasStartAge ? oasMonthly * 12 : 0;
        const netWithdrawal = Math.max(0, monthlyExpenses * 12 - cpp - oas - extraMonthlyIncome * 12);
        // Crash applies to the growth factor before withdrawal (market drops, then you still need to withdraw)
        const growthFactor = (1 + r) * (y === crashYearIndex ? (1 - CRASH) : 1);
        value = value * growthFactor - netWithdrawal;
        value = Math.max(0, value);
        values.push(Math.round(value));
      }
      return values;
    }

    const labels = Array.from({ length: retirementYears + 1 }, (_, i) => retirementAge + i);
    const lateCrashYear = Math.floor(retirementYears * 0.7);
    return {
      labels,
      base: simulate(-1),
      earlyCrash: simulate(1),
      lateCrash: simulate(lateCrashYear),
      lateCrashAge: retirementAge + lateCrashYear,
    };
  }

  /**
   * RRSP vs. Taxable account benefit calculator.
   * Returns year-by-year growth comparison and at-retirement after-tax values.
   */
  function calcRrspBenefit(params) {
    const { annualContribution, yearsToRetirement, annualReturnRate, estimatedGrossIncome, estimatedRetirementIncome } = params;
    if (!annualContribution || yearsToRetirement <= 0) return null;

    const taxWithout   = estimateAnnualTax(estimatedGrossIncome);
    const taxWith      = estimateAnnualTax(Math.max(0, estimatedGrossIncome - annualContribution));
    const annualRefund = taxWithout - taxWith;
    const marginalRate = annualContribution > 0 ? annualRefund / annualContribution : 0;

    const r = annualReturnRate;
    const n = yearsToRetirement;
    const fvFactor = r > 0 ? (Math.pow(1 + r, n) - 1) / r : n;

    // RRSP: contribution + refund reinvested; taxed at retirement effective rate
    const rrspFV = (annualContribution + annualRefund) * fvFactor;
    const retirementIncome = estimatedRetirementIncome ?? estimatedGrossIncome;
    const retirementTax = estimateAnnualTax(retirementIncome);
    const retirementEffectiveRate = retirementIncome > 0 ? retirementTax / retirementIncome : marginalRate * 0.5;
    const rrspAfterTax = rrspFV * (1 - retirementEffectiveRate);

    // Taxable: 0.5%/yr tax drag; 2024 capital gains inclusion (50% up to $250k, then 2/3)
    const taxableReturn   = Math.max(0, r - 0.005);
    const taxableFVFactor = taxableReturn > 0 ? (Math.pow(1 + taxableReturn, n) - 1) / taxableReturn : n;
    const taxableFV       = annualContribution * taxableFVFactor;
    const taxableGains    = Math.max(0, taxableFV - annualContribution * n);
    const taxableInclusion = Math.min(taxableGains, 250_000) * 0.5 + Math.max(0, taxableGains - 250_000) * (2 / 3);
    const taxableAfterTax = taxableFV - taxableInclusion * marginalRate;

    // Year-by-year cumulative values for the chart
    const years = Array.from({ length: n + 1 }, (_, i) => i);
    const rrspByYear = years.map(i => {
      if (i === 0) return 0;
      const f = r > 0 ? (Math.pow(1 + r, i) - 1) / r : i;
      return Math.round((annualContribution + annualRefund) * f);
    });
    const taxableByYear = years.map(i => {
      if (i === 0) return 0;
      const f = taxableReturn > 0 ? (Math.pow(1 + taxableReturn, i) - 1) / taxableReturn : i;
      return Math.round(annualContribution * f);
    });

    return { annualRefund, marginalRate, rrspAfterTax, taxableAfterTax, rrspFV, taxableFV, years, rrspByYear, taxableByYear };
  }

  /**
   * Estimate current age from user data or fallback to 40.
   */
  function estimateCurrentAge(userData) {
    if (!userData || !userData.birthday) return 40;
    const birth = new Date(userData.birthday);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    // Subtract 1 if birthday hasn't occurred yet this year
    const hadBirthday =
      today.getMonth() > birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
    if (!hadBirthday) age -= 1;
    return age;
  }

  /**
   * Compute total portfolio value from positions array.
   */
  function sumPortfolio(positions) {
    if (!positions) return 0;
    return positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
  }

  /**
   * Compute total liabilities value.
   */
  function sumLiabilities(liabilities) {
    if (!liabilities) return 0;
    // Wealthica liabilities may use 'value' or 'market_value' depending on API version
    return liabilities.reduce((sum, l) => sum + Math.abs(l.market_value || l.value || 0), 0);
  }

  return {
    buildHistoricalData,
    projectPortfolio,
    monteCarlo,
    calcWithdrawalRates,
    buildIncomeSources,
    calcRequiredMonthlySavings,
    calcFireNumber,
    calcRrspBenefit,
    sequenceOfReturns,
    estimateCurrentAge,
    sumPortfolio,
    sumLiabilities,
    estimateAnnualTax,
    calculateOASClawback,
    adjustCPP,
    adjustOAS,
  };
})();
