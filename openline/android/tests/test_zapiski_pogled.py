"""Zapiski asistentke na telefonu (lastnik 19. 11. 2026: »zapisek ni urejen«): stevilo v naslovu, datum in ura pri vsakem zapisku."""
import pathlib

POGLED = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/kotlin/si/safeer/lina/asistent/LinaPogovorPogled.kt"


def test_zapiski_imajo_stevilo_in_cas():
    s = POGLED.read_text(encoding="utf-8")
    telo = s.split("private fun osveziZapiske()")[1].split("private fun shraniKljuc")[0]
    assert "zapisekNaslov.text" in telo and "vidni.size" in telo, "stevilo zapiskov v naslovu"
    assert "ofLocalizedDateTime" in telo and "z.cas" in telo, "datum in ura pri zapisku"


RES = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/res"
KOT = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/kotlin/si/safeer/lina"


def test_zapiski_se_zrcalijo_v_dokumente_z_nastavljivo_mapo():
    """Lastnik 19. 11. 2026: zapiski privzeto v Dokumentih, uporabnik si mapo nastavi sam."""
    iz = (KOT / "asistent/ZapiskiIzvoz.kt").read_text(encoding="utf-8")
    assert 'PRIVZETA_MAPA = "Documents/Lina/"' in iz and "MediaStore.Files" in iz, "privzeto Dokumenti prek MediaStore"
    assert "ACTION_OPEN_DOCUMENT_TREE" in iz and "FLAG_GRANT_PERSISTABLE_URI_PERMISSION" in iz, "izbira mape s trajnim dovoljenjem"
    assert 'PREFS = "lina_zapiski_izvoz"' in iz, "nastavitve niso v datoteki s tajnopisi kljucev"
    p = (KOT / "asistent/LinaPogovorPogled.kt").read_text(encoding="utf-8")
    zunaj = p.replace("zapiski.shrani(novi)", "")
    assert "zapiski.shrani(" not in zunaj, "vsak zapis zapiskov mora iti prek shraniZapiske (zrcaljenje v datoteko)"
    assert "obdelajMapo" in p and "ZAHTEVA_MAPA" in (KOT / "DialerActivity.kt").read_text(encoding="utf-8")
    lay = (RES / "layout/activity_dialer.xml").read_text(encoding="utf-8")
    import xml.etree.ElementTree as ET
    ns = "{http://schemas.android.com/apk/res/android}id"
    for e in ET.fromstring(lay).iter():
        if e.get(ns) == "@+id/tabSettings":
            ids = {x.get(ns) for x in e.iter()}
            assert "@+id/notesStorageInfo" in ids and "@+id/notesStoragePick" in ids, "panel zapiskov je v Nastavitvah"
            break
    else:
        raise AssertionError("tabSettings ni najden")
    for mapa in ("values", "values-sl", "values-de", "values-es", "values-fr", "values-it"):
        x = (RES / mapa / "strings.xml").read_text(encoding="utf-8")
        for k in ("notes_storage_title", "notes_storage_info_fmt", "notes_storage_pick", "notes_storage_default", "notes_storage_empty",
                  "notes_storage_ok_fmt", "notes_storage_fail", "notes_storage_no_picker", "notes_file_title", "notes_file_note"):
            assert f'name="{k}"' in x, (mapa, k)
