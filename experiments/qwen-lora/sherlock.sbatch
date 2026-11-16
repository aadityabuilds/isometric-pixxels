#!/bin/bash
#SBATCH --job-name=px-qwen-lora
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH -C GPU_SKU:L40S
#SBATCH --time=08:00:00
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --output=pixel-stanford-qwen-lora-%j.out

# Original plan: train the style LoRA on Sherlock, $0. If L40S is busy, retry with
#   -C GPU_SKU:H100_SXM5
# Keep the ~60 GB of model files in $SCRATCH, not $HOME.

set -euo pipefail
module load python/3.12 cuda/12.4 || true
cd "${SLURM_SUBMIT_DIR:-$PWD}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT
export PAIRS="${PAIRS:-$ROOT/data/ai/lora_pairs}"
export MODELS="${MODELS:-$SCRATCH/qwen-edit-2511}"
export OUT="${OUT:-$SCRATCH/pixel-stanford-lora}"
export MUSUBI="${MUSUBI:-$ROOT/third_party/musubi-tuner}"

if [[ ! -d "$MUSUBI" ]]; then
  git clone --depth 1 https://github.com/kohya-ss/musubi-tuner.git "$MUSUBI"
fi
if [[ ! -d "$MUSUBI/.venv" ]]; then
  python3 -m venv "$MUSUBI/.venv"
  # shellcheck disable=SC1091
  source "$MUSUBI/.venv/bin/activate"
  pip install -U pip
  pip install -e "$MUSUBI"
else
  # shellcheck disable=SC1091
  source "$MUSUBI/.venv/bin/activate"
fi

bash "$ROOT/experiments/qwen-lora/train_sherlock.sh"
echo "LoRA written under $OUT"
