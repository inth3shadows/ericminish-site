"""Generate Michigan Fever scene art via OpenRouter. Reads OPENROUTER_API_KEY from env.
Usage: gen-game-art.py RAW_DIR scene_id[,scene_id...]
Prints status lines only. Appends each generation to RAW_DIR/gens.log (the count)."""
import base64, json, os, sys, urllib.request, urllib.error, pathlib

HERE = pathlib.Path(__file__).parent
CFG = json.loads((HERE / "game-art-prompts.json").read_text())
RAW = pathlib.Path(sys.argv[1]); RAW.mkdir(parents=True, exist_ok=True)
KEY = os.environ["OPENROUTER_API_KEY"]
COST_LOG = pathlib.Path(os.environ.get("ART_COST_LOG", "art-cost.jsonl"))
BUDGET = float(os.environ.get("ART_BUDGET", "3.5"))


def spent():
    if not COST_LOG.exists():
        return 0.0
    return sum(json.loads(l)["cost"] for l in COST_LOG.read_text().splitlines() if l.strip())


MODELS = ["google/gemini-3-pro-image-preview", "google/gemini-2.5-flash-image"]


def call(model, prompt, size):
    ic = {"aspect_ratio": "16:9"}
    if size:
        ic["image_size"] = size
    body = {"model": model, "modalities": ["image", "text"], "image_config": ic,
            "usage": {"include": True},
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=280) as r:
        return json.load(r)


for sid in sys.argv[2].split(","):
    if spent() >= BUDGET:
        print(f"{sid}: BUDGET REACHED ({spent():.3f}), stopping")
        break
    prompt = CFG["style"] + CFG["scenes"][sid]["prompt"]
    extra = os.environ.get("EXTRA_" + sid.split("-")[0], "")
    n = len(list(RAW.glob(sid + "-a*.*"))) + 1
    done = False
    for model in MODELS:
        for size in (["2K", None] if "pro" in model else [None]):
            try:
                resp = call(model, prompt, size)
            except urllib.error.HTTPError as e:
                if e.code == 402:
                    print(f"{sid}: HTTP 402, stopping")
                    sys.exit(2)
                print(f"{sid}: {model} size={size} HTTP {e.code} {e.read()[:200].decode(errors='replace')}")
                continue
            except Exception as e:
                print(f"{sid}: {model} error {e}")
                continue
            imgs = (resp.get("choices") or [{}])[0].get("message", {}).get("images") or []
            if not imgs:
                print(f"{sid}: {model} no image")
                continue
            cost = float((resp.get("usage") or {}).get("cost") or 0)
            with open(COST_LOG, "a") as f:
                f.write(json.dumps({"scene": sid, "model": model, "attempt": n, "size": size, "cost": cost}) + "\n")
            print(f"{sid}: cost ${cost:.4f}, total ${spent():.4f}")
            url = imgs[0]["image_url"]["url"]
            ext = "png" if url.startswith("data:image/png") else "jpg"
            p = RAW / f"{sid}-a{n}.{ext}"
            p.write_bytes(base64.b64decode(url.split(",", 1)[1]))
            with open(RAW / "gens.log", "a") as f:
                f.write(f"{sid}\t{n}\t{model}\t{size}\t{p.name}\n")
            print(f"{sid}: OK attempt {n} {model} size={size} -> {p.name} ({p.stat().st_size}b)")
            done = True
            break
        if done:
            break
    if not done:
        print(f"{sid}: FAILED")
