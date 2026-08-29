// engine.js -- CSV parsing, ORB backtest primitives, metrics, walk-forward split.
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
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const parts = lines[i].split(",");
    let tsRaw = parts[idx.timestamp].trim();
    if (!/Z$/.test(tsRaw) && !/[+-]\d\d:\d\d$/.test(tsRaw)) tsRaw += "Z";
    const ts = new Date(tsRaw);
    bars.push({
      timestamp: ts,
      date: ts.toISOString().slice(0, 10),
      hour: ts.getUTCHours(),
      open: parseFloat(parts[idx.open]),
      high: parseFloat(parts[idx.high]),
      low: parseFloat(parts[idx.low]),
      close: parseFloat(parts[idx.close]),
    });
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

function walkForwardSplit(bars, splitFrac) {
  splitFrac = splitFrac || 0.6;
  const dates = [...new Set(bars.map(b => b.date))].sort();
  const cutDate = dates[Math.floor(dates.length * splitFrac)];
  const explore = bars.filter(b => b.date < cutDate);
  const holdout = bars.filter(b => b.date >= cutDate);
  return { explore, holdout, cutDate };
}

if (typeof module !== "undefined") {
  module.exports = { parseCSV, computeMetrics, walkForwardSplit };
}