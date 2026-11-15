"""Manifest Line: dovoljenja OZJI_KROG ne definira in LINK ne napove (T4-2/T4-1, 15. 11. 2026) - definira ga Safeer; Lina ga samo uporablja.
Brez popravka (element <permission> z istim imenom) preizkus pade: dvojna definicija z drugim certifikatom zlomi namestitev."""
import re
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "AndroidManifest.xml"
IME = "si.safeer.tv.permission.OZJI_KROG"
LINK = "si.safeer.tv.permission.LINK"


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


def test_lina_ne_napove_link():
    """T4-1: LINK varuje LinkSorodnikStoritev, SpletnePonudnik in Scit; z njim bi Lina dosegla poti, ki jih ne sme."""
    m = _brez_komentarjev()
    assert LINK not in m, "Lina ne sme napovedati LINK; samo OZJI_KROG"


def test_besedila_kroga_so_postena():
    """T4-3: clanstvo je vpis v krog zaupanja Safeer Linka, ne "ozji krog" z dostopom; gumb je enak kot v Safeerju."""
    res = MANIFEST.parent / "res"
    pricakovan = {"values": "Connect Lina", "values-sl": "Poveži Lino", "values-de": "Lina verbinden",
                  "values-es": "Conectar a Lina", "values-fr": "Connecter Lina", "values-it": "Collega Lina"}
    for mapa, gumb in pricakovan.items():
        t = (res / mapa / "strings.xml").read_text(encoding="utf-8")
        assert re.search(r'<string name="circle_confirm">%s</string>' % re.escape(gumb), t), mapa
        for k in ("circle_confirm", "circle_done"):
            v = re.search(r'<string name="%s">([^<]*)<' % k, t).group(1).lower()
            assert not re.search(r"ožj|inner circle|engeren|cercano|proche|ristretta", v), (mapa, k, v)
