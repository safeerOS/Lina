#!/usr/bin/env python3
"""assets/os/teme.json iz assets/os/tokens.css - barve tem v obliki, ki jo bereta QML (Linux) in tema.py (Windows).

tokens.css je EN vir barv Safeer OS (AGENTS.md). Strani WebKit in WebView2 ga berejo neposredno (CSS), Python/QML pa
CSS-ja ne razcleni vsak po svoje: teme.json ima za vsako temo VSE spremenljivke (:root + preglasitve teme, kot jih da
kaskada CSS) in blok kontrasta. Ustvari ga ta skripta; tests/test_teme_json.py pade, ce se datoteka ne ujema s
tokens.css (sprememba barve gre v tokens.css, nato `scripts/teme_json.py`).

Uporaba:  scripts/teme_json.py            - zapise assets/os/teme.json
          scripts/teme_json.py --preveri  - izhod 1, ce se teme.json ne ujema s tokens.css
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

KOREN = Path(__file__).resolve().parents[1]
TOKENI = KOREN / "assets" / "os" / "tokens.css"
TEME = KOREN / "assets" / "os" / "teme.json"
PRIVZETA = "safeer"


def _spremenljivke(telo: str) -> dict:
    return {ime: " ".join(vrednost.split()) for ime, vrednost in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", telo)}


def razcleni(css: str) -> dict:
    """{"privzeta", "teme": {ime: {spremenljivka: vrednost}}, "kontrast": {...}} iz besedila tokens.css."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    osnova: dict = {}
    preglasitve: dict = {}
    kontrast: dict = {}
    for izbirnik, telo in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        izbirniki = [x.strip() for x in izbirnik.split(",")]
        if ":root" in izbirniki:
            osnova.update(_spremenljivke(telo))
        elif ".kontrast" in izbirniki:
            kontrast.update(_spremenljivke(telo))
        else:
            for x in izbirniki:
                m = re.fullmatch(r':root\[data-tema="([a-z0-9-]+)"\]', x)
                if m:
                    preglasitve.setdefault(m.group(1), {}).update(_spremenljivke(telo))
    teme = {PRIVZETA: dict(osnova)}
    for ime, p in preglasitve.items():
        teme[ime] = dict(osnova, **p)
    return {"vir": "assets/os/tokens.css", "privzeta": PRIVZETA, "teme": teme, "kontrast": kontrast}


def besedilo(css: str) -> str:
    return json.dumps(razcleni(css), ensure_ascii=False, indent=1, sort_keys=False) + "\n"


def main(argv: list) -> int:
    novo = besedilo(TOKENI.read_text(encoding="utf-8"))
    if "--preveri" in argv:
        staro = TEME.read_text(encoding="utf-8") if TEME.is_file() else ""
        if staro != novo:
            print("assets/os/teme.json se ne ujema s tokens.css - pozeni scripts/teme_json.py")
            return 1
        print("teme.json: %d tem" % len(razcleni(TOKENI.read_text(encoding="utf-8"))["teme"]))
        return 0
    TEME.write_text(novo, encoding="utf-8")
    print("zapisano", TEME.relative_to(KOREN))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
