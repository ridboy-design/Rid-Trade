DEFAULT_PARAMS = {"session_hour": 13, "sl_mult": 0.5, "tp_mult": 2.0}
PARAM_GRID = {"sl_mult": [0.3, 0.5, 0.75], "tp_mult": [1.5, 2.0, 2.5]}

def run_strategy(df, params):
    session_hour = int(params.get("session_hour", 13))
    sl_mult = float(params.get("sl_mult", 0.5))
    tp_mult = float(params.get("tp_mult", 2.0))

    df = df.copy()
    df["date"] = df["timestamp"].dt.date
    df["hour"] = df["timestamp"].dt.hour

    ranges = (df[df["hour"] == session_hour]
              .groupby("date").agg(range_high=("high", "max"), range_low=("low", "min"))
              .reset_index())

    trades = []
    for _, row in ranges.iterrows():
        day = row["date"]
        rng_high, rng_low = row["range_high"], row["range_low"]
        rng_size = rng_high - rng_low
        if rng_size <= 0:
            continue
        day_bars = df[(df["date"] == day) & (df["hour"] > session_hour) & (df["hour"] <= session_hour + 2)]
        direction, entry_price, entry_idx = None, None, None
        for idx, bar in day_bars.iterrows():
            if bar["close"] > rng_high:
                direction, entry_price, entry_idx = "long", bar["close"], idx
                break
            elif bar["close"] < rng_low:
                direction, entry_price, entry_idx = "short", bar["close"], idx
                break
        if direction is None:
            continue
        if direction == "long":
            sl, tp = entry_price - sl_mult * rng_size, entry_price + tp_mult * rng_size
        else:
            sl, tp = entry_price + sl_mult * rng_size, entry_price - tp_mult * rng_size
        future = df[(df.index > entry_idx) & (df["date"] == day)]
        r = None
        for _, bar in future.iterrows():
            hit_sl = (bar["low"] <= sl) if direction == "long" else (bar["high"] >= sl)
            hit_tp = (bar["high"] >= tp) if direction == "long" else (bar["low"] <= tp)
            if hit_sl:
                r = -1.0
                break
            if hit_tp:
                r = tp_mult / sl_mult
                break
        if r is not None:
            trades.append({"date": day, "direction": direction, "r_multiple": r})
    return trades