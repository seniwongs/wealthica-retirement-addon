/**
 * charts.js
 * Chart.js renderers for all 7 retirement charts.
 * Each function creates or updates its chart instance.
 */

const Charts = (() => {
  const instances = {};

  const COLORS = {
    white:      '#ffffff',
    whiteGlow:  'rgba(255,255,255,0.08)',
    cyan:       '#22d3ee',
    cyanLight:  'rgba(34,211,238,0.15)',
    blue:       '#3b82f6',
    blueLight:  'rgba(59,130,246,0.15)',
    green:      '#4ade80',
    greenLight: 'rgba(74,222,128,0.12)',
    red:        '#f87171',
    redLight:   'rgba(248,113,113,0.15)',
    amber:      '#fbbf24',
    orange:     '#f97316',
    purple:     '#a855f7',
    purpleLight:'rgba(168,85,247,0.15)',
    teal:       '#2dd4bf',
    gray:       'rgba(255,255,255,0.35)',
    grayLight:  'rgba(255,255,255,0.05)',
  };

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function getBaseOptions() {
    const light = isLight();
    const tickColor  = light ? '#94a3b8'               : 'rgba(255,255,255,0.3)';
    const gridColor  = light ? '#e9edf3'               : 'rgba(255,255,255,0.05)';
    const borderColor= light ? '#e2e8f0'               : 'rgba(255,255,255,0.08)';
    const legendColor= light ? '#64748b'               : 'rgba(255,255,255,0.45)';
    const tooltipBg  = light ? 'rgba(255,255,255,0.98)': 'rgba(13,17,23,0.95)';
    const tooltipBdr = light ? '#e2e8f0'               : 'rgba(255,255,255,0.1)';
    const tooltipTitle=light ? '#1e293b'               : '#e2e8f0';
    const tooltipBody= light ? '#64748b'               : 'rgba(255,255,255,0.65)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      elements: {
        point: {
          radius: 4,
          hoverRadius: 7,
          hitRadius: 8,
          borderWidth: 2,
          borderColor: light ? '#f5f6fa' : '#0d1117',
        }
      },
      plugins: {
        legend: {
          labels: {
            font: { size: 11 },
            color: legendColor,
            boxWidth: 10,
            usePointStyle: true,
            pointStyle: 'circle',
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          borderColor: tooltipBdr,
          borderWidth: 1,
          titleColor: tooltipTitle,
          bodyColor:  tooltipBody,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y ?? ctx.parsed;
              if (typeof v === 'number') return ` ${ctx.dataset.label}: ${fmt(v)}`;
              return ` ${ctx.dataset.label}: ${v}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: tickColor, font: { size: 10 } },
          grid:  { color: gridColor },
          border:{ color: borderColor },
        },
        y: {
          ticks: {
            color: tickColor,
            font: { size: 10 },
            callback: fmtAxis
          },
          grid:  { color: gridColor },
          border:{ color: borderColor },
        }
      }
    };
  }

  function fmt(v) {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (v/1e3).toFixed(0) + 'k';
    return '$' + v.toFixed(0);
  }

  // Compact axis labels — 1 decimal for M, no cents elsewhere
  function fmtAxis(v) {
    if (v >= 1e6) return '$' + (v/1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v/1e3).toFixed(0) + 'k';
    return '$' + v;
  }

  function getStackedOptions() {
    const bo = getBaseOptions();
    return { ...bo, scales: { ...bo.scales, x: { ...bo.scales.x, stacked: true }, y: { ...bo.scales.y, stacked: true } } };
  }

  function destroyIfExists(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  // ── Chart 1: Portfolio Value Over Time ─────────────────────────────────────
  function renderPortfolioValue(historicalData, projection, targetAmount, retirementYear, overlays = null) {
    destroyIfExists('portfolio-value');
    const ctx = document.getElementById('chart-portfolio-value');
    if (!ctx) return;

    const histLabels  = historicalData.map(d => d.year);
    const projLabels  = projection.map(d => d.year);
    const allLabels   = [...new Set([...histLabels, ...projLabels])].sort();
    const splitIdx    = projection.findIndex(d => d.phase === 'retirement');

    // Retirement-year vertical line + target label plugin (closure over local vars)
    const retLinePlugin = {
      id: 'retirementLine',
      afterDraw(chart) {
        try {
          if (!retirementYear) return;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          if (!xScale || !yScale) return;
          // Use index-based lookup for CategoryScale (numeric labels)
          const retIdx = chart.data.labels.indexOf(retirementYear);
          if (retIdx < 0) return;
          // getPixelForValue on CategoryScale takes the index
          const x = xScale.getPixelForValue(retIdx);
          if (!isFinite(x)) return;
          const c = chart.ctx;
          c.save();
          c.strokeStyle = 'rgba(168,85,247,0.5)';
          c.lineWidth   = 1.5;
          c.setLineDash([4, 4]);
          c.beginPath();
          c.moveTo(x, yScale.top);
          c.lineTo(x, yScale.bottom);
          c.stroke();
          c.setLineDash([]);
          if (targetAmount) {
            const rawY   = yScale.getPixelForValue(targetAmount);
            const labelY = Math.max(yScale.top + 18, Math.min(yScale.bottom - 8, rawY - 6));
            const label  = fmt(targetAmount) + ' Target Nest Egg';
            c.font      = '600 10px -apple-system,sans-serif';
            c.fillStyle = '#c084fc';
            c.textAlign = 'left';
            c.fillText(label, x + 5, labelY);
          }
          c.restore();
        } catch (e) { /* don't let plugin errors break the chart */ }
      }
    };

    const light = isLight();
    const histColor = light ? COLORS.blue   : COLORS.white;
    const histFill  = light ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.06)';
    const accColor  = light ? '#0891b2'     : COLORS.cyan;
    const retColor  = light ? COLORS.amber  : COLORS.orange;
    const tgtColor  = light ? 'rgba(124,58,237,0.6)' : 'rgba(168,85,247,0.4)';

    instances['portfolio-value'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          {
            label: 'Historical',
            data: allLabels.map(y => {
              const h = historicalData.find(d => d.year === y);
              return h ? h.portfolioValue : null;
            }),
            borderColor: histColor,
            backgroundColor: histFill,
            fill: true,
            tension: 0.3,
            borderWidth: 2.5,
          },
          {
            label: 'Projected (Accumulation)',
            data: allLabels.map(y => {
              const p = projection.find(d => d.year === y && d.phase === 'accumulation');
              return p ? p.value : null;
            }),
            borderColor: accColor,
            borderDash: [4, 4],
            fill: false,
            tension: 0.3,
            borderWidth: 2,
          },
          {
            label: 'Projected (Retirement)',
            data: allLabels.map(y => {
              const p = projection.find(d => d.year === y && d.phase === 'retirement');
              return p ? p.value : null;
            }),
            borderColor: retColor,
            borderDash: [4, 4],
            fill: false,
            tension: 0.3,
            borderWidth: 2,
          },
          ...(targetAmount ? [{
            label: 'Target Nest Egg',
            data: allLabels.map(() => targetAmount),
            borderColor: tgtColor,
            borderDash: [3, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0,
          }] : []),
          ...(overlays ? [
            {
              label: 'Retire 2yr Earlier',
              data: allLabels.map(y => {
                const d = overlays.early.find(p => p.year === y);
                return d ? d.value : null;
              }),
              borderColor: 'rgba(34,211,238,0.28)',
              borderDash: [2, 5],
              borderWidth: 1.5,
              fill: false,
              pointRadius: 0,
              tension: 0.3,
            },
            {
              label: 'Retire 2yr Later',
              data: allLabels.map(y => {
                const d = overlays.late.find(p => p.year === y);
                return d ? d.value : null;
              }),
              borderColor: 'rgba(168,85,247,0.28)',
              borderDash: [2, 5],
              borderWidth: 1.5,
              fill: false,
              pointRadius: 0,
              tension: 0.3,
            },
          ] : []),
        ]
      },
      options: getBaseOptions(),
      plugins: [retLinePlugin],
    });
  }

  // ── Chart 2: Contributions vs. Returns ─────────────────────────────────────
  function renderContributions(historicalData) {
    destroyIfExists('contributions');
    const ctx = document.getElementById('chart-contributions');
    if (!ctx) return;

    if (!historicalData || historicalData.length === 0) {
      _showNoData(ctx); return;
    }

    instances['contributions'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: historicalData.map(d => d.year),
        datasets: [
          {
            label: 'Contributions',
            data: historicalData.map(d => d.contributions),
            backgroundColor: COLORS.blue,
            stack: 's',
          },
          {
            label: 'Market Returns',
            data: historicalData.map(d => d.returns),
            backgroundColor: COLORS.green,
            stack: 's',
          }
        ]
      },
      options: getStackedOptions()
    });
  }

  // ── Chart 3: Retirement Runway ──────────────────────────────────────────────
  function renderRunway(projection, retirementYear, params) {
    destroyIfExists('runway');
    const ctx = document.getElementById('chart-runway');
    if (!ctx) return;

    const retData = projection.filter(d => d.year >= retirementYear);
    if (!retData.length) return;

    // Build safe withdrawal line: portfolio needed to sustain net expenses at 4% SWR
    const cppStartAge = params.cppStartAge || 65;
    const oasStartAge = params.oasStartAge || 65;
    const safeData = retData.map(d => {
      const age = params.retirementAge + (d.year - retirementYear);
      const cpp = age >= cppStartAge ? (params.cppMonthly || 0) : 0;
      const oas = age >= oasStartAge ? (params.oasMonthly || 0) : 0;
      const netAnnual = (params.monthlyExpenses - cpp - oas - (params.extraMonthlyIncome || 0)) * 12;
      return Math.max(0, netAnnual) / 0.04;
    });

    // Build milestone markers
    const milestones = [];
    milestones.push({ year: retirementYear, label: `Retirement (${retirementYear})` });
    if (cppStartAge === oasStartAge && cppStartAge > params.retirementAge) {
      milestones.push({ year: retirementYear + (cppStartAge - params.retirementAge), label: `CPP & OAS (${cppStartAge})` });
    } else {
      if (cppStartAge > params.retirementAge) {
        milestones.push({ year: retirementYear + (cppStartAge - params.retirementAge), label: `CPP (${cppStartAge})` });
      }
      if (oasStartAge > params.retirementAge) {
        milestones.push({ year: retirementYear + (oasStartAge - params.retirementAge), label: `OAS (${oasStartAge})` });
      }
    }
    if (params.lifeExpectancy > 71 && params.retirementAge <= 71) {
      milestones.push({ year: retirementYear + (71 - params.retirementAge), label: 'RRIF (71)' });
    }
    const depletionPt = retData.find(d => d.value === 0);
    if (depletionPt) {
      milestones.push({ year: depletionPt.year, label: 'Portfolio Depleted' });
    }

    // Plugin: green/red fill between portfolio and safe withdrawal lines
    const runwayPlugin = {
      id: 'runwayFill',
      beforeDatasetsDraw(chart) {
        const { ctx: c, chartArea, scales } = chart;
        const xScale = scales.x;
        const yScale = scales.y;
        if (!chartArea) return;
        const portfolioDs = chart.data.datasets[0];
        const safeDs      = chart.data.datasets[1];
        const n = portfolioDs.data.length;
        if (n < 2) return;
        c.save();
        c.beginPath();
        c.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        c.clip();
        for (let i = 0; i < n - 1; i++) {
          const x0  = xScale.getPixelForValue(i);
          const x1  = xScale.getPixelForValue(i + 1);
          const pv0 = yScale.getPixelForValue(portfolioDs.data[i] ?? 0);
          const pv1 = yScale.getPixelForValue(portfolioDs.data[i + 1] ?? 0);
          const sv0 = yScale.getPixelForValue(safeDs.data[i] ?? 0);
          const sv1 = yScale.getPixelForValue(safeDs.data[i + 1] ?? 0);
          c.fillStyle = (portfolioDs.data[i] >= safeDs.data[i])
            ? 'rgba(74,222,128,0.12)'
            : 'rgba(248,113,113,0.12)';
          c.beginPath();
          c.moveTo(x0, pv0);
          c.lineTo(x1, pv1);
          c.lineTo(x1, sv1);
          c.lineTo(x0, sv0);
          c.closePath();
          c.fill();
        }
        c.restore();
      }
    };

    // Plugin: vertical dashed milestone lines with labels
    const milestonePlugin = {
      id: 'runwayMilestones',
      afterDraw(chart) {
        const { ctx: c, chartArea, scales } = chart;
        const xScale = scales.x;
        const labels = chart.data.labels;
        milestones.forEach(({ year, label }) => {
          const idx = labels.indexOf(year);
          if (idx < 0) return;
          const x = xScale.getPixelForValue(idx);
          if (!isFinite(x)) return;
          c.save();
          c.strokeStyle = 'rgba(255,255,255,0.25)';
          c.lineWidth = 1;
          c.setLineDash([4, 4]);
          c.beginPath();
          c.moveTo(x, chartArea.top);
          c.lineTo(x, chartArea.bottom);
          c.stroke();
          c.fillStyle = 'rgba(255,255,255,0.5)';
          c.font = '10px sans-serif';
          c.textAlign = 'center';
          c.fillText(label, x, chartArea.top + 12);
          c.restore();
        });
      }
    };

    const bo = getBaseOptions();
    instances['runway'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: retData.map(d => d.year),
        datasets: [
          {
            label: 'Portfolio Balance',
            data: retData.map(d => d.value),
            borderColor: COLORS.blue,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
          },
          {
            label: 'Safe Withdrawal Level',
            data: safeData,
            borderColor: COLORS.amber,
            borderDash: [5, 4],
            borderWidth: 1.5,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0,
            pointRadius: 0,
          }
        ]
      },
      options: {
        ...bo,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...bo.plugins,
          tooltip: {
            ...bo.plugins.tooltip,
            callbacks: {
              ...bo.plugins.tooltip.callbacks,
              afterBody: items => {
                if (!items.length) return [];
                const i = items[0].dataIndex;
                const portfolio = retData[i]?.value ?? 0;
                const safe = safeData[i] ?? 0;
                const diff = portfolio - safe;
                if (diff >= 0) return [`  Surplus: ${fmt(diff)}`];
                return [`  Risk Zone: ${fmt(Math.abs(diff))} short`];
              }
            }
          }
        }
      },
      plugins: [runwayPlugin, milestonePlugin],
    });
  }

  // ── Chart 4: Monte Carlo ────────────────────────────────────────────────────
  function renderMonteCarlo(mcResult) {
    destroyIfExists('monte-carlo');
    const ctx = document.getElementById('chart-monte-carlo');
    if (!ctx) return;

    const { percentiles, successRate, years } = mcResult;

    // Update stats panel
    const statsEl = document.getElementById('mc-stats');
    if (statsEl) {
      const cls = successRate >= 80 ? 'good' : successRate >= 60 ? 'warn' : 'bad';
      statsEl.innerHTML = `
        <div class="mc-stat">
          <span class="label">Success Rate</span>
          <span class="value ${cls}">${successRate}%</span>
        </div>
        <div class="mc-stat">
          <span class="label">Median Outcome (p50)</span>
          <span class="value">${fmt(percentiles.p50[percentiles.p50.length - 1]?.value)}</span>
        </div>
        <div class="mc-stat">
          <span class="label">Worst 10% (p10)</span>
          <span class="value">${fmt(percentiles.p10[percentiles.p10.length - 1]?.value)}</span>
        </div>
      `;
      // Update MC ring in sidebar
      const ringArc  = document.getElementById('mc-ring-arc');
      const ringPct  = document.getElementById('summary-success');
      const ringColor = successRate >= 80 ? '#22c55e' : successRate >= 60 ? '#fbbf24' : '#f87171';
      const circumference = 201; // 2π×32
      if (ringArc) {
        ringArc.style.strokeDashoffset = circumference * (1 - successRate / 100);
        ringArc.style.stroke = ringColor;
        ringArc.style.filter = `drop-shadow(0 0 5px ${ringColor}99)`;
      }
      if (ringPct) {
        ringPct.textContent = successRate + '%';
        ringPct.style.color = ringColor;
      }
    }

    instances['monte-carlo'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Best 10% (p90)',
            data: percentiles.p90.map(d => d.value),
            borderColor: 'rgba(16,185,129,0.4)',
            backgroundColor: 'rgba(16,185,129,0.08)',
            fill: '+1',
            tension: 0.4, pointRadius: 0, borderWidth: 1,
          },
          {
            label: 'Upper 25% (p75)',
            data: percentiles.p75.map(d => d.value),
            borderColor: 'rgba(59,130,246,0.5)',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: '+1',
            tension: 0.4, pointRadius: 0, borderWidth: 1,
          },
          {
            label: 'Median (p50)',
            data: percentiles.p50.map(d => d.value),
            borderColor: COLORS.blue,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.4, pointRadius: 0, borderWidth: 2.5,
          },
          {
            label: 'Lower 25% (p25)',
            data: percentiles.p25.map(d => d.value),
            borderColor: 'rgba(245,158,11,0.5)',
            backgroundColor: 'rgba(245,158,11,0.08)',
            fill: '+1',
            tension: 0.4, pointRadius: 0, borderWidth: 1,
          },
          {
            label: 'Worst 10% (p10)',
            data: percentiles.p10.map(d => d.value),
            borderColor: 'rgba(239,68,68,0.4)',
            backgroundColor: 'rgba(239,68,68,0.05)',
            fill: false,
            tension: 0.4, pointRadius: 0, borderWidth: 1,
          },
        ]
      },
      options: getBaseOptions()
    });
  }

  // ── Chart 5: Retirement Income Sources ─────────────────────────────────────
  function renderIncomeSources(incomeSources) {
    destroyIfExists('income-sources');
    const ctx = document.getElementById('chart-income-sources');
    if (!ctx) return;

    instances['income-sources'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: incomeSources.map(d => d.year),
        datasets: [
          {
            label: 'Portfolio Withdrawal',
            data: incomeSources.map(d => d.portfolioWithdrawal),
            backgroundColor: COLORS.blue,
            stack: 's',
          },
          {
            label: 'CPP',
            data: incomeSources.map(d => d.cpp),
            backgroundColor: COLORS.green,
            stack: 's',
          },
          {
            label: 'OAS',
            data: incomeSources.map(d => d.oas),
            backgroundColor: COLORS.teal,
            stack: 's',
          },
          {
            label: 'Extra Income',
            data: incomeSources.map(d => d.extra),
            backgroundColor: COLORS.purple,
            stack: 's',
          },
          {
            label: 'Est. Tax',
            data: incomeSources.map(d => -(d.estimatedTax || 0)),
            backgroundColor: COLORS.red,
            stack: 's',
          }
        ]
      },
      options: getStackedOptions()
    });
  }

  // ── Chart 6: Withdrawal Rate ────────────────────────────────────────────────
  function renderWithdrawalRate(withdrawalRates) {
    destroyIfExists('withdrawal-rate');
    const ctx = document.getElementById('chart-withdrawal-rate');
    if (!ctx) return;

    const SAFE_RATE = 4;
    const safeLine = withdrawalRates.map(() => SAFE_RATE);

    const portfolioLabelPlugin = {
      id: 'portfolioLabels',
      afterDatasetsDraw(chart) {
        const c = chart.ctx;
        const meta = chart.getDatasetMeta(0); // bars dataset
        meta.data.forEach((bar, i) => {
          const value = withdrawalRates[i]?.portfolioValue;
          if (value == null) return;
          c.save();
          c.font = 'bold 9px sans-serif';
          c.fillStyle = '#6b7a8d';
          c.textAlign = 'center';
          c.fillText(fmt(value), bar.x, bar.y - 4);
          c.restore();
        });
        // "4%" label at the right edge of the reference line
        const yScale = chart.scales.y;
        const xScale = chart.scales.x;
        if (!yScale || !xScale) return;
        const yPx = yScale.getPixelForValue(SAFE_RATE);
        const xPx = xScale.right + 4;
        c.save();
        c.font = 'bold 10px sans-serif';
        c.fillStyle = COLORS.amber;
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText('4%', xPx, yPx);
        c.restore();
      }
    };

    instances['withdrawal-rate'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: withdrawalRates.map(d => d.year),
        datasets: [
          {
            label: 'Your Withdrawal Rate (%)',
            data: withdrawalRates.map(d => Math.min(d.withdrawalRate, 20).toFixed(1)),
            backgroundColor: withdrawalRates.map(d =>
              d.withdrawalRate > 6 ? COLORS.red :
              d.withdrawalRate > 4 ? COLORS.amber : COLORS.green
            ),
            yAxisID: 'y',
          },
          {
            label: `${SAFE_RATE}% Safe Withdrawal Rate`,
            data: safeLine,
            type: 'line',
            borderColor: COLORS.amber,
            borderDash: [6, 3],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            yAxisID: 'y',
          }
        ]
      },
      options: (() => {
        const bo = getBaseOptions();
        return { ...bo,
          plugins: { ...bo.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${parseFloat(ctx.parsed.y).toFixed(1)}%` } } },
          scales: { x: bo.scales.x, y: { ...bo.scales.y, ticks: { ...bo.scales.y.ticks, callback: v => v + '%' }, title: { display: true, text: 'Withdrawal Rate (%)', color: bo.scales.y.ticks.color, font: { size: 11 } } } }
        };
      })(),
      plugins: [portfolioLabelPlugin],
    });
  }

  // ── Chart 7: Net Worth Over Time ────────────────────────────────────────────
  function renderNetWorth(projection, totalLiabilities, totalAssets, params = {}) {
    destroyIfExists('net-worth');
    const ctx = document.getElementById('chart-net-worth');
    if (!ctx) return;

    // Real mortgage amortization
    const mortgageRate  = params.mortgageRate  || 0.05;
    const mortgageYears = params.mortgageYears || 20;
    const mr = mortgageRate / 12;
    const mn = mortgageYears * 12;
    const monthlyPayment = mr > 0
      ? totalLiabilities * (mr * Math.pow(1 + mr, mn)) / (Math.pow(1 + mr, mn) - 1)
      : (mn > 0 ? totalLiabilities / mn : 0);

    const liabData = projection.map((_, i) => {
      const monthsPaid = i * 12;
      if (monthsPaid >= mn || totalLiabilities <= 0) return 0;
      const balance = mr > 0
        ? totalLiabilities * Math.pow(1 + mr, monthsPaid)
          - monthlyPayment * (Math.pow(1 + mr, monthsPaid) - 1) / mr
        : totalLiabilities - monthlyPayment * monthsPaid;
      return Math.max(0, Math.round(balance));
    });
    const payoffIdx = liabData.findIndex(v => v === 0);

    // Other assets (house, car) held flat at current value
    const assetsValue = totalAssets || 0;
    const assetsData = projection.map(() => assetsValue);

    const netWorthData = projection.map((d, i) =>
      Math.max(0, d.value + assetsValue - liabData[i])
    );

    const datasets = [
      {
        label: 'Investment Portfolio',
        data: projection.map(d => d.value),
        borderColor: COLORS.blue,
        backgroundColor: COLORS.blueLight,
        fill: true,
        tension: 0.3, borderWidth: 2,
      },
      {
        label: 'Liabilities',
        data: liabData,
        borderColor: COLORS.red,
        backgroundColor: COLORS.redLight,
        fill: true,
        tension: 0.3, borderWidth: 2,
      },
      {
        label: 'Net Worth',
        data: netWorthData,
        borderColor: COLORS.green,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3, borderWidth: 2.5,
      },
    ];

    if (assetsValue > 0) {
      datasets.splice(1, 0, {
        label: 'Real Estate & Other Assets',
        data: assetsData,
        borderColor: COLORS.amber,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0, borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
      });
    }

    // Plugin: mortgage payoff milestone line
    const payoffPlugin = {
      id: 'mortgagePayoff',
      afterDraw(chart) {
        if (payoffIdx <= 0 || totalLiabilities <= 0) return;
        const { ctx: c, chartArea, scales } = chart;
        const xScale = scales.x;
        const x = xScale.getPixelForValue(payoffIdx);
        if (!isFinite(x)) return;
        c.save();
        c.strokeStyle = 'rgba(248,113,113,0.4)';
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(x, chartArea.top);
        c.lineTo(x, chartArea.bottom);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = 'rgba(248,113,113,0.7)';
        c.font = '9px sans-serif';
        c.textAlign = 'center';
        c.fillText('Mortgage Paid Off', x, chartArea.top + 12);
        c.restore();
      }
    };

    instances['net-worth'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: projection.map(d => d.year),
        datasets,
      },
      options: getBaseOptions(),
      plugins: [payoffPlugin],
    });
  }

  // ── Chart 8: Sequence of Returns Risk ──────────────────────────────────────
  function renderSequenceRisk(data) {
    destroyIfExists('seq-risk');
    const ctx = document.getElementById('chart-seq-risk');
    if (!ctx) return;

    const { labels, base, earlyCrash, lateCrash, lateCrashAge } = data;

    // Plugin: vertical crash markers
    const crashPlugin = {
      id: 'crashMarkers',
      afterDraw(chart) {
        const { ctx: c, chartArea, scales } = chart;
        const xScale = scales.x;
        const chartLabels = chart.data.labels;
        // Early crash marker (age retirementAge + 1)
        const earlyIdx = 1;
        // Late crash marker
        const lateIdx = labels.indexOf(lateCrashAge);

        [[earlyIdx, COLORS.red, 'Early crash'], [lateIdx, COLORS.amber, 'Late crash']].forEach(([idx, color, label]) => {
          if (idx < 0 || idx >= chartLabels.length) return;
          const x = xScale.getPixelForValue(idx);
          if (!isFinite(x)) return;
          c.save();
          c.strokeStyle = color + '66';
          c.lineWidth = 1;
          c.setLineDash([3, 3]);
          c.beginPath();
          c.moveTo(x, chartArea.top);
          c.lineTo(x, chartArea.bottom);
          c.stroke();
          c.setLineDash([]);
          c.fillStyle = color + 'cc';
          c.font = '9px sans-serif';
          c.textAlign = 'center';
          c.fillText(label, x, chartArea.top + 12);
          c.restore();
        });
      }
    };

    const bo = getBaseOptions();
    instances['seq-risk'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Base Case (no crash)',
            data: base,
            borderColor: COLORS.blue,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
          },
          {
            label: 'Early Crash (age ' + (labels[1] ?? '') + ')',
            data: earlyCrash,
            borderColor: COLORS.red,
            borderDash: [5, 4],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
          },
          {
            label: 'Late Crash (age ' + lateCrashAge + ')',
            data: lateCrash,
            borderColor: COLORS.amber,
            borderDash: [5, 4],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
          },
        ]
      },
      options: {
        ...bo,
        scales: {
          ...bo.scales,
          x: { ...bo.scales.x, title: { display: true, text: 'Age', color: bo.scales.x.ticks.color, font: { size: 11 } } },
        }
      },
      plugins: [crashPlugin],
    });
  }

  // ── Chart 9: RRSP vs. Taxable ──────────────────────────────────────────────
  function renderRrsp(rrspData) {
    destroyIfExists('rrsp');
    const ctx = document.getElementById('chart-rrsp');
    if (!ctx) return;

    const { years, rrspByYear, taxableByYear } = rrspData;
    const bo = getBaseOptions();
    instances['rrsp'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'RRSP (incl. refund reinvested)',
            data: rrspByYear,
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blueLight,
            fill: true,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
          },
          {
            label: 'Taxable Account',
            data: taxableByYear,
            borderColor: COLORS.amber,
            borderDash: [5, 4],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
          },
        ]
      },
      options: {
        ...bo,
        scales: {
          ...bo.scales,
          x: { ...bo.scales.x, title: { display: true, text: 'Years from now', color: bo.scales.x.ticks.color, font: { size: 11 } } },
        }
      },
    });
  }

  function _showNoData(canvas) {
    canvas.parentElement.innerHTML = '<p style="color:#8fa3b3;text-align:center;padding:40px">No historical data available yet.</p>';
  }

  return {
    renderPortfolioValue,
    renderContributions,
    renderRunway,
    renderMonteCarlo,
    renderIncomeSources,
    renderWithdrawalRate,
    renderNetWorth,
    renderSequenceRisk,
    renderRrsp,
    fmt,
  };
})();
