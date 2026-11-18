"""📚 가이드 공유 그림(1200×630): 카톡·텔레그램·커뮤니티 미리보기에 글의 핵심 숫자를 크게 보여 준다.
pages.py 가 가이드를 쓸 때 함께 부른다 (데이터 가이드는 매주 숫자와 함께 다시 그림). 글꼴·색은 og.py 와 같다.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from og import ACCENT, BG, BORDER, CARD, MUTED, TEXT, W, H, bitcoin_logo, font


def _lines(d: ImageDraw.ImageDraw, text: str, f, width: int, most: int) -> list[str]:
    """글자 폭을 재며 줄을 나눈다 (한국어는 띄어쓰기 단위, 너무 길면 글자 단위)."""
    out, cur = [], ""
    for word in text.split(" "):
        test = (cur + " " + word).strip()
        if d.textlength(test, font=f) <= width:
            cur = test
            continue
        if cur:
            out.append(cur)
        cur = word
        while d.textlength(cur, font=f) > width:   # 한 단어가 너무 길면 자른다
            cut = len(cur)
            while cut > 1 and d.textlength(cur[:cut], font=f) > width:
                cut -= 1
            out.append(cur[:cut])
            cur = cur[cut:]
    if cur:
        out.append(cur)
    if len(out) > most:
        out = out[:most]
        while d.textlength(out[-1] + "…", font=f) > width and len(out[-1]) > 1:
            out[-1] = out[-1][:-1]
        out[-1] += "…"
    return out


def draw(path: Path, title: str, big: str | None = None, big_label: str = "", note: str = "") -> None:
    """title: 글 제목 · big: 크게 박을 숫자(없으면 제목을 크게) · big_label: 숫자 설명 · note: 아래 한 줄."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([32, 32, W - 32, H - 32], radius=28, fill=CARD, outline=BORDER, width=2)
    bitcoin_logo(d, 100, 100, 34)
    d.text((152, 100), "BTC Agent", font=font(40, "Bold"), fill=ACCENT, anchor="lm")
    d.text((W - 72, 100), "매매 가이드", font=font(32, "Medium"), fill=MUTED, anchor="rm")

    if big:
        ft = font(44, "Bold")
        y = 170
        for line in _lines(d, title, ft, W - 144, 2):
            d.text((72, y), line, font=ft, fill=TEXT)
            y += 60
        fb = font(120, "Bold")
        while d.textlength(big, font=fb) > W - 144 and fb.size > 60:
            fb = font(fb.size - 8, "Bold")
        d.text((72, y + 24), big, font=fb, fill=ACCENT)
        bottom = d.textbbox((72, y + 24), big, font=fb)[3]   # 실제 글자 아래 끝 (겹치지 않게)
        fl = font(34, "Medium")
        for i, line in enumerate(_lines(d, big_label, fl, W - 144, 2)):
            d.text((72, bottom + 28 + i * 46), line, font=fl, fill=MUTED)
    else:
        ft = font(64, "Bold")
        y = 190
        for line in _lines(d, title, ft, W - 144, 3):
            d.text((72, y), line, font=ft, fill=TEXT)
            y += 86
        if big_label:
            fl = font(32, "Medium")
            for line in _lines(d, big_label, fl, W - 144, 2):
                d.text((72, y + 16), line, font=fl, fill=MUTED)
                y += 44

    d.text((72, 572), note or "btc.rudals.app · 공식과 실제 데이터로 정리 · 투자 권유 아님", font=font(24), fill=MUTED, anchor="lm")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
