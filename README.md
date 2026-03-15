# Retirement Planner — Wealthica Addon

A full retirement projection engine with 7 interactive chart panels built as a [Wealthica](https://www.wealthica.com) Power-Up addon.

## What It Does

Connect your Wealthica portfolio and instantly see whether you're on track for retirement. Set your target retirement age, nest egg goal, expected return, CPP/OAS income, and monthly expenses — then explore your runway with Monte Carlo simulation, income breakdown, safe withdrawal rate tracking, and net worth projection. Designed specifically for Canadian investors.

## Features

- **7 interactive charts** — Portfolio Value Over Time, Contributions vs. Returns, Retirement Runway, Monte Carlo Simulation, Income Sources, Withdrawal Rate vs. 4% Rule, Net Worth Over Time
- **Monte Carlo simulation** — 500 runs with p10/p50/p90 percentile bands and animated success-rate ring
- **Retirement Runway** — green/red fill showing surplus/deficit vs. safe withdrawal level; sensitivity toggles for return rate and inflation
- **Income Sources breakdown** — portfolio withdrawals, CPP, OAS, and extra income stacked by year
- **8 key stat cards** — current portfolio, total contributed, avg monthly savings, investment gains, projected value at retirement, FIRE number, monthly savings needed, and projected remaining estate
- **Canadian CPP/OAS reference** — built-in rates and age-65 activation logic
- **Inflation toggle** — show all projections in real (inflation-adjusted) or nominal dollars
- **Dark / light theme** — persisted across sessions
- **Institution filter aware** — respects Wealthica's institution and group filters

## Controls

| Control | Range | Description |
|---|---|---|
| Current Age | 20–70 | Your age today |
| Retire Age | 50–75 | Target retirement age |
| Target Nest Egg | $250k–$5M | Portfolio goal at retirement |
| Expected Return | 1–12 %/yr | Assumed annual growth rate |
| Extra Monthly Income | $0–$20k | CPP/OAS/pension/part-time |
| Monthly Expenses | $500–$15k | Post-retirement spending |
| Life Expectancy | 75–100 | Projection end year |
| CPP Amount | $0–$1,300/mo | Your estimated CPP benefit |
| OAS Amount | $0–$800/mo | Your estimated OAS benefit |

## Live Demo

**[https://seniwongs.github.io/wealthica-retirement-addon/](https://seniwongs.github.io/wealthica-retirement-addon/)**

Loads in standalone demo mode with a sample Canadian portfolio when opened outside of Wealthica.

## Loading in Wealthica

1. Go to your Wealthica dashboard → **Power-Ups** → **Developer Add-on**
2. Configure the URL to: `https://seniwongs.github.io/wealthica-retirement-addon/`
3. The addon will load with your real portfolio data

## Tech Stack

- Vanilla JS, HTML, CSS — no framework, no build step
- [Chart.js 4.4.0](https://www.chartjs.org/) for all chart rendering
- [@wealthica/wealthica.js](https://github.com/wealthica/wealthica.js) SDK for portfolio data access

## License

MIT
