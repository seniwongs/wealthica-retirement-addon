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
            callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v)
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

  function destroyIfExists(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  // ── Chart 1: Portfolio Value Over Time ─────────────────────────────────────
  function renderPortfolioValue(historicalData, projection, targetAmount, retirementYear) {
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
            pointRadius: 3,
            pointHoverRadius: 6,
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
            pointRadius: 3,
            pointHoverRadius: 6,
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
            pointRadius: 3,
            pointHoverRadius: 6,
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
      _showNoData(ctx, 'contributions'); return;
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
      options: (() => { const bo = getBaseOptions(); return { ...bo, scales: { ...bo.scales, x: { ...bo.scales.x, stacked: true }, y: { ...bo.scales.y, stacked: true } } }; })()
    });
  }

  // ── Chart 3: Retirement Runway ──────────────────────────────────────────────
  function renderRunway(projection, retirementYear) {
    destroyIfExists('runway');
    const ctx = document.getElementById('chart-runway');
    if (!ctx) return;

    const retirementData = projection.filter(d => d.year >= retirementYear);
    const depletionYear = retirementData.find(d => d.value === 0);

    instances['runway'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: retirementData.map(d => d.year),
        datasets: [{
          label: 'Portfolio Balance',
          data: retirementData.map(d => d.value),
          borderColor: COLORS.blue,
          backgroundColor: ctx => {
            const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
            gradient.addColorStop(1, 'rgba(59,130,246,0.0)');
            return gradient;
          },
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2.5,
        }]
      },
      options: (() => { const bo = getBaseOptions(); return { ...bo,
          interaction: { mode: 'index', intersect: false },
          plugins: { ...bo.plugins,
            annotation: depletionYear ? {
              annotations: {
                depletion: {
                  type: 'line',
                  xMin: depletionYear.year,
                  xMax: depletionYear.year,
                  borderColor: COLORS.red,
                  borderWidth: 2,
                  label: { content: 'Depletion', enabled: true, color: COLORS.red }
                }
              }
            } : {}
          } }; })()
    });
  }

  // ── Chart 4: Monte Carlo ────────────────────────────────────────────────────
  function renderMonteCarlo(mcResult) {
    destroyIfExists('monte-carlo');
    const ctx = document.getElementById('chart-monte-carlo');
    if (!ctx) return;

    const { percentiles, successRate, years } = mcResult;
    const labels = years;

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
        labels,
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
      options: (() => { const bo = getBaseOptions(); return { ...bo, scales: { ...bo.scales, x: { ...bo.scales.x, stacked: true }, y: { ...bo.scales.y, stacked: true } } }; })()
    });
  }

  // ── Chart 6: Withdrawal Rate ────────────────────────────────────────────────
  function renderWithdrawalRate(withdrawalRates) {
    destroyIfExists('withdrawal-rate');
    const ctx = document.getElementById('chart-withdrawal-rate');
    if (!ctx) return;

    const safeLine = withdrawalRates.map(() => 4); // 4% benchmark

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
            label: '4% Safe Withdrawal Rate',
            data: safeLine,
            type: 'line',
            borderColor: COLORS.gray,
            borderDash: [6, 3],
            borderWidth: 1.5,
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
  function renderNetWorth(projection, totalLiabilities) {
    destroyIfExists('net-worth');
    const ctx = document.getElementById('chart-net-worth');
    if (!ctx) return;

    // Liabilities assumed fixed for simplicity (mortgage pays down at 2%/yr)
    const liabData = projection.map((d, i) => {
      const paydownRate = 0.02;
      return Math.max(0, Math.round(totalLiabilities * Math.pow(1 - paydownRate, i)));
    });

    const netWorthData = projection.map((d, i) => Math.max(0, d.value - liabData[i]));

    instances['net-worth'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: projection.map(d => d.year),
        datasets: [
          {
            label: 'Investment Portfolio',
            data: projection.map(d => d.value),
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blueLight,
            fill: true,
            tension: 0.3, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2,
          },
          {
            label: 'Liabilities',
            data: liabData,
            borderColor: COLORS.red,
            backgroundColor: COLORS.redLight,
            fill: true,
            tension: 0.3, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2,
          },
          {
            label: 'Net Worth',
            data: netWorthData,
            borderColor: COLORS.green,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5,
          }
        ]
      },
      options: getBaseOptions()
    });
  }

  function _showNoData(canvas, id) {
    const parent = canvas.parentElement;
    parent.innerHTML = '<p style="color:#8fa3b3;text-align:center;padding:40px">No historical data available yet.</p>';
  }

  return {
    renderPortfolioValue,
    renderContributions,
    renderRunway,
    renderMonteCarlo,
    renderIncomeSources,
    renderWithdrawalRate,
    renderNetWorth,
    fmt,
  };
})();
