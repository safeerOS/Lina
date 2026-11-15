"""Manifest Line: dovoljenja LINK ne definira (T4-2, 15. 11. 2026) - definira ga Safeer; Lina ga samo uporablja.
Brez popravka (element <permission> z istim imenom) preizkus pade: dvojna definicija z drugim certifikatom zlomi namestitev."""
import re
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "AndroidManifest.xml"
IME = "si.safeer.tv.permission.LINK"


def _brez_komentarjev() -> str:
    return re.sub(r"<!--.*?-->", "", MANIFEST.read_text(encoding="utf-8"), flags=re.S)


def test_lina_ne_definira_dovoljenja_safeer():
    m = _brez_komentarjev()
    definicije = re.findall(r"<permission\b[^>]*>", m)
    assert not [d for d in definicije if "si.safeer." in d], definicije


def test_lina_dovoljenje_uporablja():
    assert re.search(r'<uses-permission[^>]*android:name="%s"' % re.escape(IME), _brez_komentarjev())


def test_gradle_brez_kljucev_za_podpis():
    g = (MANIFEST.parents[2] / "build.gradle.kts").read_text(encoding="utf-8")
    assert not re.search(r"storePassword|keyPassword|keystore", g, re.I), "kljuci in gesla ne sodijo v build.gradle.kts"
