import base64, json, os, sys, time

import requests
from pathlib import Path

KEY = os.environ.get("GEMINI_API_KEY", "")
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
LEDGER = Path(__file__).with_name("ledger.jsonl")
PRICE = {  # USD
    "gemini-3-pro-image": {"in": 2.0e-6, "txt_out": 12.0e-6, "img_out": 120.0e-6},
    "gemini-nano-banana-2.1": {"in": 0.5e-6, "txt_out": 3.0e-6, "img_out": 30.0e-6},
}


def img(path):
    p = Path(path)
    mime = "image/png" if p.suffix == ".png" else "image/jpeg"
    return {"type": "image", "mime_type": mime, "data": base64.b64encode(p.read_bytes()).decode()}


def spent():
    if not LEDGER.exists():
        return 0.0
    return sum(json.loads(l)["usd"] for l in LEDGER.read_text().splitlines() if l.strip())


def generate(model, prompt, images, out, size="2K", aspect="1:1", budget=4.0):
    if spent() > budget:
        raise SystemExit(f"budget guard: already spent ${spent():.2f}")
    body = {
        "model": model,
        "input": [{"type": "text", "text": prompt}] + [img(p) for p in images],
        "response_format": {"type": "image", "mime_type": "image/jpeg", "aspect_ratio": aspect, "image_size": size},
    }
    t0 = time.time()
    r = requests.post(URL, headers={"x-goog-api-key": KEY, "Content-Type": "application/json", "Api-Revision": "2026-05-20"}, json=body, timeout=600)
    dt = time.time() - t0
    if r.status_code != 200:
        print("HTTP", r.status_code, r.text[:800])
        return None
    d = r.json()
    # Find the image and usage wherever the response puts them.
    found = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("type") == "image" and o.get("data"):
                found.append(o["data"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(d.get("outputs", d))
    usage = d.get("usage", {})
    pr = PRICE[model]
    tin = usage.get("total_input_tokens", 0)
    tout = usage.get("total_output_tokens", 0)
    tthink = usage.get("total_thought_tokens", 0) or usage.get("total_reasoning_tokens", 0)
    img_tokens = 0
    for m in usage.get("output_tokens_by_modality", []) or []:
        if m.get("modality") == "image":
            img_tokens = m.get("tokens", 0)
    usd = tin * pr["in"] + img_tokens * pr["img_out"] + max(0, tout - img_tokens + tthink) * pr["txt_out"]
    if not img_tokens and found:
        usd = tin * pr["in"] + (0.134 if "pro" in model else 0.0504) + tthink * pr["txt_out"]
    LEDGER.open("a").write(json.dumps({"model": model, "out": out, "usd": round(usd, 4), "usage": usage, "secs": round(dt)}) + "\n")
    if found:
        Path(out).write_bytes(base64.b64decode(found[-1]))
    texts = []

    def walk_text(o):
        if isinstance(o, dict):
            if o.get("type") == "text" and o.get("text"):
                texts.append(o["text"])
            for v in o.values():
                walk_text(v)
        elif isinstance(o, list):
            for v in o:
                walk_text(v)

    walk_text(d.get("outputs", []))
    print(json.dumps({"saved": bool(found), "out": out, "usd": round(usd, 4), "total_spent": round(spent(), 4), "secs": round(dt), "usage": usage, "text": " ".join(texts)[:400]}, indent=1))
    if not found:
        print(json.dumps(d)[:1500])
    return out
