"""Redraw one 1024 crop with Qwen-Image-Edit-2511 + the Stanford style LoRA.

Needs a GPU. After training:

  python experiments/qwen-lora/generate.py \\
      --control data/ai/lora_pairs/control/04480_01792.jpg \\
      --lora data/ai/lora_out/pixel-stanford-qwen-edit.safetensors \\
      --out /tmp/qwen_quad.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--control", required=True)
    ap.add_argument("--lora", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="Qwen/Qwen-Image-Edit-2511")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    args = ap.parse_args()

    import torch
    from diffusers import QwenImageEditPipeline

    pipe = QwenImageEditPipeline.from_pretrained(args.base, torch_dtype=torch.bfloat16)
    pipe.to("cuda")
    pipe.load_lora_weights(str(Path(args.lora).parent), weight_name=Path(args.lora).name)
    txt = Path(args.control).with_suffix(".txt")
    if not txt.exists():
        txt = Path(args.control).parent.parent / "target" / (Path(args.control).stem + ".txt")
    prompt = txt.read_text().strip() if txt.exists() else "Redraw this isometric Stanford campus render as SimCity 2000 pixel art."
    image = Image.open(args.control).convert("RGB")
    out = pipe(
        image=image,
        prompt=prompt,
        generator=torch.Generator("cuda").manual_seed(42),
        true_cfg_scale=args.cfg,
        num_inference_steps=args.steps,
        negative_prompt=" ",
    ).images[0]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
