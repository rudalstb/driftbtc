"""📦 배포본 다듬기 (GitHub Actions 에서만 실행, 저장소 파일은 그대로):
site/index.html 의 스크립트 7개를 bundle.js 하나로 합치고, 브라우저 캐시를 피하도록 커밋 버전을 붙인다.

    python bundle.py <버전문자열>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SITE = Path(__file__).parent / "site"


def main(version: str) -> None:
    index = SITE / "index.html"
    html = index.read_text(encoding="utf-8")
    names = re.findall(r'<script src="([a-z0-9]+\.js)"></script>', html)
    if not names:
        raise SystemExit("합칠 스크립트 태그를 못 찾음")
    bundle = "\n;\n".join(f"// ===== {n} =====\n" + (SITE / n).read_text(encoding="utf-8") for n in names)
    (SITE / "bundle.js").write_text(bundle, encoding="utf-8", newline="\n")
    tags = "".join(f'  <script src="{n}"></script>\n' for n in names)
    if tags not in html:
        raise SystemExit("스크립트 태그 묶음이 연속으로 있지 않음")
    html = html.replace(tags, f'  <script src="bundle.js?v={version}"></script>\n')
    html = html.replace('href="style.css"', f'href="style.css?v={version}"')
    index.write_text(html, encoding="utf-8", newline="\n")
    print(f"합친 파일: {names} → bundle.js {(SITE / 'bundle.js').stat().st_size:,} 바이트, 버전 {version}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dev")
