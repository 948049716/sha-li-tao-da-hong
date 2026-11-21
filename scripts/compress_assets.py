#!/usr/bin/env python3
"""
《沙里淘大红》美术素材本地自动规格化与压缩脚本（基于 Pillow，零外部 API 依赖）
遵循《docs/美术素材压缩与分包规范.md》：
  所有通过 ComfyUI 或外部引入的生成素材，必须经过本脚本完成目标尺寸缩放、
  四边连通域泛洪去背（保护角色眼白/白桶/白瓷盒内部白色）与 8-bit 调色板/无损压缩后方可入库使用。

用法：
  # 按 assetId 规则把 ComfyUI 原始大图去背、缩放并压缩到正式路径
  python3 scripts/compress_assets.py /tmp/raw.png -o assets/figurines/fig_001.png --asset-id fig_001

  # 批量重压缩目录下所有图片并校验单图体积门禁（自动按输出文件名匹配 data/art/prompts.json 规格）
  python3 scripts/compress_assets.py assets/ --check-budget

  # 压缩单个普通图片（原地覆盖保留更优体积）
  python3 scripts/compress_assets.py docs/assets/cover.jpg
"""

from __future__ import annotations

import argparse
from collections import deque
import io
import json
import sys
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageOps
except ImportError:
    print("错误：未安装 Pillow，请先执行 `pip install Pillow`", file=sys.stderr)
    sys.exit(1)

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
REPO_ROOT = Path(__file__).resolve().parent.parent
PROMPTS_JSON = REPO_ROOT / "data" / "art" / "prompts.json"

# 横向长条/紧致裁边资产集合（去除上下大片空白透明区，按长边缩放）
STRIP_ASSETS: dict[str, tuple[int, int]] = {
    "ui_logo_title": (512, 256),
    "ui_vessel_rim": (256, 96),
    "ui_board_wood": (256, 96),
    "ui_board_slant": (256, 96),
    "ui_ice_block": (256, 160),
    "ui_btn_wood": (256, 112),
    "ui_panel_parchment": (384, 512),
}


def load_prompt_catalog() -> dict[str, dict[str, Any]]:
    if not PROMPTS_JSON.exists():
        return {}
    data = json.loads(PROMPTS_JSON.read_text(encoding="utf-8"))
    catalog: dict[str, dict[str, Any]] = {}
    for item in data.get("assets", []):
        aid = item["assetId"]
        catalog[aid] = item
    return catalog


def resolve_spec(
    asset_id: str | None,
    preset: str | None,
    dst: Path,
    catalog: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    meta: dict[str, Any] | None = None
    if asset_id and asset_id in catalog:
        meta = catalog[asset_id]
    elif dst.stem in catalog:
        meta = catalog[dst.stem]

    cat = preset or (meta["category"] if meta else None)
    if not cat and not meta:
        return None

    aid = (meta["assetId"] if meta else asset_id) or dst.stem
    transparent = bool(meta.get("transparent", cat != "ui_background")) if meta else (cat != "ui_background")

    if aid == "ui_app_icon":
        return {"assetId": aid, "size": (512, 512), "mode": "cover", "transparent": False, "maxKB": 90}
    if aid in STRIP_ASSETS:
        w, h = STRIP_ASSETS[aid]
        max_kb = 75 if aid == "ui_panel_parchment" else (65 if aid == "ui_logo_title" else 35)
        return {"assetId": aid, "size": (w, h), "mode": "trim_fit", "transparent": True, "maxKB": max_kb}
    if aid == "ui_magnifier":
        return {"assetId": aid, "size": (160, 160), "mode": "square_pad", "transparent": True, "lens_translucent": True, "maxKB": 28}
    if cat == "ui_background":
        return {"assetId": aid, "size": (540, 960), "mode": "cover", "transparent": False, "maxKB": 300}
    if cat == "ui_frame":
        return {"assetId": aid, "size": (240, 320), "mode": "frame_fit", "transparent": True, "maxKB": 50}
    if cat == "blindbox":
        return {"assetId": aid, "size": (160, 160), "mode": "square_pad", "transparent": True, "maxKB": 30}
    if cat == "figurine":
        return {"assetId": aid, "size": (256, 256), "mode": "square_pad", "transparent": True, "maxKB": 48}
    # ui_icon / ui_texture 默认规格
    return {"assetId": aid, "size": (128, 128), "mode": "square_pad", "transparent": transparent, "maxKB": 25}


def remove_white_bg_floodfill(img: Image.Image, lens_translucent: bool = False) -> Image.Image:
    """
    从图像四条边界发起近白连通域泛洪去背：
    - 遇到 #5A3A22 手绘封闭墨线立即停止，100% 保护内部眼白、白桶、白瓷盒与浅色高光；
    - 对边界 1px 邻域做平滑羽化去白边。
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    raw = bytearray(rgba.tobytes())
    visited = bytearray(w * h)
    bg_mask = bytearray(w * h)

    def is_bg_white(idx4: int) -> bool:
        r = raw[idx4]
        g = raw[idx4 + 1]
        b = raw[idx4 + 2]
        a = raw[idx4 + 3]
        if a < 16:
            return True
        mn = r if r < g else g
        if b < mn:
            mn = b
        mx = r if r > g else g
        if b > mx:
            mx = b
        # 近纯白且低饱和度（避开暖黄/浅粉/天蓝水彩晕光主体）
        return mn >= 234 and (mx - mn) <= 24

    q: deque[int] = deque()
    for x in range(w):
        for y in (0, h - 1):
            p = y * w + x
            if not visited[p] and is_bg_white(p * 4):
                visited[p] = 1
                bg_mask[p] = 1
                q.append(p)
    for y in range(h):
        for x in (0, w - 1):
            p = y * w + x
            if not visited[p] and is_bg_white(p * 4):
                visited[p] = 1
                bg_mask[p] = 1
                q.append(p)

    while q:
        p = q.popleft()
        x = p % w
        y = p // w
        if x > 0:
            np = p - 1
            if not visited[np] and is_bg_white(np * 4):
                visited[np] = 1
                bg_mask[np] = 1
                q.append(np)
        if x + 1 < w:
            np = p + 1
            if not visited[np] and is_bg_white(np * 4):
                visited[np] = 1
                bg_mask[np] = 1
                q.append(np)
        if y > 0:
            np = p - w
            if not visited[np] and is_bg_white(np * 4):
                visited[np] = 1
                bg_mask[np] = 1
                q.append(np)
        if y + 1 < h:
            np = p + w
            if not visited[np] and is_bg_white(np * 4):
                visited[np] = 1
                bg_mask[np] = 1
                q.append(np)

    # 写入透明背景 + 边缘 1px 抗锯齿羽化去白边
    for p in range(w * h):
        i4 = p * 4
        if bg_mask[p]:
            raw[i4] = 255
            raw[i4 + 1] = 255
            raw[i4 + 2] = 255
            raw[i4 + 3] = 0
            continue
        x = p % w
        y = p // w
        touches_bg = (
            (x > 0 and bg_mask[p - 1])
            or (x + 1 < w and bg_mask[p + 1])
            or (y > 0 and bg_mask[p - w])
            or (y + 1 < h and bg_mask[p + w])
        )
        if touches_bg:
            r, g, b = raw[i4], raw[i4 + 1], raw[i4 + 2]
            lum = (r * 77 + g * 150 + b * 29) >> 8
            if lum > 205:
                # 越接近纯白边缘越透明，保留深棕墨线实心度
                alpha = max(0, min(255, int((248 - lum) * 255 / 43)))
                raw[i4 + 3] = min(raw[i4 + 3], alpha)
                if raw[i4 + 3] == 0:
                    raw[i4] = raw[i4 + 1] = raw[i4 + 2] = 255

    # 放大镜特例：把镜框内部大块纯白镜片变为微透玻璃反光 (alpha ≈ 38)
    if lens_translucent:
        # 搜索图像上半中心区域内部近白点
        seeds = [(w // 2, h // 2), (int(w * 0.42), int(h * 0.42)), (int(w * 0.58), int(h * 0.42))]
        for sx, sy in seeds:
            sp = sy * w + sx
            if not bg_mask[sp] and is_bg_white(sp * 4):
                lq: deque[int] = deque([sp])
                lens_vis = {sp}
                while lq:
                    cp = lq.popleft()
                    cx, cy = cp % w, cp // w
                    for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                        if 0 <= nx < w and 0 <= ny < h:
                            np = ny * w + nx
                            if np not in lens_vis and not bg_mask[np] and is_bg_white(np * 4):
                                lens_vis.add(np)
                                lq.append(np)
                if 80 < len(lens_vis) < (w * h) // 2:
                    for lp in lens_vis:
                        raw[lp * 4 + 3] = 38
                    break

    return Image.frombytes("RGBA", (w, h), bytes(raw))


def resize_premultiplied(img: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    """使用预乘 Alpha 进行 LANCZOS 缩放，避免透明边缘产生灰白杂边。"""
    if img.mode != "RGBA":
        return img.resize(target_size, Image.Resampling.LANCZOS)
    w, h = img.size
    raw = bytearray(img.tobytes())
    for i in range(0, w * h * 4, 4):
        a = raw[i + 3]
        if a == 0:
            raw[i] = raw[i + 1] = raw[i + 2] = 0
        elif a < 255:
            raw[i] = (raw[i] * a + 127) // 255
            raw[i + 1] = (raw[i + 1] * a + 127) // 255
            raw[i + 2] = (raw[i + 2] * a + 127) // 255
    pre = Image.frombytes("RGBA", (w, h), bytes(raw)).resize(target_size, Image.Resampling.LANCZOS)
    out = bytearray(pre.tobytes())
    tw, th = target_size
    for i in range(0, tw * th * 4, 4):
        a = out[i + 3]
        if a < 6:
            out[i] = out[i + 1] = out[i + 2] = 255
            out[i + 3] = 0
        elif a < 255:
            out[i] = min(255, (out[i] * 255 + a // 2) // a)
            out[i + 1] = min(255, (out[i + 1] * 255 + a // 2) // a)
            out[i + 2] = min(255, (out[i + 2] * 255 + a // 2) // a)
    return Image.frombytes("RGBA", target_size, bytes(out))


def tint_card_frame_interior(img: Image.Image, asset_id: str) -> Image.Image:
    """对品质卡框内部不透明纯白纸面叠加柔和的水彩光泽晕染（对齐 UI_UX 规范 cardBg，消除死白底）。"""
    import math

    tints: dict[str, tuple[int, int, int]] = {
        "ui_card_frame_white": (250, 246, 240),
        "ui_card_frame_green": (212, 234, 222),
        "ui_card_frame_blue": (210, 228, 242),
        "ui_card_frame_purple": (226, 214, 242),
        "ui_card_frame_gold": (238, 226, 198),
        "ui_card_frame_red": (240, 212, 212),
    }
    if asset_id not in tints or asset_id == "ui_card_frame_white":
        return img

    tr, tg, tb = tints[asset_id]
    w, h = img.size
    raw = bytearray(img.tobytes())
    for y in range(h):
        ny = y / max(1, h - 1)
        for x in range(w):
            nx = x / max(1, w - 1)
            if not (0.14 <= nx <= 0.86 and 0.11 <= ny <= 0.89):
                continue
            i4 = (y * w + x) * 4
            a = raw[i4 + 3]
            r, g, b = raw[i4], raw[i4 + 1], raw[i4 + 2]
            # 保留已有的深色边角花纹像素，仅填充透明内芯或浅白纸底
            if a >= 180 and (r + g + b) < 620:
                continue
            if asset_id == "ui_card_frame_green":
                wave = (nx - 0.5) * 28.0
            elif asset_id == "ui_card_frame_blue":
                wave = math.sin((nx - ny) * math.pi * 2.0) * 18.0
            elif asset_id == "ui_card_frame_purple":
                wave = (0.18 - ((nx - 0.5) ** 2 + (ny - 0.5) ** 2)) * 55.0
            elif asset_id == "ui_card_frame_gold":
                wave = math.sin(nx * math.pi * 2.0) * 18.0
            else:
                wave = math.cos((nx + ny) * math.pi * 2.0) * 18.0

            raw[i4] = max(180, min(248, round(tr + wave)))
            raw[i4 + 1] = max(180, min(248, round(tg + wave)))
            raw[i4 + 2] = max(180, min(248, round(tb + wave)))
            raw[i4 + 3] = max(a, 245)
    return Image.frombytes("RGBA", (w, h), bytes(raw))


def apply_spec_transform(img: Image.Image, spec: dict[str, Any], offset_x: int = 0) -> Image.Image:
    tw, th = spec["size"]
    mode = spec["mode"]

    if not spec.get("transparent", False):
        rgb = img.convert("RGB")
        return ImageOps.fit(rgb, (tw, th), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

    # 先缩放到 2x 工作尺寸执行泛洪去背（兼顾极速处理与 2x 超采样抗锯齿）
    work_max = max(tw * 2, th * 2, 384)
    if max(img.size) > work_max:
        scale = work_max / max(img.size)
        work_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        work_img = img.convert("RGBA").resize(work_size, Image.Resampling.LANCZOS)
    else:
        work_img = img.convert("RGBA")

    # 若原图尚无有效透明边缘，则执行四边泛洪去白
    alpha_extrema = work_img.getchannel("A").getextrema()
    if alpha_extrema[0] > 16:
        cleaned = remove_white_bg_floodfill(work_img, lens_translucent=bool(spec.get("lens_translucent")))
    else:
        cleaned = work_img

    bbox = cleaned.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (tw, th), (255, 255, 255, 0))

    cropped = cleaned.crop(bbox)

    if mode == "trim_fit":
        # 紧致等比缩放到不超过 (tw, th)，保留 4px 安全透明边
        avail_w = max(8, tw - 8)
        avail_h = max(8, th - 8)
        ratio = min(avail_w / cropped.width, avail_h / cropped.height)
        nw = max(1, round(cropped.width * ratio))
        nh = max(1, round(cropped.height * ratio))
        resized = resize_premultiplied(cropped, (nw, nh))
        pad_w = min(tw, nw + 8)
        pad_h = min(th, nh + 8)
        canvas = Image.new("RGBA", (pad_w, pad_h), (255, 255, 255, 0))
        canvas.paste(resized, ((pad_w - nw) // 2, (pad_h - nh) // 2))
        return canvas

    if mode == "frame_fit":
        # 品质卡框铺满 240x320，四角留 2px 呼吸边
        avail_w, avail_h = tw - 4, th - 4
        ratio = min(avail_w / cropped.width, avail_h / cropped.height)
        nw = max(1, round(cropped.width * ratio))
        nh = max(1, round(cropped.height * ratio))
        resized = resize_premultiplied(cropped, (nw, nh))
        canvas = Image.new("RGBA", (tw, th), (255, 255, 255, 0))
        canvas.paste(resized, ((tw - nw) // 2, (th - nh) // 2))
        return tint_card_frame_interior(canvas, spec["assetId"])

    # square_pad: 居中放入正方形目标画布，保留 6% 视觉安全留白
    pad = max(4, round(min(tw, th) * 0.06))
    avail_w = max(8, tw - pad * 2)
    avail_h = max(8, th - pad * 2)
    ratio = min(avail_w / cropped.width, avail_h / cropped.height)
    nw = max(1, round(cropped.width * ratio))
    nh = max(1, round(cropped.height * ratio))
    resized = resize_premultiplied(cropped, (nw, nh))
    canvas = Image.new("RGBA", (tw, th), (255, 255, 255, 0))
    px = max(0, min(tw - nw, (tw - nw) // 2 + offset_x))
    canvas.paste(resized, (px, (th - nh) // 2))
    return canvas


def encode_png_8bit(img: Image.Image, quantize: bool = True, max_kb: int | None = None) -> bytes:
    """
    输出高压缩比且严格兼容 tools/lib/png.js (8-bit depth, non-interlaced) 的 PNG 字节流。
    """
    if quantize:
        color_steps = [256, 192, 144, 108, 80] if max_kb else [256]
        last_valid: bytes | None = None
        for n_colors in color_steps:
            if img.mode == "RGBA":
                q = img.quantize(colors=n_colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
                # 确保全透明调色板槽位 RGB 为纯白 #FFFFFF，避免干扰 dHash 灰度计算
                trans = q.info.get("transparency")
                pal = q.getpalette()
                if pal is not None and trans is not None:
                    if isinstance(trans, int):
                        pal[trans * 3 : trans * 3 + 3] = [255, 255, 255]
                    elif isinstance(trans, (bytes, bytearray)):
                        for idx, alpha in enumerate(trans):
                            if alpha == 0 and idx * 3 + 3 <= len(pal):
                                pal[idx * 3 : idx * 3 + 3] = [255, 255, 255]
                    q.putpalette(pal)
            else:
                rgb = img.convert("RGB")
                q = rgb.quantize(colors=min(n_colors, 224), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

            buf = io.BytesIO()
            q.save(buf, format="PNG", optimize=True, compress_level=9)
            data = buf.getvalue()
            if not (len(data) > 29 and data[24] == 8 and data[28] == 0):
                buf2 = io.BytesIO()
                q.save(buf2, format="PNG", optimize=False, bits=8, compress_level=9)
                data = buf2.getvalue()

            if len(data) > 29 and data[24] == 8 and data[28] == 0:
                last_valid = data
                if not max_kb or (len(data) / 1024.0) <= max_kb:
                    return data

        if last_valid is not None:
            return last_valid

    buf_fallback = io.BytesIO()
    img.save(buf_fallback, format="PNG", optimize=True, compress_level=9)
    return buf_fallback.getvalue()


def compress_file(
    src: Path,
    dst: Path,
    quality: int = 85,
    spec: dict[str, Any] | None = None,
    max_size: tuple[int, int] | None = None,
    remove_bg: bool = False,
    offset_x: int = 0,
) -> tuple[int, int, int | None]:
    orig_bytes = src.read_bytes()
    orig_size = len(orig_bytes)
    ext = dst.suffix.lower() or src.suffix.lower()

    with Image.open(io.BytesIO(orig_bytes)) as raw_img:
        img = ImageOps.exif_transpose(raw_img)
        orig_dims = img.size

        if spec is not None:
            img = apply_spec_transform(img, spec, offset_x=offset_x)
        else:
            if remove_bg:
                img = remove_white_bg_floodfill(img)
            if max_size and (img.width > max_size[0] or img.height > max_size[1]):
                img.thumbnail(max_size, Image.Resampling.LANCZOS)

        dims_changed = img.size != orig_dims or spec is not None or remove_bg
        buf = io.BytesIO()

        if ext in {".jpg", ".jpeg"}:
            if img.mode in {"RGBA", "LA", "P"}:
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
            compressed_bytes = buf.getvalue()
        elif ext == ".png":
            use_quant = False if (spec and spec.get("mode") == "frame_fit") else True
            compressed_bytes = encode_png_8bit(img, quantize=use_quant, max_kb=spec.get("maxKB") if spec else None)
        elif ext == ".webp":
            img.save(buf, format="WEBP", quality=quality, method=6)
            compressed_bytes = buf.getvalue()
        else:
            raise ValueError(f"不支持的图片格式：{ext}")

        final_dims = img.size

    dst.parent.mkdir(parents=True, exist_ok=True)
    max_kb = spec.get("maxKB") if spec else None

    if not dims_changed and len(compressed_bytes) >= orig_size and src.suffix.lower() == ext:
        dst.write_bytes(orig_bytes)
        print(f"[KEEP] {src} -> {dst} ({final_dims[0]}x{final_dims[1]}) | {orig_size / 1024:.1f} KB")
        return orig_size, orig_size, max_kb

    dst.write_bytes(compressed_bytes)
    new_size = len(compressed_bytes)
    ratio = (1 - new_size / orig_size) * 100 if orig_size > 0 else 0.0
    print(
        f"[OK] {dst} ({orig_dims[0]}x{orig_dims[1]} -> {final_dims[0]}x{final_dims[1]}) | "
        f"{orig_size / 1024:.1f} KB -> {new_size / 1024:.1f} KB ({ratio:+.1f}% saved)"
    )
    return orig_size, new_size, max_kb


def parse_wh(val: str | None) -> tuple[int, int] | None:
    if not val:
        return None
    parts = val.lower().split("x")
    if len(parts) != 2:
        raise ValueError(f"--max-size 格式应为 WxH，例如 256x256，当前：{val}")
    return int(parts[0]), int(parts[1])


def main() -> int:
    parser = argparse.ArgumentParser(description="《沙里淘大红》美术素材规格化缩放、泛洪去背与压缩工具")
    parser.add_argument("target", help="待压缩的图片文件或目录路径")
    parser.add_argument("-o", "--output", help="输出文件路径（仅对单文件生效，省略则原地覆盖）")
    parser.add_argument("-q", "--quality", type=int, default=85, help="JPEG/WebP 压缩质量 1-95（默认 85）")
    parser.add_argument("--asset-id", help="按 data/art/prompts.json 中指定 assetId 的标准尺寸与去背规则处理")
    parser.add_argument("--preset", help="指定品类预设（ui_background/ui_icon/ui_texture/ui_frame/blindbox/figurine）")
    parser.add_argument("--max-size", help="自定义最大尺寸 WxH（例如 256x256）")
    parser.add_argument("--remove-bg", action="store_true", help="强制执行四边泛洪白底去背")
    parser.add_argument("--offset-x", type=int, default=0, help="正方形画布内水平微调像素偏移")
    parser.add_argument("--check-budget", action="store_true", help="严格检查单图是否超出《美术素材压缩与分包规范》上限")
    args = parser.parse_args()

    target = Path(args.target)
    if not target.exists():
        print(f"错误：路径不存在：{target}", file=sys.stderr)
        return 1

    catalog = load_prompt_catalog()
    max_wh = parse_wh(args.max_size)
    budget_errors: list[str] = []

    if target.is_file():
        dst = Path(args.output) if args.output else target
        spec = resolve_spec(args.asset_id, args.preset, dst, catalog)
        _, new_sz, max_kb = compress_file(
            target, dst, quality=args.quality, spec=spec, max_size=max_wh, remove_bg=args.remove_bg, offset_x=args.offset_x
        )
        if args.check_budget and max_kb and (new_sz / 1024.0) > max_kb:
            budget_errors.append(f"{dst}: {new_sz / 1024:.1f} KB > 上限 {max_kb} KB")
    else:
        if args.output:
            print("错误：目录批量压缩不支持 -o/--output 参数，将原地覆盖各图片。", file=sys.stderr)
            return 1
        files = sorted(
            p for p in target.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
        )
        if not files:
            print(f"未在目录中找到支持的图片文件：{target}")
            return 0
        total_orig = 0
        total_new = 0
        for f in files:
            spec = resolve_spec(None, args.preset, f, catalog)
            o, n, max_kb = compress_file(
                f, f, quality=args.quality, spec=spec, max_size=max_wh, remove_bg=args.remove_bg
            )
            total_orig += o
            total_new += n
            if args.check_budget and max_kb and (n / 1024.0) > max_kb:
                budget_errors.append(f"{f}: {n / 1024:.1f} KB > 上限 {max_kb} KB")
        total_ratio = (1 - total_new / total_orig) * 100 if total_orig > 0 else 0.0
        print(
            f"完成：共处理 {len(files)} 个文件 | "
            f"{total_orig / 1024:.1f} KB -> {total_new / 1024:.1f} KB (-{total_ratio:.1f}%)"
        )

    if budget_errors:
        print("\n❌ 素材体积超出预算上限：", file=sys.stderr)
        for msg in budget_errors:
            print(f"  - {msg}", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
