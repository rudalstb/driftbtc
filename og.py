"""공유 미리보기 이미지(카톡·텔레그램 등) 생성: site/og.png (1200×630)

site/data/forecast.json 의 최신 예측으로 현재가, 1시간·1일 예상 움직임, 최근 48시간 가격 선을 그린다.
매시간 예측 갱신 뒤 실행한다. 글꼴: Noto Sans KR (SIL Open Font License, assets/fonts/OFL.txt)

사용법:
    python og.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
FONT = ROOT / "assets" / "fonts" / "NotoSansKR.ttf"
OUT = ROOT / "site" / "og.png"  # 저장소에는 넣지 않고 배포에만 포함 (.gitignore)
W, H = 1200, 630

BG = (13, 17, 23)
CARD = (22, 27, 34)
BORDER = (38, 44, 54)
TEXT = (230, 237, 243)
MUTED = (139, 148, 158)
ACCENT = (247, 147, 26)
UP = (63, 185, 80)


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_name(weight)
    return f


def bitcoin_logo(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int) -> None:
    # 글꼴에 ₿ 문자가 없어서 B 와 위아래 짧은 세로선 두 개로 그린다
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
    f = font(int(r * 1.25), "Bold")
    d.text((cx + 2, cy + 1), "B", font=f, fill="white", anchor="mm")
    for dx in (-5, 5):
        x = cx + dx
        d.line([(x, cy - r * 0.78), (x, cy - r * 0.52)], fill="white", width=4)
        d.line([(x, cy + r * 0.52), (x, cy + r * 0.78)], fill="white", width=4)


def sparkline(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], values: list[float], lo_band: list[float], hi_band: list[float]) -> None:
    x0, y0, x1, y1 = box
    lo, hi = min(values + lo_band), max(values + hi_band)
    pad = (hi - lo) * 0.08 or 1
    lo, hi = lo - pad, hi + pad
    n = len(values)
    xs = [x0 + (x1 - x0) * i / (n - 1) for i in range(n)]
    y = lambda v: y1 - (v - lo) / (hi - lo) * (y1 - y0)
    # 과거 예측 범위(옅은 띠)
    band = [(xs[i], y(hi_band[i])) for i in range(n)] + [(xs[i], y(lo_band[i])) for i in reversed(range(n))]
    d.polygon(band, fill=(48, 54, 64))
    d.line([(xs[i], y(values[i])) for i in range(n)], fill=TEXT, width=4, joint="curve")
    d.ellipse([xs[-1] - 8, y(values[-1]) - 8, xs[-1] + 8, y(values[-1]) + 8], fill=ACCENT)


def main() -> None:
    f = json.loads((ROOT / "site" / "data" / "forecast.json").read_text(encoding="utf-8"))
    h1, d1 = f["forecasts"]["1h"], f["forecasts"]["1d"]
    price = h1["price"]
    move1h = h1["next"]["hi68"] - price
    pct1h = (h1["next"]["hi68"] / price - 1) * 100
    pct1d = (d1["next"]["hi68"] / d1["price"] - 1) * 100
    kst = datetime.fromisoformat(f["generated_at"]).astimezone(timezone(timedelta(hours=9)))

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 머리글
    bitcoin_logo(d, 92, 92, 34)
    d.text((142, 92), "DriftBTC", font=font(46, "Bold"), fill=ACCENT, anchor="lm")
    d.text((64, 160), "비트코인이 어디까지 움직일 수 있는지 예측합니다", font=font(30, "Medium"), fill=MUTED)

    # 현재가와 예상 움직임
    d.text((64, 222), "BTC/USDT", font=font(26, "Medium"), fill=MUTED)
    d.text((60, 250), f"${price:,.0f}", font=font(96, "Bold"), fill=TEXT)
    d.text((64, 392), "1시간 안에 보통", font=font(30, "Medium"), fill=MUTED)
    d.text((64, 432), f"±${move1h:,.0f} (±{pct1h:.2f}%)", font=font(44, "Bold"), fill=UP)
    d.text((64, 500), f"하루 기준 ±{pct1d:.1f}%", font=font(28, "Medium"), fill=MUTED)

    # 오른쪽: 최근 48시간 가격과 과거 예측 범위
    d.rounded_rectangle([640, 222, 1140, 540], radius=18, fill=CARD, outline=BORDER, width=2)
    d.text((664, 244), "최근 48시간", font=font(24, "Medium"), fill=MUTED)
    hist = h1["history"][-48:]
    sparkline(d, (670, 300, 1110, 515), [x["actual"] for x in hist], [x["lo95"] for x in hist], [x["hi95"] for x in hist])

    # 바닥글
    d.text((64, 580), f"{kst:%m/%d %H:%M} KST 기준 · 매시간 갱신", font=font(24), fill=MUTED, anchor="lm")
    d.text((1140, 580), "실시간 가격 · 예측 범위 · 실전 포지션", font=font(24, "Medium"), fill=MUTED, anchor="rm")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"미리보기 이미지 저장: {OUT} ({OUT.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
