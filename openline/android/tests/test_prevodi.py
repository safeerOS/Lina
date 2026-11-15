"""Doslednost besedil vmesnika Lina (Android): vsi kljuci v vseh jezikih.

Brez Gradla: samo branje res/values*/strings.xml. Zagon:
  python3 -m pytest -q -p no:cacheprovider openline/android/tests/test_prevodi.py
ali  python3 openline/android/tests/test_prevodi.py
Preizkus pade, ce v katerem jeziku kljuc manjka ali je odvec, je vrednost prazna,
se placeholderji (%s, %1$s, %d ...) ne ujemajo z izvirnikom (values/ = en),
je v vrednosti neubezen ' ali " (aapt zavrne) ali jezik ni v AppLocale in izbirniku.
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

RES = Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "res"
KOTLIN = Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "kotlin" / "si" / "safeer" / "lina"
# jezik -> mapa virov. en je privzeti (values/), ostali values-<koda>.
JEZIKI = {"en": "values", "sl": "values-sl", "de": "values-de", "es": "values-es",
          "fr": "values-fr", "it": "values-it"}
PLACEHOLDER = re.compile(r"%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z%]")
# ' ali " brez predhodnega \ (Android jih mora imeti ubezne)
NEUBEZEN = re.compile(r"(?<!\\)['\"]")


def nalozi(jezik):
    pot = RES / JEZIKI[jezik] / "strings.xml"
    assert pot.is_file(), f"manjka {pot}"
    out = {}
    for el in ET.parse(pot).getroot():
        if el.tag != "string":
            continue
        ime = el.get("name")
        assert ime not in out, f"{jezik}: podvojen kljuc {ime}"
        out[ime] = el.text or ""
        # strings.xml tega repozitorija nima notranjih oznak; ce se pojavijo, jih preberi cele
        if len(el):
            out[ime] = ET.tostring(el, encoding="unicode")
    return out


def placeholderji(vrednost):
    # %% je dobesedni %, ne placeholder
    return sorted(p for p in PLACEHOLDER.findall(vrednost) if p != "%%")


def vsi():
    return {j: nalozi(j) for j in JEZIKI}


def preveri():
    napake = []
    nizi = vsi()
    izvor = nizi["en"]
    for jezik, vrednosti in nizi.items():
        for k in sorted(set(izvor) - set(vrednosti)):
            napake.append(f"{jezik}: manjka kljuc {k}")
        for k in sorted(set(vrednosti) - set(izvor)):
            napake.append(f"{jezik}: odvec kljuc {k}")
        for k, v in vrednosti.items():
            if not v.strip():
                napake.append(f"{jezik}: prazna vrednost {k}")
            if NEUBEZEN.search(v):
                napake.append(f"{jezik}: neubezen ' ali \" v {k}")
            if k in izvor and placeholderji(v) != placeholderji(izvor[k]):
                napake.append(f"{jezik}: placeholderji {k}: {placeholderji(v)} != {placeholderji(izvor[k])}")
    return napake


def test_vsi_kljuci_placeholderji_brez_praznih():
    napake = preveri()
    assert not napake, "\n".join(napake)


def test_jeziki_v_applocale_in_izbirniku():
    app_locale = (KOTLIN / "AppLocale.kt").read_text(encoding="utf-8")
    dialer = (KOTLIN / "DialerActivity.kt").read_text(encoding="utf-8")
    imena = {"en": "language_english", "sl": "language_slovenian", "de": "language_german",
             "es": "language_spanish", "fr": "language_french", "it": "language_italian"}
    for jezik in JEZIKI:
        assert f'"{jezik}"' in app_locale, f"AppLocale nima jezika {jezik}"
        assert f"R.string.{imena[jezik]}" in dialer, f"izbirnik jezika nima {jezik}"
        assert f"name=\"{imena[jezik]}\"" in (RES / "values" / "strings.xml").read_text(encoding="utf-8")


def test_preizkus_res_pade_ce_kljuc_manjka(tmp_path=None):
    """Samokontrola: preverjanje res zazna manjkajoc kljuc (mutacija v pomnilniku)."""
    nizi = vsi()
    nizi["de"].pop("call_failed")
    nizi["fr"]["call"] = ""
    nizi["es"]["online_at"] = "En línea"
    izvor = nizi["en"]
    zaznano = []
    for jezik, v in nizi.items():
        zaznano += [k for k in izvor if k not in v]
        zaznano += [k for k, x in v.items() if not x.strip()]
        zaznano += [k for k, x in v.items() if k in izvor and placeholderji(x) != placeholderji(izvor[k])]
    assert {"call_failed", "call", "online_at"} <= set(zaznano)


if __name__ == "__main__":
    n = preveri()
    print("\n".join(n) if n else "OK: %d jezikov, %d kljucev" % (len(JEZIKI), len(nalozi("en"))))
    sys.exit(1 if n else 0)
