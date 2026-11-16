import os
import sys, time
from gradio_client import Client, handle_file
import run
TOK = os.environ["HF_TOKEN"]

def go(space, images, prompt, name, steps=4, size=1024, cfg=1.0):
    t0 = time.time()
    try:
        c = Client(space, token=TOK, verbose=False)
        imgs = [{"image": handle_file(p), "caption": None} for p in images]
        res = c.predict(imgs, prompt, 42, False, cfg, steps, size, size, False, api_name="/infer")
        print("OK", name, round(time.time() - t0), run.save(res, name), flush=True)
    except Exception as e:
        print("FAIL", name, round(time.time() - t0), repr(e)[:300], flush=True)

PHOTO = (" Image 2 is a photograph of the real Memorial Church. Redraw image 1 only: give the large church in the middle of "
         "image 1 the real church's golden mosaic gable facade, arched portal and arcades from image 2, seen from image 1's camera. "
         "Keep image 1's camera, layout and every shape.")
if __name__ == "__main__":
    which = sys.argv[1]
    if which == "plain":
        go("linoyts/Qwen-Image-Edit-2511-Fast", ["/tmp/gen/in/quad.png"], run.STYLE, "q2511_quad.png")
    elif which == "photo":
        go("linoyts/Qwen-Image-Edit-2511-Fast", ["/tmp/gen/in/memchu_r3.png", "/tmp/gen/in/memchu_photo.jpg"], run.STYLE + PHOTO, "q2511_memchu_photo.png")
    elif which == "memplain":
        go("linoyts/Qwen-Image-Edit-2511-Fast", ["/tmp/gen/in/memchu_r3.png"], run.STYLE, "q2511_memchu_plain.png")
