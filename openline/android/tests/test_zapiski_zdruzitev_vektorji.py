"""Referencna Python izvedba pravil zdruzevanja zapiskov (racunalniska stran) proti skupnim vektorjem.

Isto datoteko bere Kotlin preizkus ZapiskiZdruzitevVektorjiTest; racunalnik (core/os_zapiski.py) mora uporabiti ista pravila.
"""
import json
import pathlib

VEKTORJI = pathlib.Path(__file__).resolve().parent.parent / "skupni-vektorji" / "zapiski-zdruzitev-v1.json"


def zdruzi(a, b):
    mapa = {}
    for z in a + b:
        o = mapa.get(z["id"])
        if o is None:
            mapa[z["id"]] = z
        elif z["cas"] > o["cas"]:
            mapa[z["id"]] = z
        elif z["cas"] == o["cas"]:
            if z["izbrisan"] and not o["izbrisan"]:
                mapa[z["id"]] = z
            elif z["izbrisan"] == o["izbrisan"] and z["besedilo"] > o["besedilo"]:
                mapa[z["id"]] = z
    return sorted(mapa.values(), key=lambda z: z["id"])


def test_zdruzi_ustreza_skupnim_vektorjem_v_obe_smeri():
    primeri = json.loads(VEKTORJI.read_text(encoding="utf-8"))["primeri"]
    assert len(primeri) >= 7
    for p in primeri:
        assert zdruzi(p["a"], p["b"]) == p["pricakovano"], p["ime"]
        assert zdruzi(p["b"], p["a"]) == p["pricakovano"], p["ime"]


def pocisti(seznam, zdaj, rok, najvec_zapiskov, najvec_znakov):
    s = [z for z in seznam if not (z["izbrisan"] and z["cas"] < zdaj - rok)]

    def znakov(l):
        return sum(len(z["besedilo"]) for z in l)  # kodne tocke Unicode, kot Kotlin codePointCount

    while len(s) > najvec_zapiskov or znakov(s) > najvec_znakov:
        nagrobniki = [z for z in s if z["izbrisan"]]
        if not nagrobniki:
            break
        s.remove(min(nagrobniki, key=lambda z: (z["cas"], z["id"])))
    return sorted(s, key=lambda z: z["id"]), len(s) <= najvec_zapiskov and znakov(s) <= najvec_znakov


def test_ciscenje_nagrobnikov_ustreza_skupnim_vektorjem():
    primeri = json.loads(VEKTORJI.read_text(encoding="utf-8"))["ciscenje"]
    assert len(primeri) >= 7
    for p in primeri:
        izhod, ok = pocisti(p["vhod"], p["zdaj"], p["rok"], p["najvecZapiskov"], p["najvecZnakov"])
        assert izhod == p["pricakovano"], p["ime"]
        assert ok == p["sprejeto"], p["ime"]
