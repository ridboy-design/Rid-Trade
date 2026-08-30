// engine.js -- CSV parsing, ORB backtest primitives, metrics, walk-forward split, dollar account simulation.
// Expected CSV columns: timestamp, open, high, low, close (UTC).

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const idx = {
    timestamp: header.indexOf("timestamp"),
    open: header.indexOf("open"),
    high: header.indexOf("high"),
    low: header.indexOf("low"),
    close: header.indexOf("close"),
  };
  for (const k in idx) {
    if (idx[k] === -1) throw new Error("Missing required column: " + k);
  }
  const spreadIdx = header.indexOf("spread");

  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const parts = lines[i].split(",");
    let tsRaw = parts[idx.timestamp].trim();
    if (!/Z$/.test(tsRaw) && !/[+-]\d\d:\d\d$/.test(tsRaw)) tsRaw += "Z";
    const ts = new Date(tsRaw);
    const bar = {
      timestamp: ts,
      date: ts.toISOString().slice(0, 10),
      hour: ts.getUTCHours(),
      open: parseFloat(parts[idx.open]),
      high: parseFloat(parts[idx.high]),
      low: parseFloat(parts[idx.low]),
      close: parseFloat(parts[idx.close]),
    };
    if (spreadIdx !== -1) bar.spread = parseFloat(parts[spreadIdx]);
    bars.push(bar);
  }
  bars.sort((a, b) => a.timestamp - b.timestamp);
  return bars;
}

function computeMetrics(trades) {
  if (!trades || trades.length === 0) {
    return { num_trades: 0, win_rate: 0, profit_factor: 0, expectancy_r: 0, max_drawdown_r: 0, calmar: 0 };
  }
  const r = trades.map(t => t.r_multiple);
  const wins = r.filter(x => x > 0);
  const losses = r.filter(x => x <= 0);
  const winRate = (wins.length / r.length) * 100;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;
  const expectancy = r.reduce((a, b) => a + b, 0) / r.length;

  let equity = 0, runningMax = -Infinity, maxDD = 0;
  const equityCurve = [];
  for (const x of r) {
    equity += x;
    runningMax = Math.max(runningMax, equity);
    maxDD = Math.max(maxDD, runningMax - equity);
    equityCurve.push(equity);
  }
  const totalReturn = equityCurve[equityCurve.length - 1];
  const calmar = maxDD > 0 ? totalReturn / maxDD : Infinity;

  return {
    num_trades: r.length,
    win_rate: Math.round(winRate * 100) / 100,
    profit_factor: profitFactor === Infinity ? "inf" : Math.round(profitFactor * 1000) / 1000,
    expectancy_r: Math.round(expectancy * 1000) / 1000,
    max_drawdown_r: Math.round(maxDD * 1000) / 1000,
    calmar: calmar === Infinity ? "inf" : Math.round(calmar * 1000) / 1000,
  };
}

// Simulates a real account: compounding balance, risk% per trade, flat spread/commission
// cost per round-turn trade. Costs are NOT R-scaled -- they're subtracted in $ terms after
// the risk-based P&L is computed, which is how real spread/commission actually erodes an account.
//
// opts:
//   startingBalance  - $ starting balance (default 1000)
//   riskPercent      - % of current balance risked per trade, compounding (default 1)
//   spreadCost       - $ cost per round-turn trade (default 0)
//   commissionCost   - $ cost per round-turn trade (default 0)
function computeDollarMetrics(trades, opts) {
  opts = opts || {};
  const startingBalance = opts.startingBalance != null ? opts.startingBalance : 1000;
  const riskPercent = opts.riskPercent != null ? opts.riskPercent : 1;
  const riskFrac = riskPercent / 100;
  const spreadCost = opts.spreadCost || 0;
  const commissionCost = opts.commissionCost || 0;

  let balance = startingBalance;
  let peak = startingBalance;
  let maxDDPct = 0;
  const equityCurve = [{ trade: 0, date: null, balance: Math.round(balance * 100) / 100 }];

  (trades || []).forEach((t, i) => {
    const riskAmount = balance * riskFrac;
    const grossPnl = riskAmount * t.r_multiple;
    const netPnl = grossPnl - spreadCost - commissionCost;
    balance += netPnl;
    peak = Math.max(peak, balance);
    const ddPct = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    maxDDPct = Math.max(maxDDPct, ddPct);
    equityCurve.push({ trade: i + 1, date: t.date, balance: Math.round(balance * 100) / 100 });
  });

  const totalReturnPct = ((balance - startingBalance) / startingBalance) * 100;

  return {
    starting_balance: startingBalance,
    ending_balance: Math.round(balance * 100) / 100,
    total_return_pct: Math.round(totalReturnPct * 100) / 100,
    max_drawdown_pct: Math.round(maxDDPct * 100) / 100,
    risk_percent: riskPercent,
    spread_cost_per_trade: spreadCost,
    commission_cost_per_trade: commissionCost,
    equity_curve: equityCurve,
  };
}

function walkForwardSplit(bars, splitFrac) {
  splitFrac = splitFrac || 0.6;
  const dates = [...new Set(bars.map(b => b.date))].sort();
  const cutDate = dates[Math.floor(dates.length * splitFrac)];
  const explore = bars.filter(b => b.date < cutDate);
  const holdout = bars.filter(b => b.date >= cutDate);
  return { explore, holdout, cutDate };
}

if (typeof module !== "undefined") {
  module.exports = { parseCSV, computeMetrics, computeDollarMetrics, walkForwardSplit };
}
