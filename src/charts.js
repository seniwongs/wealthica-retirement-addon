/**
 * charts.js
 * Chart.js renderers for all 7 retirement charts.
 * Each function creates or updates its chart instance.
 */

const Charts = (() => {
  const instances = {};

  const COLORS = {
    blue:       '#3b82f6',
    blueLight:  'rgba(59,130,246,0.15)',
    green:      '#10b981',
    greenLight: 'rgba(16,185,129,0.15)',
    red:        '#ef4444',
    redLight:   'rgba(239,68,68,0.15)',
    amber:      '#f59e0b',
    purple:     '#8b5cf6',
    teal:       '#14b8a6',
    gray:       '#6b7a8d',
    grayLight:  'rgba(107,122,141,0.1)',
  };

  const BASE_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { size: 11 }, color: '#6b7a8d', boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y ?? ctx.parsed;
            if (typeof v === 'number') {
              return ` ${ctx.dataset.label}: ${fmt(v)}`;
            }
            return ` ${ctx.dataset.label}: ${v}`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: '#8fa3b3', font: { size: 10 } }, grid: { color: '#e9edf3' } },
      y: {
        ticks: {
          color: '#8fa3b3',
          font: { size: 10 },
          callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v)
        },
        grid: { color: '#e9edf3' }
      }
    }
  };

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
  function renderPortfolioValue(historicalData, projection) {
    destroyIfExists('portfolio-value');
    const ctx = document.getElementById('chart-portfolio-value');
    if (!ctx) return;

    const histLabels = historicalData.map(d => d.year);
    const histValues = historicalData.map(d => d.portfolioValue);

    const projStart = historicalData.length > 0
      ? historicalData[historicalData.length - 1].year
      : (projection[0]?.year ?? new Date().getFullYear());

    const projData = projection.map(d => d.value);
    const projLabels = projection.map(d => d.year);
    const splitIdx = projection.findIndex(d => d.phase === 'retirement');

    const accData = projection.slice(0, splitIdx === -1 ? projection.length : splitIdx + 1).map(d => d.value);
    const retData = new Array(splitIdx === -1 ? 0 : splitIdx).fill(null)
      .concat(projection.slice(splitIdx === -1 ? projection.length : splitIdx).map(d => d.value));

    const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

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
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blueLight,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          },
          {
            label: 'Projected (Accumulation)',
            data: allLabels.map(y => {
              const p = projection.find(d => d.year === y && d.phase === 'accumulation');
              return p ? p.value : null;
            }),
            borderColor: COLORS.green,
            borderDash: [5, 3],
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          },
          {
            label: 'Projected (Retirement)',
            data: allLabels.map(y => {
              const p = projection.find(d => d.year === y && d.phase === 'retirement');
              return p ? p.value : null;
            }),
            borderColor: COLORS.amber,
            borderDash: [5, 3],
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          }
        ]
      },
      options: { ...BASE_OPTIONS }
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
      options: {
        ...BASE_OPTIONS,
        scales: {
          ...BASE_OPTIONS.scales,
          x: { ...BASE_OPTIONS.scales.x, stacked: true },
          y: { ...BASE_OPTIONS.scales.y, stacked: true },
        }
      }
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
          pointRadius: 0,
          borderWidth: 2.5,
        }]
      },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
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
        }
      }
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
      // Update summary in sidebar
      const summaryEl = document.getElementById('summary-success');
      if (summaryEl) {
        summaryEl.textContent = successRate + '%';
        summaryEl.className = 'value ' + cls;
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
      options: { ...BASE_OPTIONS }
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
          }
        ]
      },
      options: {
        ...BASE_OPTIONS,
        scales: {
          ...BASE_OPTIONS.scales,
          x: { ...BASE_OPTIONS.scales.x, stacked: true },
          y: { ...BASE_OPTIONS.scales.y, stacked: true },
        }
      }
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
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${parseFloat(ctx.parsed.y).toFixed(1)}%`
            }
          }
        },
        scales: {
          x: BASE_OPTIONS.scales.x,
          y: {
            ...BASE_OPTIONS.scales.y,
            ticks: {
              ...BASE_OPTIONS.scales.y.ticks,
              callback: v => v + '%'
            },
            title: { display: true, text: 'Withdrawal Rate (%)', color: '#8fa3b3', font: { size: 11 } }
          }
        }
      },
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
            tension: 0.3, pointRadius: 0, borderWidth: 2,
          },
          {
            label: 'Liabilities',
            data: liabData,
            borderColor: COLORS.red,
            backgroundColor: COLORS.redLight,
            fill: true,
            tension: 0.3, pointRadius: 0, borderWidth: 2,
          },
          {
            label: 'Net Worth',
            data: netWorthData,
            borderColor: COLORS.green,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
          }
        ]
      },
      options: { ...BASE_OPTIONS }
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
