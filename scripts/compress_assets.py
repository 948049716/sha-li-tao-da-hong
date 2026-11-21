#!/usr/bin/env python3
"""
《沙里淘大红》美术素材本地自动压缩脚本（基于 Pillow，无外部 API 额度限制）
项目规范：所有通过 ComfyUI 或外部引入的生成素材，必须经过本脚本压缩后方可入库使用。

用法：
  # 压缩单个文件（原地覆盖）
  python3 scripts/compress_assets.py docs/assets/cover.jpg

  # 压缩单个文件到指定输出路径
  python3 scripts/compress_assets.py /tmp/raw.png -o docs/assets/icon.png

  # 批量压缩目录下所有图片（原地覆盖）
  python3 scripts/compress_assets.py docs/assets/

  # 指定 JPEG/WebP 质量（默认 85）
  python3 scripts/compress_assets.py docs/assets/ --quality 82
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("错误：未安装 Pillow，请先执行 `pip install Pillow`", file=sys.stderr)
    sys.exit(1)

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def compress_file(src: Path, dst: Path, quality: int = 85) -> tuple[int, int]:
    orig_bytes = src.read_bytes()
    orig_size = len(orig_bytes)
    ext = dst.suffix.lower() or src.suffix.lower()

    with Image.open(io.BytesIO(orig_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        buf = io.BytesIO()

        if ext in {".jpg", ".jpeg"}:
            if img.mode in {"RGBA", "LA", "P"}:
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        elif ext == ".png":
            img.save(buf, format="PNG", optimize=True, compress_level=9)
        elif ext == ".webp":
            img.save(buf, format="WEBP", quality=quality, method=6)
        else:
            raise ValueError(f"不支持的图片格式：{ext}")

    compressed_bytes = buf.getvalue()
    dst.parent.mkdir(parents=True, exist_ok=True)

    # 若压缩后反而变大（如已极限压缩过的图片），且源与目标格式一致，则保留更小体积的版本
    if len(compressed_bytes) >= orig_size and src.suffix.lower() == ext:
        dst.write_bytes(orig_bytes)
        print(f"[KEEP] {src} -> {dst} | 已是最优体积 ({orig_size / 1024:.1f} KB)")
        return orig_size, orig_size

    dst.write_bytes(compressed_bytes)
    new_size = len(compressed_bytes)
    ratio = (1 - new_size / orig_size) * 100 if orig_size > 0 else 0.0
    print(f"[OK] {src} -> {dst} | {orig_size / 1024:.1f} KB -> {new_size / 1024:.1f} KB (-{ratio:.1f}%)")
    return orig_size, new_size


def main() -> int:
    parser = argparse.ArgumentParser(description="使用本地 Pillow 工具压缩项目美术素材")
    parser.add_argument("target", help="待压缩的图片文件或目录路径")
    parser.add_argument("-o", "--output", help="输出文件路径（仅对单文件生效，省略则原地覆盖）")
    parser.add_argument("-q", "--quality", type=int, default=85, help="JPEG/WebP 压缩质量 1-95（默认 85）")
    args = parser.parse_args()

    target = Path(args.target)
    if not target.exists():
        print(f"错误：路径不存在：{target}", file=sys.stderr)
        return 1

    if target.is_file():
        dst = Path(args.output) if args.output else target
        compress_file(target, dst, quality=args.quality)
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
            o, n = compress_file(f, f, quality=args.quality)
            total_orig += o
            total_new += n
        total_ratio = (1 - total_new / total_orig) * 100 if total_orig > 0 else 0.0
        print(
            f"完成：共处理 {len(files)} 个文件 | "
            f"{total_orig / 1024:.1f} KB -> {total_new / 1024:.1f} KB (-{total_ratio:.1f}%)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
