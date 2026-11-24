"""Preizkus natancnosti kontrole tiska na sinteticnih slikah z znano resnico (prenos iz prototipa vid-kontrola-tiska-1510).
Izpise JSON in ga zapise v <izhodna_mapa>/rezultati.json. Pragi so isti kot v prototipu; dodana sta preizkusa
»prvi kos« (referenca = fotografija odobrenega kosa) in »PDF oznak« (natisnjene oznake se zaznajo s pravim id).

Raba: python -B -I kontrola_tiska_preizkus.py [stevilo_ponovitev] [izhodna_mapa]
Konec z izhodno kodo 1, ce kateri koli prag sprejemljivosti (na dnu) ni izpolnjen.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I izpusti mapo skripte
import kontrola_tiska as mt  # noqa: E402
import kontrola_tiska_sinteticno as sn  # noqa: E402

ENA = {"0": [0.0, -40.0, 50.0]}
STIRI = {"0": [0.0, -40.0, 50.0], "1": [-200.0, 100.0, 50.0], "2": [200.0, 100.0, 50.0], "3": [0.0, 460.0, 50.0]}
RUMENA = (30, 200, 240)


def nastavitve(oznake):
    n = mt.nalozi_nastavitve(None)
    n["oznake"] = oznake
    n["obmocje_mm"] = list(sn.OBMOCJE)
    return n


def en_poskus(motiv, oznake, seme, **napake):
    rng = np.random.default_rng(seme)
    zg = (float(rng.uniform(-8, 8)), 75.0 + float(rng.uniform(-8, 8)))
    zas = float(rng.uniform(-3, 3))
    sir = 250.0 + float(rng.uniform(-6, 6))
    pl, res = sn.ravnina(motiv, oznake, zg, zas, sir, seme=seme, **napake)
    foto = sn.fotografiraj(pl, seme=seme + 1000)
    izid, slika = mt.izmeri(foto, motiv, nastavitve(oznake))
    return izid, res, slika, foto


def napaka_polozaja(izid, res):
    p = izid["polozaj"]
    return (p["zgoraj_sredina_mm"][0] - res["zg_sredina_mm"][0], p["zgoraj_sredina_mm"][1] - res["zg_sredina_mm"][1],
            p["zasuk_deg"] - res["zasuk_deg"], p["sirina_mm"] - res["sirina_mm"])


def zadet(napake, x, y, rob=6.0):
    for n in napake:
        a, b, w, h = n["okvir_mm"]
        if a - rob <= x <= a + w + rob and b - rob <= y <= b + h + rob:
            return True
    return False


def main():
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    izh = sys.argv[2] if len(sys.argv) > 2 else "rezultati"
    os.makedirs(izh, exist_ok=True)
    motiv = sn.motiv()
    cv2.imwrite(os.path.join(izh, "motiv.png"), motiv)
    porocilo = {"N": N}
    for ime, oznake in (("ena_oznaka", ENA), ("stiri_oznake", STIRI)):
        e = []
        lazni = 0
        for i in range(N):
            izid, res, slika, foto = en_poskus(motiv, oznake, seme=100 + i)
            if "polozaj" not in izid:
                e.append(None)
                continue
            e.append(napaka_polozaja(izid, res))
            lazni += len(izid["napake"])
            if i == 0:
                cv2.imwrite(os.path.join(izh, f"{ime}_foto.jpg"), foto)
                cv2.imwrite(os.path.join(izh, f"{ime}_oznaceno.png"), slika)
        ok = np.array([x for x in e if x is not None])
        porocilo[ime] = {
            "izmerjenih": int(len(ok)),
            "x_mm_abs_povp": round(float(np.abs(ok[:, 0]).mean()), 3), "x_mm_abs_max": round(float(np.abs(ok[:, 0]).max()), 3),
            "y_mm_abs_povp": round(float(np.abs(ok[:, 1]).mean()), 3), "y_mm_abs_max": round(float(np.abs(ok[:, 1]).max()), 3),
            "zasuk_deg_abs_povp": round(float(np.abs(ok[:, 2]).mean()), 4), "zasuk_deg_abs_max": round(float(np.abs(ok[:, 2]).max()), 4),
            "sirina_mm_abs_povp": round(float(np.abs(ok[:, 3]).mean()), 3), "sirina_mm_abs_max": round(float(np.abs(ok[:, 3]).max()), 3),
            "lazne_napake_na_cistih": lazni,
        }

    # Napake: madez, manjkajoc del, zamik plasti, barvni premik (stiri oznake)
    nap = {"madez_najden": 0, "madez_zunaj_najden": 0, "manjkajoce_najdeno": 0, "registracija_mm": [], "barvni_premik_dE": []}
    for i in range(N):
        s = 500 + i
        izid, res, slika, _ = en_poskus(motiv, STIRI, s, madezi=[(-58.0, 195.0, 3.0, (60, 70, 80)), (-140.0, 150.0, 3.0, (90, 90, 120))],
                                         manjkajoce=[(600, 300, 60, 40)])
        if "polozaj" not in izid:
            continue
        mx, my, _ = res["madezi_mm"][0]
        nap["madez_najden"] += zadet(izid["napake"], mx, my)
        mx, my, _ = res["madezi_mm"][1]
        nap["madez_zunaj_najden"] += zadet(izid["napake"], mx, my)
        cx, cy = res["manjkajoce_mm"][0]
        nap["manjkajoce_najdeno"] += zadet(izid["napake"], cx, cy)
        if i == 0:
            cv2.imwrite(os.path.join(izh, "napake_oznaceno.png"), slika)
            json.dump(izid, open(os.path.join(izh, "napake_izid.json"), "w"), ensure_ascii=False, indent=1)
        izid, res, slika, _ = en_poskus(motiv, STIRI, s + 50, zamik_plasti=(RUMENA, 1.5, 0.0))
        r = [p for p in izid.get("registracija", {}).get("plasti", []) if p["barva_srgb"] == list(RUMENA[::-1])]
        if r:
            nap["registracija_mm"].append(r[0]["glede_na_kljucno_mm"])
        if i == 0:
            cv2.imwrite(os.path.join(izh, "zamik_plasti_oznaceno.png"), slika)
            json.dump(izid, open(os.path.join(izh, "zamik_plasti_izid.json"), "w"), ensure_ascii=False, indent=1)
        izid, *_ = en_poskus(motiv, STIRI, s + 80, barvni_premik=12.0)
        nap["barvni_premik_dE"].append(izid.get("barva", {}).get("dE00_povprecje"))
    porocilo["napake"] = nap
    reg = np.array(nap["registracija_mm"]) if nap["registracija_mm"] else np.zeros((0, 2))
    porocilo["registracija_napaka_mm_povp"] = round(float(np.abs(reg[:, 0] - 1.5).mean()), 3) if len(reg) else None

    # Pragi sprejemljivosti prototipa (domneva; prave tolerance doloci podjetje)
    s4 = porocilo["stiri_oznake"]
    pogoji = {
        "polozaj_4_oznake_max_pod_1mm": max(s4["x_mm_abs_max"], s4["y_mm_abs_max"]) < 1.0,
        "zasuk_4_oznake_max_pod_0.2deg": s4["zasuk_deg_abs_max"] < 0.2,
        "brez_laznih_napak": porocilo["ena_oznaka"]["lazne_napake_na_cistih"] + s4["lazne_napake_na_cistih"] == 0,
        "vsi_madezi_najdeni": nap["madez_najden"] == N and nap["madez_zunaj_najden"] == N,
        "vsi_manjkajoci_najdeni": nap["manjkajoce_najdeno"] == N,
        "registracija_pod_0.3mm": porocilo["registracija_napaka_mm_povp"] is not None and porocilo["registracija_napaka_mm_povp"] < 0.3
                                  and len(reg) == N,
    }
    # --- NOVO v Lini: referenca »odobren prvi kos« (meri se GLEDE NA odobreni kos) ---
    pk, pk_lazne = [], 0
    for i in range(min(N, 5)):
        s = 700 + i
        rng = np.random.default_rng(s)
        pl, _ = sn.ravnina(motiv, STIRI, (0.0, 75.0), 0.0, 250.0, seme=s)
        ref = sn.fotografiraj(pl, seme=s + 1000)
        dx, dy, dz = float(rng.uniform(-6, 6)), float(rng.uniform(-6, 6)), float(rng.uniform(-2, 2))
        pl2, _ = sn.ravnina(motiv, STIRI, (dx, 75.0 + dy), dz, 250.0, seme=s + 1)
        foto = sn.fotografiraj(pl2, seme=s + 2000)
        nast = nastavitve(STIRI)
        m, pr = mt.referenca_iz_kosa(ref, nast)
        nast["pricakovano"] = pr
        izid, _ = mt.izmeri(foto, m, nast)
        p = izid.get("polozaj")
        pk.append(None if p is None else [round(p["odmik_x_mm"] - dx, 3), round(p["odmik_y_mm"] - dy, 3), round(p["zasuk_deg"] - dz, 4)])
        pk_lazne += len(izid.get("napake", []))
    porocilo["prvi_kos"] = {"napake_x_y_zasuk": pk, "lazne_napake": pk_lazne}
    pkm = np.array([x for x in pk if x is not None]) if any(x is not None for x in pk) else np.zeros((0, 3))
    pogoji["prvi_kos_polozaj_pod_0.5mm_zasuk_pod_0.1deg"] = (len(pkm) == len(pk) and float(np.abs(pkm[:, :2]).max()) < 0.5
                                                             and float(np.abs(pkm[:, 2]).max()) < 0.1)
    pogoji["prvi_kos_brez_laznih_napak"] = pk_lazne == 0

    # --- NOVO v Lini: PDF z oznakami (ista slika kot zaznava; ce je pdftoppm, se izmeri natisnjena velikost) ---
    nast = nastavitve(STIRI)
    pdf = mt.oznake_pdf(nast)
    pv = mt.predogled_kartic(nast)
    vog, ids, _ = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)).detectMarkers(pv)
    pdf_izid = {"predogled_id": sorted(int(i) for i in ids.ravel()) if ids is not None else []}
    import shutil
    import subprocess
    if shutil.which("pdftoppm"):
        pot = os.path.join(izh, "oznake.pdf")
        with open(pot, "wb") as f:
            f.write(pdf)
        subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-singlefile", pot, os.path.join(izh, "oznake")], check=True)
        g = cv2.imread(os.path.join(izh, "oznake.png"), cv2.IMREAD_GRAYSCALE)
        vog, ids, _ = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)).detectMarkers(g)
        stranice = [float(np.mean([np.linalg.norm(v.reshape(4, 2)[k] - v.reshape(4, 2)[(k + 1) % 4]) for k in range(4)])) * 25.4 / 300
                    for v in (vog or [])]
        pdf_izid.update(natisnjeno_id=sorted(int(i) for i in ids.ravel()) if ids is not None else [],
                        stranica_mm=[round(s, 2) for s in stranice])
    porocilo["pdf_oznak"] = pdf_izid
    pogoji["pdf_oznake_zaznane"] = pdf_izid["predogled_id"] == [0, 1, 2, 3] and pdf.startswith(b"%PDF-1.4") and (
        "natisnjeno_id" not in pdf_izid
        or (pdf_izid["natisnjeno_id"] == [0, 1, 2, 3] and all(abs(s - 50.0) < 0.3 for s in pdf_izid["stranica_mm"])))
    porocilo["pogoji"] = pogoji
    json.dump(porocilo, open(os.path.join(izh, "rezultati.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(porocilo, ensure_ascii=False, indent=1))
    return 0 if all(pogoji.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
