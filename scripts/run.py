import os, sys
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import engine
import strategy_runner as sr

def strategy_name(path):
    return os.path.splitext(os.path.basename(path))[0]

def send_text(topic, title, body):
    if topic:
        requests.post(topic, data=body.encode("utf-8"), headers={"Title": title})

def send_equity_image(topic, title, trades, label):
    if not topic or not trades:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    curve = engine.equity_curve(trades)
    plt.figure(figsize=(6, 3))
    plt.plot(curve, linewidth=1.5)
    plt.axhline(0, color="gray", linewidth=0.5)
    plt.title(f"{title} - {label}")
    plt.xlabel("trade #")
    plt.ylabel("cumulative R")
    plt.tight_layout()
    path = f"/tmp/equity_{label.replace(' ', '_')}.png"
    plt.savefig(path)
    plt.close()

    with open(path, "rb") as f:
        requests.put(topic, data=f, headers={
            "Filename": os.path.basename(path),
            "Title": f"{title} - {label} equity curve",
        })

def get_dollar_opts():
    return {
        "starting_balance": float(os.environ.get("STARTING_BALANCE", "1000")),
        "risk_percent": float(os.environ.get("RISK_PERCENT", "1")),
        "spread_cost": float(os.environ.get("SPREAD_COST", "0")),
        "commission_cost": float(os.environ.get("COMMISSION_COST", "0")),
    }

def dollar_body(dollar):
    return (f"balance: ${dollar['starting_balance']:.2f} -> ${dollar['ending_balance']:.2f} "
            f"({dollar['total_return_pct']}%)  max DD: {dollar['max_drawdown_pct']}%  "
            f"risk/trade: {dollar['risk_percent']}%  "
            f"spread+comm/trade: ${dollar['spread_cost_per_trade']}+${dollar['commission_cost_per_trade']}")

def main():
    data_file = os.environ.get("DATA_FILE", "gold_data.csv")
    strategy_file = os.environ.get("STRATEGY_FILE", "strategies/orb_default.py")
    mode = os.environ.get("MODE", "Single")
    params_text = os.environ.get("PARAMS", "")
    ntfy_topic = os.environ.get("NTFY_TOPIC", "")
    name = strategy_name(strategy_file)
    dollar_opts = get_dollar_opts()

    df = engine.load_data(data_file)
    with open(strategy_file) as f:
        code = f.read()

    if mode == "Single":
        params = sr.parse_params(params_text)
        ns = sr.load_strategy(code)
        p = dict(ns.get("DEFAULT_PARAMS", {})); p.update(params)
        trades = ns["run_strategy"](df, p)
        m = engine.compute_metrics(trades)
        dollar = engine.compute_dollar_metrics(trades, **dollar_opts)
        title = f"{name} - Single run"
        body = (f"params {p}\n"
                f"trades: {m['num_trades']}  win rate: {m['win_rate']}%\n"
                f"PF: {m['profit_factor']}  expectancy: {m['expectancy_r']}R\n"
                f"avg win: {m['avg_win_r']}R  avg loss: {m['avg_loss_r']}R\n"
                f"max DD: {m['max_drawdown_r']}R  calmar: {m['calmar']}\n"
                f"{dollar_body(dollar)}")
        send_text(ntfy_topic, title, body)
        send_equity_image(ntfy_topic, name, trades, "single")

    elif mode == "Optimize":
        grid = sr.parse_grid(params_text)
        results = sr.run_optimize(df, code, grid or None)
        title = f"{name} - Optimize"
        if not results:
            body = "No configs met minimum trade count."
        else:
            top = results[0]
            body = (f"Best: {top['params']}\n"
                    f"PF {top['profit_factor']}  trades {top['num_trades']}  "
                    f"exp {top['expectancy_r']}R\n"
                    f"avg win {top.get('avg_win_r')}R  avg loss {top.get('avg_loss_r')}R\n"
                    f"({len(results)} configs tested)\n"
                    f"(re-run Single mode with these params to see $ account simulation)")
        send_text(ntfy_topic, title, body)

    elif mode == "Walk-Forward":
        params = sr.parse_params(params_text)
        ns = sr.load_strategy(code)
        p = dict(ns.get("DEFAULT_PARAMS", {})); p.update(params)
        explore, holdout, cut = engine.walk_forward_split(df, 0.6)
        ex_trades = ns["run_strategy"](explore, p)
        ho_trades = ns["run_strategy"](holdout, p)
        ex_m, ho_m = engine.compute_metrics(ex_trades), engine.compute_metrics(ho_trades)
        ex_dollar = engine.compute_dollar_metrics(ex_trades, **dollar_opts)
        ho_dollar = engine.compute_dollar_metrics(ho_trades, **dollar_opts)
        title = f"{name} - Walk-Forward"
        body = (f"params {p}  split {cut}\n"
                f"EXPLORE  PF {ex_m['profit_factor']}  exp {ex_m['expectancy_r']}R  "
                f"avgW {ex_m['avg_win_r']}  avgL {ex_m['avg_loss_r']}\n"
                f"  {dollar_body(ex_dollar)}\n"
                f"HOLDOUT  PF {ho_m['profit_factor']}  exp {ho_m['expectancy_r']}R  "
                f"avgW {ho_m['avg_win_r']}  avgL {ho_m['avg_loss_r']}\n"
                f"  {dollar_body(ho_dollar)}")
        send_text(ntfy_topic, title, body)
        send_equity_image(ntfy_topic, name, ex_trades, "explore")
        send_equity_image(ntfy_topic, name, ho_trades, "holdout")
    else:
        raise ValueError("Unknown mode: " + mode)

    print(title)
    print(body)

if __name__ == "__main__":
    main()
