"""📅 시장 일지 공유 그림(1200×630): 그날 숫자가 박힌 카톡·텔레그램 미리보기. daily.py 가 일지를 만들 때 함께 부른다.

어제 예측 채점(적중 / 95% 범위 안 / 빗나감), 어제 등락, 오늘 68% 범위. 글꼴·색은 og.py 와 같다.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from og import ACCENT, BG, BORDER, CARD, MUTED, TEXT, UP, W, H, bitcoin_logo, font

DOWN = (248, 81, 73)
YELLOW = (210, 153, 34)


def draw(path: Path, date_label: str, scored: str | None, chg: float, open_: float, close: float, lo68: float, hi68: float) -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([32, 32, W - 32, H - 32], radius=28, fill=CARD, outline=BORDER, width=2)
    bitcoin_logo(d, 100, 100, 34)
    d.text((152, 100), "BTC Agent", font=font(40, "Bold"), fill=ACCENT, anchor="lm")
    d.text((W - 72, 100), f"시장 일지 · {date_label}", font=font(32, "Medium"), fill=MUTED, anchor="rm")

    # 어제 예측 채점 — 가장 크게
    color, mark = {"적중": (UP, "O"), "95% 범위 안": (YELLOW, "△"), "빗나감": (DOWN, "X")}.get(scored or "", (MUTED, "-"))
    d.ellipse([72, 178, 172, 278], outline=color, width=8)
    if mark == "O":      # 글꼴 글자 대신 직접 그린 체크
        d.line([(100, 230), (117, 248), (147, 208)], fill=color, width=10, joint="curve")
    elif mark == "X":
        d.line([(102, 208), (142, 248)], fill=color, width=10)
        d.line([(142, 208), (102, 248)], fill=color, width=10)
    else:
        d.text((122, 226), mark, font=font(56, "Bold"), fill=color, anchor="mm")
    d.text((200, 196), "어제 예측", font=font(34, "Medium"), fill=MUTED)
    d.text((196, 232), scored or "채점 없음", font=font(68, "Bold"), fill=color)

    # 어제 하루
    d.text((72, 345), "어제 하루", font=font(30, "Medium"), fill=MUTED)
    d.text((72, 380), f"{'+' if chg > 0 else ''}{chg:.2f}%", font=font(64, "Bold"), fill=UP if chg >= 0 else DOWN)
    d.text((72, 466), f"${open_:,.0f} → ${close:,.0f}", font=font(30, "Medium"), fill=TEXT)

    # 오늘 범위
    d.rounded_rectangle([620, 330, W - 72, 520], radius=20, outline=ACCENT, width=3)
    d.text((652, 352), "오늘 예측 범위 (68%)", font=font(30, "Medium"), fill=MUTED)
    d.text((652, 400), f"${lo68:,.0f}", font=font(52, "Bold"), fill=TEXT)
    d.text((652, 462), f"~ ${hi68:,.0f}", font=font(40, "Bold"), fill=TEXT)

    d.text((72, 572), "btc.rudals.app · 매일 아침 자동 채점 · 투자 권유 아님", font=font(24), fill=MUTED, anchor="lm")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
