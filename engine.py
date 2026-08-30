import pandas as pd
import numpy as np

def load_data(path):
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    required = ["timestamp", "open", "high", "low", "close"]
    missing = [c for c in required if c not in cols]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df = df.rename(columns={cols[c]: c for c in required})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").reset_index(drop=True)
    return df[["timestamp", "open", "high", "low", "close"]]

def compute_metrics(trades):
    if not trades:
        return {"num_trades": 0, "win_rate": 0.0, "profit_factor": 0.0,
                "expectancy_r": 0.0, "max_drawdown_r": 0.0, "calmar": 0.0,
                "avg_win_r": 0.0, "avg_loss_r": 0.0}
    r = np.array([t["r_multiple"] for t in trades], dtype=float)
    wins = r[r > 0]
    losses = r[r <= 0]
    win_rate = len(wins) / len(r)
    gross_win = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf")
    expectancy = r.mean()
    equity = np.cumsum(r)
    running_max = np.maximum.accumulate(equity)
    drawdown = running_max - equity
    max_dd = drawdown.max() if len(drawdown) else 0.0
    total_return = equity[-1] if len(equity) else 0.0
    calmar = (total_return / max_dd) if max_dd > 0 else float("inf")
    return {
        "num_trades": len(r),
        "win_rate": round(win_rate * 100, 2),
        "profit_factor": round(profit_factor, 3) if profit_factor != float("inf") else profit_factor,
        "expectancy_r": round(expectancy, 3),
        "max_drawdown_r": round(max_dd, 3),
        "calmar": round(calmar, 3) if calmar != float("inf") else calmar,
        "avg_win_r": round(wins.mean(), 3) if len(wins) else 0.0,
        "avg_loss_r": round(losses.mean(), 3) if len(losses) else 0.0,
    }

def equity_curve(trades):
    """Cumulative R after each trade, in order."""
    r = [t["r_multiple"] for t in trades]
    curve = []
    total = 0.0
    for x in r:
        total += x
        curve.append(total)
    return curve

def walk_forward_split(df, split_frac=0.6):
    dates = sorted(df["timestamp"].dt.date.unique())
    cut = dates[int(len(dates) * split_frac)]
    explore = df[df["timestamp"].dt.date < cut]
    holdout = df[df["timestamp"].dt.date >= cut]
    return explore, holdout, cut