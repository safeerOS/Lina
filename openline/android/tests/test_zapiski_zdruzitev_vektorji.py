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
