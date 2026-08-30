import os, sys
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import engine
import strategy_runner as sr

def main():
    data_file = os.environ.get("DATA_FILE", "data/gold_data.csv")
    strategy_file = os.environ.get("STRATEGY_FILE", "strategies/orb_default.py")
    mode = os.environ.get("MODE", "Single")
    params_text = os.environ.get("PARAMS", "")
    ntfy_topic = os.environ.get("NTFY_TOPIC", "")

    df = engine.load_data(data_file)
    with open(strategy_file) as f:
        code = f.read()

    if mode == "Single":
        params = sr.parse_params(params_text)
        result = sr.run_single(df, code, params)
        title = f"{strategy_file} - Single run done"
        body = f"params {result['params']}\n" + "\n".join(f"{k}: {v}" for k, v in result["metrics"].items())

    elif mode == "Optimize":
        grid = sr.parse_grid(params_text)
        results = sr.run_optimize(df, code, grid or None)
        title = f"{strategy_file} - Optimize done"
        if not results:
            body = "No configs met minimum trade count."
        else:
            top = results[0]
            body = (f"Best: {top['params']} -> PF {top['profit_factor']}, "
                    f"trades {top['num_trades']}, exp {top['expectancy_r']}R "
                    f"({len(results)} configs tested)")

    elif mode == "Walk-Forward":
        params = sr.parse_params(params_text)
        result = sr.run_walkforward(df, code, params)
        title = f"{strategy_file} - Walk-Forward done"
        body = (f"params {result['params']}\n"
                f"explore PF {result['explore']['profit_factor']} | holdout PF {result['holdout']['profit_factor']}\n"
                f"explore exp {result['explore']['expectancy_r']}R | holdout exp {result['holdout']['expectancy_r']}R")
    else:
        raise ValueError("Unknown mode: " + mode)

    print(title)
    print(body)
    if ntfy_topic:
        requests.post(ntfy_topic, data=body.encode("utf-8"), headers={"Title": title})

if __name__ == "__main__":
    main()