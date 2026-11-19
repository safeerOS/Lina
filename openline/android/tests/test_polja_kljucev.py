"""Vnosna polja za kljuce, ustvarjena v kodi, morajo biti fokusabilna z dotikom (lastnik 18. 11. 2026: kljucev ni mogel vpisati)."""
import pathlib
import re

POGLED = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/kotlin/si/safeer/lina/asistent/NastavitveKljuciPogled.kt"


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
    # gumb vodi nazaj na zavihek, iz katerega so bile odprte Nastavitve
    assert "showTab(zavihekPred) })" in (KOT / "DialerActivity.kt").read_text(encoding="utf-8")
    sp = (KOT / "asistent/LinaPogovorPogled.kt").read_text(encoding="utf-8")
    assert "assistantBackToAssistant" in sp and "nazaj()" in sp


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


def _potomci_z_id(id_):
    """Ids vseh pogledov znotraj elementa z danim id v postavitvi (lastnik 19. 11. 2026)."""
    import xml.etree.ElementTree as ET
    ns = "{http://schemas.android.com/apk/res/android}id"
    koren = ET.parse(RES / "layout/activity_dialer.xml").getroot()
    for e in koren.iter():
        if e.get(ns) == "@+id/" + id_:
            return {x.get(ns, "").replace("@+id/", "") for x in e.iter()}
    raise AssertionError("ni elementa " + id_)


def test_zavihek_lina_je_pogovor_kljuci_so_v_nastavitvah():
    """Lastnik 19. 11. 2026: v zavihku Lina mora biti pogovor z Lino, vnos kljucev pa v Nastavitvah (ne pod Lino)."""
    lina = _potomci_z_id("tabLina")
    assert {"assistantChatBlock", "assistantChatInput", "assistantChatSend"} <= lina, "pogovor je v zavihku Lina"
    assert not ({"assistantKeyInput", "assistantToolsList", "assistantSetupPanel"} & lina), "kljuci niso pod Lino"
    nast = _potomci_z_id("tabSettings")
    assert {"assistantSetupPanel", "assistantKeyInput", "assistantToolsList", "saveLinaButton", "assistantBackToAssistant"} <= nast
    assert "assistantChatBlock" not in nast
    assert "assistantProviderRow" in nast, "izbira ponudnika je del Nastavitev > Kljuci (lastnik 19. 11. 2026)"
    # gumb Nastavitve je v glavi (zunaj zavihkov), z njim se Nastavitve odprejo z vsakega zaslona
    for z in ("tabCalls", "tabPhone", "tabLina", "tabComputer", "tabSettings"):
        assert "openSettings" not in _potomci_z_id(z), z
    assert "@+id/openSettings" in (RES / "layout/activity_dialer.xml").read_text(encoding="utf-8")
    dej = (KOT / "DialerActivity.kt").read_text(encoding="utf-8")
    assert "R.id.openSettings" in dej and "Zavihek.NASTAVITVE" in dej
    assert "showTab(Zavihek.NASTAVITVE)" in dej.split("private fun odpriNastavitveKljucev()")[1].split("}")[0]


def test_nova_besedila_v_vseh_jezikih():
    for mapa in ("values", "values-sl", "values-de", "values-es", "values-fr", "values-it"):
        x = (RES / mapa / "strings.xml").read_text(encoding="utf-8")
        for k in ("settings_title", "lina_chat_title", "assistant_providers_note", "assistant_provider_ready_fmt",
                  "assistant_provider_missing_fmt", "assistant_key_provider_fmt"):
            assert f'name="{k}"' in x, (mapa, k)
        assert "(zavihek Lina)" not in x and "(Lina tab)" not in x, mapa
