// strategy_runner.js -- loads pasted strategy code, runs Single/Optimize/Walk-Forward.

function loadStrategy(code) {
  const mod = {};
  const wrapper = `
    ${code}
    module.runStrategy = (typeof runStrategy !== "undefined") ? runStrategy : null;
    module.DEFAULT_PARAMS = (typeof DEFAULT_PARAMS !== "undefined") ? DEFAULT_PARAMS : {};
    module.PARAM_GRID = (typeof PARAM_GRID !== "undefined") ? PARAM_GRID : {};
  `;
  try {
    const fn = new Function("module", wrapper);
    fn(mod);
  } catch (e) {
    throw new Error("Code failed to execute: " + e.message);
  }
  if (typeof mod.runStrategy !== "function") {
    throw new Error("Code must define: function runStrategy(bars, params)");
  }
  return mod;
}

function parseParams(text) {
  const params = {};
  (text || "").trim().split(",").forEach(part => {
    if (!part.includes("=")) return;
    const [k, v] = part.split("=");
    const key = k.trim(), val = v.trim();
    const num = parseFloat(val);
    params[key] = isNaN(num) ? val : num;
  });
  return params;
}

function parseGrid(text) {
  const grid = {};
  (text || "").trim().split(";").forEach(chunk => {
    if (!chunk.includes("=")) return;
    const [k, vlist] = chunk.split("=");
    const key = k.trim();
    grid[key] = vlist.split(",").map(v => {
      const num = parseFloat(v.trim());
      return isNaN(num) ? v.trim() : num;
    });
  });
  return grid;
}

function cartesianProduct(grid) {
  const keys = Object.keys(grid);
  let combos = [{}];
  for (const key of keys) {
    const next = [];
    for (const combo of combos) {
      for (const val of grid[key]) {
        next.push({ ...combo, [key]: val });
      }
    }
    combos = next;
  }
  return combos;
}

function runSingle(bars, code, paramsOverride) {
  const mod = loadStrategy(code);
  const params = { ...mod.DEFAULT_PARAMS, ...(paramsOverride || {}) };
  const trades = mod.runStrategy(bars, params);
  return { params, metrics: computeMetrics(trades), numTrades: trades.length, trades };
}

function runOptimize(bars, code, gridOverride, minTrades) {
  minTrades = minTrades || 15;
  const mod = loadStrategy(code);
  const grid = { ...mod.PARAM_GRID, ...(gridOverride || {}) };
  if (Object.keys(grid).length === 0) throw new Error("No PARAM_GRID in code and no grid override given.");
  const combos = cartesianProduct(grid);
  const results = [];
  for (const params of combos) {
    let trades;
    try { trades = mod.runStrategy(bars, params); } catch (e) { continue; }
    const m = computeMetrics(trades);
    if (m.num_trades >= minTrades) results.push({ params, ...m });
  }
  results.sort((a, b) => {
    const pfA = a.profit_factor === "inf" ? 9999 : a.profit_factor;
    const pfB = b.profit_factor === "inf" ? 9999 : b.profit_factor;
    return pfB - pfA;
  });
  return results;
}

function runWalkForward(bars, code, paramsOverride, splitFrac) {
  const mod = loadStrategy(code);
  const params = { ...mod.DEFAULT_PARAMS, ...(paramsOverride || {}) };
  const { explore, holdout, cutDate } = walkForwardSplit(bars, splitFrac);
  const exploreTrades = mod.runStrategy(explore, params);
  const holdoutTrades = mod.runStrategy(holdout, params);
  return {
    params,
    cutDate,
    explore: computeMetrics(exploreTrades),
    holdout: computeMetrics(holdoutTrades),
    exploreTrades,
    holdoutTrades,
  };
}

const DEFAULT_TEMPLATE = `// Paste/edit your strategy here. Must define runStrategy(bars, params).
// bars: array of {timestamp, date, hour, open, high, low, close} sorted ascending, UTC.
// Return: [{ date, direction: "long"/"short", r_multiple: number }, ...]

const DEFAULT_PARAMS = { session_hour: 13, sl_mult: 0.5, tp_mult: 2.0 };
const PARAM_GRID = { sl_mult: [0.3, 0.5, 0.75], tp_mult: [1.5, 2.0, 2.5] };

function runStrategy(bars, params) {
  const sessionHour = Math.round(params.session_hour !== undefined ? params.session_hour : 13);
  const slMult = params.sl_mult !== undefined ? params.sl_mult : 0.5;
  const tpMult = params.tp_mult !== undefined ? params.tp_mult : 2.0;

  const ranges = {};
  for (const b of bars) {
    if (b.hour === sessionHour) {
      if (!ranges[b.date]) ranges[b.date] = { high: b.high, low: b.low };
      else {
        ranges[b.date].high = Math.max(ranges[b.date].high, b.high);
        ranges[b.date].low = Math.min(ranges[b.date].low, b.low);
      }
    }
  }

  const trades = [];
  for (const date in ranges) {
    const rngHigh = ranges[date].high, rngLow = ranges[date].low;
    const rngSize = rngHigh - rngLow;
    if (rngSize <= 0) continue;

    const dayBars = bars.filter(b => b.date === date && b.hour > sessionHour && b.hour <= sessionHour + 2);
    let direction = null, entryPrice = null, entryPos = -1;
    for (let i = 0; i < dayBars.length; i++) {
      if (dayBars[i].close > rngHigh) { direction = "long"; entryPrice = dayBars[i].close; entryPos = i; break; }
      if (dayBars[i].close < rngLow) { direction = "short"; entryPrice = dayBars[i].close; entryPos = i; break; }
    }
    if (!direction) continue;

    let sl, tp;
    if (direction === "long") { sl = entryPrice - slMult * rngSize; tp = entryPrice + tpMult * rngSize; }
    else { sl = entryPrice + slMult * rngSize; tp = entryPrice - tpMult * rngSize; }

    const future = bars.filter(b => b.date === date && b.hour > sessionHour + 2 - 1).slice(entryPos + 1);
    let r = null;
    for (const b of future) {
      const hitSL = direction === "long" ? b.low <= sl : b.high >= sl;
      const hitTP = direction === "long" ? b.high >= tp : b.low <= tp;
      if (hitSL) { r = -1.0; break; }
      if (hitTP) { r = tpMult / slMult; break; }
    }
    if (r !== null) trades.push({ date, direction, r_multiple: r });
  }
  return trades;
}
`;
