# Qwen-Image-Edit style LoRA

This is step 3 of the original plan: train a **Qwen-Image-Edit-2511** LoRA on the Nano Banana tiles so the rest of the campus can be redrawn locally (Sherlock), not by Gemini.

## Why this machine cannot train it

| Need | Status |
| --- | --- |
| Paired data (plain render → Nano Banana) | Ready — `build_dataset.py` |
| GPU with ~30 GB (L40S / A100 / H100) | Not on this Cloud Agent VM |
| Hugging Face Jobs | Account `aadityabuilds` is not Pro; Jobs need Pro / Team / Enterprise |
| Sherlock | Original $0 path; run `sherlock.sbatch` from a login node |

tiny.london trained the same class of LoRA for ~4 hours on one H100 with [musubi-tuner](https://github.com/kohya-ss/musubi-tuner) / [ai-toolkit](https://github.com/ostris/ai-toolkit). Isometric NYC used about 40 pairs. We have ~50 exact Nano Banana tiles plus overlapping 1024 crops of the finished map.

## Data

```bash
pipeline/.venv/bin/python experiments/qwen-lora/build_dataset.py
```

Writes `data/ai/lora_pairs/{control,target}/` (gitignored, derived from `data/`). Control is the code-drawn map; target is the Nano Banana painting of the same crop. Preview: `pairs_preview.jpg`.

## Train on Sherlock

```bash
# once, from a Sherlock login / dt node
git clone --depth 1 https://github.com/kohya-ss/musubi-tuner.git third_party/musubi-tuner
# download Edit-2511 DiT + VAE + Qwen2.5-VL into $SCRATCH/qwen-edit-2511 (see train_sherlock.sh)
sbatch experiments/qwen-lora/sherlock.sbatch
```

If the L40S queue is long, resubmit with `#SBATCH -C GPU_SKU:H100_SXM5`. Keep the ~60 GB of weights in `$SCRATCH`, not `$HOME`.

After training, `pixel-stanford-qwen-edit.safetensors` is the style adapter. Add the [Lightning 4-step LoRA](https://huggingface.co/lightx2v/Qwen-Image-Lightning) at inference for speed, then generate overlapping 1024 windows of `data/build/final.png` and average them (tiny.london's seam-free trick).

## Hugging Face Jobs (if you upgrade to Pro)

```bash
huggingface-cli login
# then ask the agent to submit the same train_sherlock.sh as an HfApi().run_uv_job
# on flavor a100-large, timeout 8h, secrets HF_TOKEN
```
