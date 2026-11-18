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


RES = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/res"
KOT = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/kotlin/si/safeer/lina"


def test_pot_nazaj_na_asistenta_po_vnosu_kljucev():
    """Lastnik 19. 11. 2026: po vnosu kljucev Brave/TinyFish ni bilo enostavne poti nazaj na Asistenta (tipkovnica zakrije navigacijo)."""
    # besedilo gumba v vseh jezikih, ki jih aplikacija ima
    for mapa in ("values", "values-sl", "values-de", "values-es", "values-fr", "values-it"):
        assert 'name="assistant_back"' in (RES / mapa / "strings.xml").read_text(encoding="utf-8"), mapa
    # gumb na koncu nastavitev
    assert "@+id/assistantBackToAssistant" in (RES / "layout/activity_dialer.xml").read_text(encoding="utf-8")
    # samo en gumb (spodaj; lastnik 19. 11. 2026), ne pod vsakim kljucem; tipkovnica se po uspesnem shranjevanju zapre
    op = POGLED.read_text(encoding="utf-8")
    assert "assistant_back" not in op, "gumb Nazaj je samo en, na koncu nastavitev"
    assert "hideSoftInputFromWindow" in op, "tipkovnica se mora po uspesnem shranjevanju zapreti"
    # povezava do zavihka Asistent v dejavnosti
    assert "showTab(Zavihek.ASISTENT) })" in (KOT / "DialerActivity.kt").read_text(encoding="utf-8")
    sp = (KOT / "asistent/SamostojniPogled.kt").read_text(encoding="utf-8")
    assert "assistantBackToAssistant" in sp and "nazajNaAsistenta" in sp


def test_pozabi_racunalnik_ne_zbrise_kljucev():
    """Lastnik 19. 11. 2026: kljuci Brave/TinyFish so izginili. AsistentShramba hrani seznanitev v isti datoteki kot tajnopise kljucev."""
    sh = (KOT / "asistent/AsistentShramba.kt").read_text(encoding="utf-8")
    telo = re.search(r"fun pozabi\(context: Context\): Boolean =(.*?)\n\n|fun pozabi\(context: Context\): Boolean =(.*)$", sh, re.S)
    assert telo, "funkcija pozabi ni najdena"
    koda = telo.group(0)
    assert ".clear()" not in koda, "clear() bi zbrisal tudi tajnopise kljucev v isti datoteki"
    for k in ("naslov", "vrata", "odtis"):
        assert f'.remove("{k}")' in koda, k
    # datoteka nastavitev je ista kot pri kljucih: razlog za prepoved clear()
    assert 'PREFS = "lina_asistent"' in sh
    assert 'SHRAMBA = "lina_asistent"' in (KOT / "asistent/SamostojniAndroid.kt").read_text(encoding="utf-8")
