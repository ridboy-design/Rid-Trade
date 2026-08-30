import itertools
import engine

class StrategyError(Exception):
    pass

def load_strategy(code_str):
    ns = {}
    try:
        exec(code_str, ns)
    except Exception as e:
        raise StrategyError(f"Code failed to execute: {e}")
    if "run_strategy" not in ns or not callable(ns["run_strategy"]):
        raise StrategyError("Code must define: run_strategy(df, params)")
    return ns

def parse_params(text):
    params = {}
    text = (text or "").strip()
    if not text:
        return params
    for part in text.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k, v = k.strip(), v.strip()
        try:
            v = float(v)
        except ValueError:
            pass
        params[k] = v
    return params

def parse_grid(text):
    grid = {}
    text = (text or "").strip()
    if not text:
        return grid
    for chunk in text.split(";"):
        if "=" not in chunk:
            continue
        k, vlist = chunk.split("=", 1)
        k = k.strip()
        vals = []
        for v in vlist.split(","):
            v = v.strip()
            try:
                vals.append(float(v))
            except ValueError:
                vals.append(v)
        grid[k] = vals
    return grid

def run_single(df, code_str, params_override=None):
    ns = load_strategy(code_str)
    params = dict(ns.get("DEFAULT_PARAMS", {}))
    params.update(params_override or {})
    trades = ns["run_strategy"](df, params)
    return {"params": params, "metrics": engine.compute_metrics(trades)}

def run_optimize(df, code_str, grid_override=None, min_trades=15):
    ns = load_strategy(code_str)
    grid = dict(ns.get("PARAM_GRID", {}))
    grid.update(grid_override or {})
    if not grid:
        raise StrategyError("No PARAM_GRID in code and no grid override given.")
    keys = list(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))
    results = []
    for combo in combos:
        params = dict(zip(keys, combo))
        try:
            trades = ns["run_strategy"](df, params)
        except Exception:
            continue
        m = engine.compute_metrics(trades)
        if m["num_trades"] >= min_trades:
            results.append({"params": params, **m})
    pf_key = lambda r: (r["profit_factor"] if r["profit_factor"] != float("inf") else 9999)
    results.sort(key=pf_key, reverse=True)
    return results

def run_walkforward(df, code_str, params_override=None, split_frac=0.6):
    ns = load_strategy(code_str)
    params = dict(ns.get("DEFAULT_PARAMS", {}))
    params.update(params_override or {})
    explore, holdout, cut = engine.walk_forward_split(df, split_frac)
    ex_trades = ns["run_strategy"](explore, params)
    ho_trades = ns["run_strategy"](holdout, params)
    return {"params": params, "split_date": str(cut),
            "explore": engine.compute_metrics(ex_trades),
            "holdout": engine.compute_metrics(ho_trades)}