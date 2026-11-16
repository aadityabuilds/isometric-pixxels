#!/usr/bin/env bash
# Fine-tune Qwen-Image-Edit-2511 on the Nano Banana pairs (musubi-tuner).
# Needs one GPU with ~30 GB (L40S / A100 / H100). On Sherlock:
#   sbatch experiments/qwen-lora/sherlock.sbatch
# Or interactively after `module load` / venv:
#   bash experiments/qwen-lora/train_sherlock.sh

set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PAIRS="${PAIRS:-$ROOT/data/ai/lora_pairs}"
MODELS="${MODELS:-${SCRATCH:-$ROOT/data}/qwen-edit-2511}"
OUT="${OUT:-$ROOT/data/ai/lora_out}"
MUSUBI="${MUSUBI:-$ROOT/third_party/musubi-tuner}"

mkdir -p "$OUT" "$PAIRS/cache"
# Rewrite dataset.toml with absolute paths for this run.
TOML="$OUT/dataset.toml"
sed \
  -e "s|TARGET_DIR|$PAIRS/target|" \
  -e "s|CONTROL_DIR|$PAIRS/control|" \
  -e "s|CACHE_DIR|$PAIRS/cache|" \
  "$ROOT/experiments/qwen-lora/dataset.toml" > "$TOML"

DIT="$MODELS/qwen_image_edit_2511_bf16.safetensors"
VAE="$MODELS/qwen_image_vae.safetensors"
TE="$MODELS/qwen_2.5_vl_7b.safetensors"

if [[ ! -f "$DIT" ]]; then
  echo "Download Edit-2511 weights into $MODELS first:"
  echo "  huggingface-cli download Comfy-Org/Qwen-Image-Edit_ComfyUI \\"
  echo "    split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors --local-dir $MODELS"
  echo "  huggingface-cli download Comfy-Org/Qwen-Image-Edit_ComfyUI \\"
  echo "    split_files/vae/qwen_image_vae.safetensors --local-dir $MODELS"
  echo "  huggingface-cli download Comfy-Org/Qwen-Image_ComfyUI \\"
  echo "    split_files/text_encoders/qwen_2.5_vl_7b.safetensors --local-dir $MODELS"
  echo "Then flatten the split_files/... folders so the three files sit in $MODELS."
  exit 1
fi

python "$MUSUBI/src/musubi_tuner/qwen_image_cache_latents.py" \
  --dataset_config "$TOML" \
  --vae "$VAE" \
  --model_version edit-2511

python "$MUSUBI/src/musubi_tuner/qwen_image_cache_text_encoder_outputs.py" \
  --dataset_config "$TOML" \
  --text_encoder "$TE" \
  --model_version edit-2511

accelerate launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
  "$MUSUBI/src/musubi_tuner/qwen_image_train_network.py" \
  --dit "$DIT" \
  --vae "$VAE" \
  --text_encoder "$TE" \
  --dataset_config "$TOML" \
  --model_version edit-2511 \
  --sdpa --mixed_precision bf16 \
  --fp8_base --fp8_scaled --fp8_vl \
  --timestep_sampling shift \
  --weighting_scheme none --discrete_flow_shift 2.2 \
  --optimizer_type adamw8bit --learning_rate 5e-5 \
  --gradient_checkpointing \
  --max_data_loader_n_workers 2 --persistent_data_loader_workers \
  --network_module networks.lora_qwen_image \
  --network_dim 16 --network_alpha 16 \
  --max_train_epochs 16 --save_every_n_epochs 2 --seed 42 \
  --output_dir "$OUT" --output_name pixel-stanford-qwen-edit
