"""Download the latest NAIP aerial imagery (0.6 m, RGB + near-infrared) and warp it onto the lidar grid."""

import numpy as np
import planetary_computer as pc
import pystac_client
import rasterio
from rasterio.merge import merge
from rasterio.warp import Resampling, reproject

from .config import RAW, bbox_tuple


def main():
    lidar = np.load(RAW / "lidar.npz")
    H, W = lidar["dsm"].shape
    x0, y1 = lidar["origin"]
    res = float(lidar["res"])

    client = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1/", modifier=pc.sign_inplace
    )
    items = list(client.search(collections=["naip"], bbox=list(bbox_tuple())).items())
    latest = max(i.datetime for i in items).year
    items = [i for i in items if i.datetime.year == latest]
    print(f"NAIP {latest}: {[i.id for i in items]}")

    sources = [rasterio.open(i.assets["image"].href) for i in items]
    mosaic, transform = merge(sources)
    src_crs = sources[0].crs

    dst = np.zeros((4, H, W), np.uint8)
    dst_transform = rasterio.transform.from_origin(x0, y1, res, res)
    for b in range(4):
        reproject(
            mosaic[b],
            dst[b],
            src_transform=transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs="EPSG:32610",
            resampling=Resampling.bilinear,
        )
    np.savez_compressed(RAW / "naip.npz", rgbn=dst)
    print(f"wrote {RAW / 'naip.npz'} {dst.shape}")


if __name__ == "__main__":
    main()
