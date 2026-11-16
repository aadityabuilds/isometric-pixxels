# Style test: open image models on our render

`run_spaces.py` sends 1024 px crops of `data/build/final.png` to public Hugging Face Spaces (free ZeroGPU, no token)
with a fidelity-first prompt, and saves the results. The comparison sheets here are the results from Nov 16, 2026.

| Model | Space | Result |
| --- | --- | --- |
| FLUX.1 Kontext [dev] | `black-forest-labs/FLUX.1-Kontext-Dev` | Works anonymously, ~30 s per 1024 px tile. Keeps the layout almost exactly; game-art look. Non-commercial licence. |
| FLUX.1 schnell (text only) | `black-forest-labs/FLUX.1-schnell` | Works, ~4 s. Pretty, but invents a different campus. |
| Qwen-Image-Edit-2511 (+ Lightning) | `Qwen/Qwen-Image-Edit-2511`, `linoyts/Qwen-Image-Edit-2511-Fast`, … | Refused for anonymous users (GPU time above the anonymous limit, or a generic error). Needs a Hugging Face token or Sherlock. Apache-2.0, accepts several images, so it is the model for photo references. |

Pixel finish: downscale 3x, 40-colour median-cut palette without dithering, nearest-neighbour upscale.

## With a Hugging Face token (free account)

`run_qwen_photo.py` (reads `HF_TOKEN` from the environment) uses `LPX55/Qwen-Image-Edit-2511-Turbo-Lightning`,
Qwen-Image-Edit-2511 with the 4-step Lightning LoRA: 4–11 s per 1024 px tile.

- Render only: layout kept, closer to true pixel art than Kontext, a little noisy.
- Render + a public-domain photo of Memorial Church: the real mosaic gable, rose window, portal and arcades appear in
  pixel art. On a wide crop the model pastes a flat front view; on a tight 4x crop around the church it keeps a
  three-quarter view, though it turns the church a little toward the viewer and draws it slightly larger.
