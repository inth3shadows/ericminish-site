"""Generate Michigan Fever scene art via OpenRouter. Reads OPENROUTER_API_KEY from env.
Usage: gen-game-art.py RAW_DIR scene_id[,scene_id...]
Prints status lines only. Appends each generation to RAW_DIR/gens.log (the count)."""
import base64, http.client, json, os, sys, urllib.request, urllib.error, pathlib

HERE = pathlib.Path(__file__).parent
MODELS = ["google/gemini-3-pro-image-preview", "google/gemini-2.5-flash-image"]
# What a call is counted at when its reply is lost and the real cost is unknown
# (ART_CALL_ESTIMATE overrides). The 14 logged gemini-3-pro 2K calls cost $0.138 each.
CALL_ESTIMATE = 0.14


def spent(cost_log):
    if not cost_log.exists():
        return 0.0
    return sum(json.loads(l)["cost"] for l in cost_log.read_text().splitlines() if l.strip())


def build_prompt(cfg, sid, env):
    """The style, the scene's prompt, and EXTRA_<nn> (for scene "nn-...") if set: a one-off note for a retry."""
    prompt = cfg["style"] + cfg["scenes"][sid]["prompt"]
    extra = env.get("EXTRA_" + sid.split("-")[0], "").strip()
    return f"{prompt} {extra}" if extra else prompt


def call(model, prompt, size, key):
    ic = {"aspect_ratio": "16:9"}
    if size:
        ic["image_size"] = size
    body = {"model": model, "modalities": ["image", "text"], "image_config": ic,
            "usage": {"include": True},
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=280) as r:
        return json.load(r)


def log_cost(cost_log, sid, model, n, size, cost, image, cost_unknown=False):
    row = {"scene": sid, "model": model, "attempt": n, "size": size, "cost": cost, "image": image}
    if cost_unknown:
        row["cost_unknown"] = True  # counted at the estimate; check the OpenRouter activity page
    with open(cost_log, "a") as f:
        f.write(json.dumps(row) + "\n")


def reply_lost(e):
    """True when the request went out but its reply was cut off, unreadable or
    timed out: the call may be billed. A failure to connect is not."""
    if isinstance(e, urllib.error.URLError) and not isinstance(e, urllib.error.HTTPError):
        e = e.reason
    return isinstance(e, (TimeoutError, http.client.IncompleteRead, http.client.RemoteDisconnected, ValueError))


def generate(sid, raw, cfg, env, key, budget, cost_log, call=call):
    """One scene: try each model and size until one returns an image.
    The budget is checked before every call, and every billed response is logged,
    with or without an image. A reply lost after the request was sent is logged at
    the estimate and stops the run. -> "ok" | "failed" | "budget" | "stopped"."""
    prompt = build_prompt(cfg, sid, env)
    n = len(list(raw.glob(sid + "-a*.*"))) + 1
    for model in MODELS:
        for size in (["2K", None] if "pro" in model else [None]):
            if spent(cost_log) >= budget:
                print(f"{sid}: BUDGET REACHED ({spent(cost_log):.3f}), stopping")
                return "budget"
            try:
                resp = call(model, prompt, size, key)
            except urllib.error.HTTPError as e:
                if e.code == 402:
                    print(f"{sid}: HTTP 402, stopping")
                    sys.exit(2)
                print(f"{sid}: {model} size={size} HTTP {e.code} {e.read()[:200].decode(errors='replace')}")
                continue
            except Exception as e:
                if reply_lost(e):
                    est = float(env.get("ART_CALL_ESTIMATE", CALL_ESTIMATE))
                    log_cost(cost_log, sid, model, n, size, est, False, cost_unknown=True)
                    print(f"{sid}: {model} size={size} reply lost after sending ({type(e).__name__}); "
                          f"counted at ${est:.4f}, total ${spent(cost_log):.4f}; stopping")
                    return "stopped"
                print(f"{sid}: {model} error {e}")
                continue
            imgs = (resp.get("choices") or [{}])[0].get("message", {}).get("images") or []
            cost = float((resp.get("usage") or {}).get("cost") or 0)
            log_cost(cost_log, sid, model, n, size, cost, bool(imgs))
            print(f"{sid}: cost ${cost:.4f}, total ${spent(cost_log):.4f}")
            if not imgs:
                print(f"{sid}: {model} no image")
                continue
            url = imgs[0]["image_url"]["url"]
            ext = "png" if url.startswith("data:image/png") else "jpg"
            p = raw / f"{sid}-a{n}.{ext}"
            p.write_bytes(base64.b64decode(url.split(",", 1)[1]))
            with open(raw / "gens.log", "a") as f:
                f.write(f"{sid}\t{n}\t{model}\t{size}\t{p.name}\n")
            print(f"{sid}: OK attempt {n} {model} size={size} -> {p.name} ({p.stat().st_size}b)")
            return "ok"
    print(f"{sid}: FAILED")
    return "failed"


def main(argv, env):
    cfg = json.loads((HERE / "game-art-prompts.json").read_text())
    raw = pathlib.Path(argv[1]); raw.mkdir(parents=True, exist_ok=True)
    key = env["OPENROUTER_API_KEY"]
    cost_log = pathlib.Path(env.get("ART_COST_LOG", "art-cost.jsonl"))
    budget = float(env.get("ART_BUDGET", "3.5"))
    for sid in argv[2].split(","):
        if generate(sid, raw, cfg, env, key, budget, cost_log) in ("budget", "stopped"):
            break


if __name__ == "__main__":
    main(sys.argv, os.environ)
