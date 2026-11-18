"""Vnosna polja za kljuce, ustvarjena v kodi, morajo biti fokusabilna z dotikom (lastnik 18. 11. 2026: kljucev ni mogel vpisati)."""
import pathlib
import re

POGLED = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/kotlin/si/safeer/lina/asistent/OrodjaPogled.kt"


def test_polja_za_kljuce_so_fokusabilna_z_dotikom():
    s = POGLED.read_text(encoding="utf-8")
    bloki = re.findall(r"EditText\(a, null, 0, [^)]*\)\.apply \{(.*?)\n            \}", s, re.S)
    assert bloki, "polje EditText ni najdeno"
    for b in bloki:
        assert "isFocusableInTouchMode = true" in b, "EditText z defStyleAttr 0 mora izrecno nastaviti isFocusableInTouchMode"
