"""Kontrola tiska za Lino: meritev poravnave in kakovosti tiska iz fotografije (24. 11. 2026).

Algoritem je prenesen iz prototipa (lina-delo/vid-kontrola-tiska-1510/prototip/meri_tisk.py) brez sprememb meritve.
Vhod: referenca (PNG motiva s prosojnostjo ALI fotografija odobrenega prvega kosa), fotografija z oznakami ArUco
(znana velikost in polozaj v mm) in nastavitve podjetja (JSON). Izhod: JSON s stevilkami in oznacena slika.
Vse stevilke so iz meritve; model z vidom jih ne sme spreminjati.

Koordinate v mm: izhodisce je tocka ovratnika (sredina sivnega roba), X desno, Y navzdol.

Ukazi (Lina jih zazene brez lupine; vsak izpise EN JSON na stdout in konca z 0, ce je JSON izpisan):
  izmeri --fotografija F --referenca R [--vrsta motiv|prvi-kos] [--nastavitve-json J] [--slika OZNACENO.png]
  oznake-pdf --izhod OZNAKE.pdf [--nastavitve-json J] [--predogled PNG]
  preveri
"""
import argparse
import json
import math
import os
import sys

NAJVEC_TOCK = 60_000_000  # najvec slikovnih tock vhodne slike (tudi 50 MP telefon); vecja = zavrnjena
# N1 (slika-bomba): OpenCV preveri mere iz glave PRED dekodiranjem; brati jo mora ob uvozu cv2, zato pred njim (ne iz okolja klicatelja).
os.environ["OPENCV_IO_MAX_IMAGE_PIXELS"] = str(NAJVEC_TOCK)

try:
    import cv2
    import numpy as np
    from skimage.color import deltaE_ciede2000, rgb2lab
except ImportError as _e:  # knjiznice niso namescene: Lina pokaze »namesti« (soglasje uporabnika)
    if __name__ == "__main__":
        print(json.dumps({"ocena": "NI MOGOCE IZMERITI", "napaka": "knjiznice-manjkajo", "razlogi": [str(_e)[:200]]}))
        sys.exit(0)
    raise

NAJVEC_PORAVNANE = 40_000_000  # najvec tock poravnane slike (obmocje_mm * px_na_mm); varovalka pomnilnika


class NapakaVhoda(Exception):
    """Vhod ni uporaben (datoteka, nastavitve); koda gre v izid, nikoli sled sklada."""

    def __init__(self, koda, razlog):
        super().__init__(razlog)
        self.koda = koda
        self.razlog = razlog

PRIVZETO = {
    "slovar_aruco": "DICT_4X4_50",
    # id -> [x_sredisca_mm, y_sredisca_mm, stranica_mm]; polozaj v koordinatah ovratnika
    "oznake": {"0": [0.0, -40.0, 50.0]},
    "bela_kartice_srgb": [245, 245, 245],  # izmerjena belina papirja kartice (sRGB)
    "rob_bele_mm": 6.0,  # koliko bele obrobe okoli oznake vzamemo za belino
    "px_na_mm": 4.0,  # locljivost poravnane slike
    "obmocje_mm": [-300, -80, 300, 600],
    "pricakovano": {"zgoraj_sredina_mm": [0.0, 75.0], "sirina_mm": 250.0},
    "tolerance": {
        "odmik_x_mm": 5.0, "odmik_y_mm": 5.0, "zasuk_deg": 2.0, "sirina_rel": 0.03,
        "registracija_mm": 1.0, "dE00_povprecje": 5.0, "dE00_napaka": 15.0,
        "napaka_min_mm2": 2.0, "rob_izkljuci_mm": 0.75, "okolica_mm": 30.0, "ecc_min": 0.8,
    },
}


def _zdruzi(osnova, dodatek):
    izhod = dict(osnova)
    for k, v in (dodatek or {}).items():
        izhod[k] = _zdruzi(osnova[k], v) if isinstance(v, dict) and isinstance(osnova.get(k), dict) and k != "oznake" else v
    return izhod


def nalozi_nastavitve(pot):
    if not pot:
        return json.loads(json.dumps(PRIVZETO))
    with open(pot, encoding="utf-8") as f:
        return _zdruzi(PRIVZETO, json.load(f))


def _vogali_mm(cx, cy, s):
    h = s / 2
    return np.array([[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]], np.float64)


def zaznaj_oznake(slika_bgr, nast):
    """Vrne pare (tocke na fotografiji, tocke v mm) in seznam najdenih id."""
    slovar = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, nast["slovar_aruco"]))
    par = cv2.aruco.DetectorParameters()
    par.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    vogali, ids, _ = cv2.aruco.ArucoDetector(slovar, par).detectMarkers(cv2.cvtColor(slika_bgr, cv2.COLOR_BGR2GRAY))
    src, dst, najdeni = [], [], []
    if ids is None:
        return None, None, []
    for v, i in zip(vogali, ids.ravel()):
        opis = nast["oznake"].get(str(int(i)))
        if opis is None:
            continue
        src.append(v.reshape(4, 2))
        dst.append(_vogali_mm(*opis))
        najdeni.append(int(i))
    if not src:
        return None, None, []
    return np.vstack(src), np.vstack(dst), najdeni


def poravnaj(slika_bgr, src, dst, nast):
    """Homografija fotografija -> ravnina v mm; vrne poravnano sliko (px_na_mm) in matriko."""
    ppm = nast["px_na_mm"]
    x0, y0, x1, y1 = nast["obmocje_mm"]
    mm2px = np.array([[ppm, 0, -x0 * ppm], [0, ppm, -y0 * ppm], [0, 0, 1]], np.float64)
    H, _ = cv2.findHomography(src, dst, 0)  # vse tocke so prave (zaznane oznake), brez RANSAC
    Hp = mm2px @ H
    vel = (int(round((x1 - x0) * ppm)), int(round((y1 - y0) * ppm)))
    if vel[0] <= 0 or vel[1] <= 0 or vel[0] * vel[1] > NAJVEC_PORAVNANE:
        raise NapakaVhoda("nastavitve-neveljavne", "obmocje_mm in px_na_mm dajo prevelika ali prazna poravnana slika")
    return cv2.warpPerspective(slika_bgr, Hp, vel, flags=cv2.INTER_LINEAR), Hp


def px_v_mm(p, nast):
    ppm = nast["px_na_mm"]
    return np.asarray(p, np.float64) / ppm + np.array(nast["obmocje_mm"][:2], np.float64)


def popravi_belino(rect_bgr, nast, najdeni):
    """Ojacitve kanalov iz bele obrobe kartic; pri >=3 karticah linearno po ploskvi (gradient osvetlitve)."""
    ppm = nast["px_na_mm"]
    tocke, vzorci = [], []
    for i in najdeni:
        cx, cy, s = nast["oznake"][str(i)]
        r = nast["rob_bele_mm"]
        x0, y0 = px_v_mm([0, 0], nast)
        okvir = lambda a, b: (int((a - x0) * ppm), int((b - y0) * ppm))  # noqa: E731
        zun = _vogali_mm(cx, cy, s + 2 * r)
        notr = _vogali_mm(cx, cy, s + 2)
        m = np.zeros(rect_bgr.shape[:2], np.uint8)
        cv2.fillConvexPoly(m, np.array([okvir(*p) for p in zun], np.int32), 255)
        cv2.fillConvexPoly(m, np.array([okvir(*p) for p in notr], np.int32), 0)
        px = rect_bgr[m > 0].astype(np.float64)
        if len(px) < 50:
            continue
        tocke.append([cx, cy])
        vzorci.append(np.median(px, axis=0))
    if not vzorci:
        return rect_bgr.astype(np.float64), None
    cilj = np.array(nast["bela_kartice_srgb"][::-1], np.float64)  # BGR
    vzorci = np.array(vzorci)
    h, w = rect_bgr.shape[:2]
    if len(vzorci) >= 3:
        A = np.c_[np.array(tocke), np.ones(len(tocke))]
        koef, *_ = np.linalg.lstsq(A, vzorci, rcond=None)  # bela(x,y) = a*x + b*y + c, za vsak kanal
        yy, xx = np.mgrid[0:h, 0:w]
        xm = xx / nast["px_na_mm"] + nast["obmocje_mm"][0]
        ym = yy / nast["px_na_mm"] + nast["obmocje_mm"][1]
        bela = xm[..., None] * koef[0] + ym[..., None] * koef[1] + koef[2]
    else:
        bela = vzorci.mean(axis=0)[None, None, :]
    return np.clip(rect_bgr * (cilj / np.maximum(bela, 1)), 0, 255), vzorci.tolist()


def _preberi(pot, zastavica, koda):
    try:
        m = cv2.imread(pot, zastavica)
    except cv2.error:  # mere iz glave nad OPENCV_IO_MAX_IMAGE_PIXELS: zavrnjeno brez dekodiranja
        raise NapakaVhoda(koda, "slika je prevelika") from None
    if m is None:
        raise NapakaVhoda(koda, "datoteke ni mogoce prebrati kot slike (PNG ali JPEG)")
    if m.shape[0] * m.shape[1] > NAJVEC_TOCK:
        raise NapakaVhoda(koda, "slika je prevelika")
    return m


def nalozi_motiv(pot):
    m = _preberi(pot, cv2.IMREAD_UNCHANGED, "referenca-neberljiva")
    if m.ndim == 2:
        m = cv2.cvtColor(m, cv2.COLOR_GRAY2BGRA)
    if m.shape[2] == 3:
        m = np.dstack([m, np.full(m.shape[:2], 255, np.uint8)])
    return m


def poisci_motiv(motiv_bgra, rect_bgr, ecc_min=0.8, M_pricak=None):
    """Lega motiva: zacetek iz SIFT + RANSAC in iz pricakovanega polozaja naloga, nato ECC; obdrzi boljso korelacijo."""
    poskus_ecc.clear()
    zacetki, st_notr = [], 0
    sift = cv2.SIFT_create(nfeatures=6000, contrastThreshold=0.02)
    maska = cv2.dilate((motiv_bgra[..., 3] > 0).astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
    g_ref = cv2.cvtColor(motiv_bgra[..., :3], cv2.COLOR_BGR2GRAY)
    kp1, d1 = sift.detectAndCompute(g_ref, maska)
    kp2, d2 = sift.detectAndCompute(cv2.cvtColor(rect_bgr, cv2.COLOR_BGR2GRAY), None)
    if d1 is not None and d2 is not None:
        ujemanja = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d1, d2, k=2)
        dobra = [m for m, n in (u for u in ujemanja if len(u) == 2) if m.distance < 0.75 * n.distance]
        if len(dobra) >= 8:
            p1 = np.float32([kp1[m.queryIdx].pt for m in dobra])
            p2 = np.float32([kp2[m.trainIdx].pt for m in dobra])
            M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=5000)
            if M is not None and int(inl.sum()) >= 6:
                st_notr = int(inl.sum())
                zacetki.append(("sift", M))
    if M_pricak is not None:  # odmik je znan na nekaj mm natancno, zato je to dober zacetek za ploskovne motive
        zacetki.append(("pricakovano", M_pricak))
    # Ploskovni motivi imajo malo znacilk (ponavljajoce pike, gladke ploskve), zato SIFT da le grob polozaj;
    # natancno poravnavo naredi ECC na vseh tockah motiva (Evangelidis in Psarakis 2008, cv2.findTransformECC).
    g_rect = cv2.cvtColor(rect_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    al = motiv_bgra[..., 3:4].astype(np.float32) / 255
    ozadje = float(np.median(g_rect))
    predloga = (g_ref[..., None] * al + ozadje * (1 - al))[..., 0].astype(np.float32)
    naj = None
    for izvor, W0 in zacetki:
        try:
            rho, W = cv2.findTransformECC(predloga, g_rect, W0.astype(np.float32), cv2.MOTION_AFFINE,
                                          (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
        except cv2.error:
            poskus_ecc[izvor] = "ECC se ni zbliza"
            continue
        poskus_ecc[izvor] = round(float(rho), 3)
        if naj is None or rho > naj[0]:
            naj = (rho, W, izvor)
    if naj is None or naj[0] < ecc_min:  # korelacija prenizka: motiv ni ta ali je zelo poskodovan
        return None, st_notr
    poskus_ecc["izbran"] = naj[2]
    return naj[1].astype(np.float64), st_notr


poskus_ecc = {}  # zadnja korelacija ECC (za izid in razhroscevanje)


def okvir_motiva(motiv_bgra):
    ys, xs = np.nonzero(motiv_bgra[..., 3] > 0)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def paleta(motiv_bgra, najvec=8, delez=0.01):
    """Barve plasti motiva (ploskovne barve tiska): pogoste barve med neprosojnimi tockami."""
    px = motiv_bgra[..., :3][motiv_bgra[..., 3] > 127]
    q = (px // 8).astype(np.int32)
    kljuci, inv, st = np.unique(q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2], return_inverse=True, return_counts=True)
    vrstni = np.argsort(-st)
    barve = []
    for k in vrstni[:najvec]:
        if st[k] < delez * len(px):
            break
        barve.append(np.median(px[inv.ravel() == k], axis=0))
    return np.array(barve, np.float64)


def _lab(bgr):
    return rgb2lab(np.clip(bgr[..., ::-1] / 255.0, 0, 1))


def _razred_po_kosih(bgr, lab_pal, tock=65536):
    """Najblizja barva palete za vsako tocko, po kosih TOCK (N1, R6: tocke x barve x 3 float64 cez cel motiv je vec GB;
    kos po vrsticah pri zelo siroki sliki se vedno zajame celo sliko)."""
    px = bgr.reshape(-1, 3)
    out = np.empty(len(px), np.intp)
    for i in range(0, len(px), tock):
        lab = _lab(px[i:i + tock][None])[0]
        out[i:i + tock] = np.linalg.norm(lab[:, None, :] - lab_pal, axis=-1).argmin(axis=-1)
    return out.reshape(bgr.shape[:2])


def izmeri(fotografija, motiv_pot, nast):
    slika = _preberi(fotografija, cv2.IMREAD_COLOR, "fotografija-neberljiva") if isinstance(fotografija, str) else fotografija
    motiv = nalozi_motiv(motiv_pot) if isinstance(motiv_pot, str) else motiv_pot
    tol, ppm = nast["tolerance"], nast["px_na_mm"]
    izid = {"razlogi": [], "napake": []}

    src, dst, najdeni = zaznaj_oznake(slika, nast)
    izid["oznake_najdene"] = najdeni
    if src is None:
        izid.update(ocena="NI MOGOCE IZMERITI", razlogi=["oznaka ArUco ni najdena; fotografiraj znova s kartico v kadru"])
        return izid, None
    rect, _ = poravnaj(slika, src, dst, nast)
    rect_f, beline = popravi_belino(rect, nast, najdeni)
    izid["belina_kartic_bgr"] = beline
    rect8 = rect_f.astype(np.uint8)

    x0, y0, x1, y1 = okvir_motiva(motiv)
    pr = nast["pricakovano"]
    sk = pr["sirina_mm"] * ppm / (x1 - x0)
    cx = (pr["zgoraj_sredina_mm"][0] - nast["obmocje_mm"][0]) * ppm
    cy = (pr["zgoraj_sredina_mm"][1] - nast["obmocje_mm"][1]) * ppm
    M_pricak = np.array([[sk, 0, cx - sk * (x0 + x1) / 2], [0, sk, cy - sk * y0]], np.float64)
    M, st_notr = poisci_motiv(motiv, rect8, tol["ecc_min"], M_pricak)
    izid["ujemanja_motiva"] = st_notr
    izid["ecc_korelacija"] = dict(poskus_ecc)
    if M is None:
        izid.update(ocena="NI MOGOCE IZMERITI", razlogi=[f"motiv ni zanesljivo najden (ujemanj: {st_notr}, ECC: {dict(poskus_ecc)})"])
        return izid, rect8

    # --- Polozaj, zasuk, velikost ---
    x0, y0, x1, y1 = okvir_motiva(motiv)
    pt = lambda x, y: M @ np.array([x, y, 1.0])  # noqa: E731
    zg_sr = px_v_mm(pt((x0 + x1) / 2, y0), nast)
    zasuk = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    merilo = math.hypot(M[0, 0], M[1, 0])
    sirina = (x1 - x0) * merilo / ppm
    pr = nast["pricakovano"]
    dx, dy = zg_sr[0] - pr["zgoraj_sredina_mm"][0], zg_sr[1] - pr["zgoraj_sredina_mm"][1]
    izid["polozaj"] = {
        "zgoraj_sredina_mm": [round(zg_sr[0], 2), round(zg_sr[1], 2)],
        "odmik_x_mm": round(dx, 2), "odmik_y_mm": round(dy, 2),
        "zasuk_deg": round(zasuk, 2), "sirina_mm": round(sirina, 2),
        "sirina_odstopanje_rel": round(sirina / pr["sirina_mm"] - 1, 4),
    }
    if abs(dx) > tol["odmik_x_mm"]:
        izid["razlogi"].append(f"vodoravni odmik {dx:+.1f} mm (meja {tol['odmik_x_mm']} mm)")
    if abs(dy) > tol["odmik_y_mm"]:
        izid["razlogi"].append(f"navpicni odmik {dy:+.1f} mm (meja {tol['odmik_y_mm']} mm)")
    if abs(zasuk) > tol["zasuk_deg"]:
        izid["razlogi"].append(f"zasuk {zasuk:+.2f} st. (meja {tol['zasuk_deg']} st.)")
    if abs(sirina / pr["sirina_mm"] - 1) > tol["sirina_rel"]:
        izid["razlogi"].append(f"sirina {sirina:.1f} mm namesto {pr['sirina_mm']} mm")

    # --- Pricakovana slika: barva majice + motiv, poravnan na fotografijo ---
    h, w = rect8.shape[:2]
    alfa = cv2.warpAffine(motiv[..., 3].astype(np.float64) / 255, M, (w, h), flags=cv2.INTER_LINEAR)
    ref = cv2.warpAffine(motiv[..., :3].astype(np.float64), M, (w, h), flags=cv2.INTER_LINEAR)
    okol = int(tol["okolica_mm"] * ppm)
    m_motiv = (alfa > 0.5).astype(np.uint8)
    roi = cv2.dilate(m_motiv, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * okol + 1,) * 2))
    obroc = roi.astype(bool) & ~cv2.dilate(m_motiv, np.ones((9, 9), np.uint8)).astype(bool)
    majica = np.median(rect_f[obroc], axis=0)
    pricak = ref * alfa[..., None] + majica * (1 - alfa[..., None])

    ys, xs = np.nonzero(roi)
    ya, yb, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    dE = np.zeros((h, w))
    dE[ya:yb, xa:xb] = deltaE_ciede2000(_lab(pricak[ya:yb, xa:xb]), _lab(rect_f[ya:yb, xa:xb]))
    dE[roi == 0] = 0

    # Robovi barvnih ploskev: majhen zamik ob interpolaciji da veliko dE, zato pas ob robu izkljucimo.
    rob_px = max(1, int(round(tol["rob_izkljuci_mm"] * ppm)))
    robovi = cv2.Canny(np.clip(pricak, 0, 255).astype(np.uint8), 20, 60)
    pas = cv2.dilate(robovi, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rob_px + 1,) * 2)) > 0

    # --- Napake: povrsine z dE00 nad mejo ---
    nap = ((dE > tol["dE00_napaka"]) & ~pas).astype(np.uint8)
    nap = cv2.morphologyEx(nap, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nap = cv2.dilate(nap, np.ones((2 * rob_px + 1,) * 2, np.uint8))  # spoji dele, ki jih je razrezal pas
    n, oznake, stat, _ = cv2.connectedComponentsWithStats(nap)
    min_px = tol["napaka_min_mm2"] * ppm * ppm
    for k in range(1, n):
        x, y, ww, hh, pov = stat[k]
        if pov < min_px:
            continue
        sel = oznake == k
        v_motivu = (m_motiv[sel] > 0).mean()
        blizu_majice = np.median(deltaE_ciede2000(_lab(rect_f[sel][None]), _lab(majica[None, None])))
        if v_motivu > 0.5 and blizu_majice < tol["dE00_napaka"]:
            vrsta = "manjkajoc tisk"
        elif v_motivu > 0.5:
            vrsta = "madez ali napacna barva v motivu"
        else:
            vrsta = "madez zunaj motiva"
        a = px_v_mm([x, y], nast)
        izid["napake"].append({
            "vrsta": vrsta, "okvir_mm": [round(a[0], 1), round(a[1], 1), round(ww / ppm, 1), round(hh / ppm, 1)],
            "povrsina_mm2": round(float(sel.sum()) / ppm / ppm, 1), "dE00_najvec": round(float(dE[sel].max()), 1),
            "_px": [int(x), int(y), int(ww), int(hh)],
        })
    if izid["napake"]:
        izid["razlogi"].append(f"napak na tisku: {len(izid['napake'])}")

    # --- Barvno odstopanje na notranjosti motiva (brez robov in napak) ---
    notr = cv2.erode(m_motiv, np.ones((2 * rob_px + 1,) * 2, np.uint8)).astype(bool) & ~pas & (nap == 0)
    if notr.sum() > 100:
        v = dE[notr]
        izid["barva"] = {"dE00_povprecje": round(float(v.mean()), 2), "dE00_p95": round(float(np.percentile(v, 95)), 2)}
        if v.mean() > tol["dE00_povprecje"]:
            izid["razlogi"].append(f"barvno odstopanje dE00 {v.mean():.1f} (meja {tol['dE00_povprecje']})")

    # --- Registracija barvnih plasti: zamik vsake plasti glede na celoten motiv ---
    barve = paleta(motiv)
    lab_pal = rgb2lab((np.vstack([barve, majica[None]])[:, ::-1] / 255.0)[None])[0]
    reg = []
    if len(barve) >= 2:
        razred_foto = _razred_po_kosih(rect_f[ya:yb, xa:xb], lab_pal)
        razred_ref = np.where(motiv[..., 3] > 127, _razred_po_kosih(motiv[..., :3], lab_pal[: len(barve)]), -1)
        okno = cv2.createHanningWindow((xb - xa, yb - ya), cv2.CV_64F)
        for i, b in enumerate(barve):
            plast_ref = cv2.warpAffine((razred_ref == i).astype(np.float64), M, (w, h))[ya:yb, xa:xb]
            plast_foto = (razred_foto == i).astype(np.float64)
            if plast_ref.sum() < 200:
                continue
            (sx, sy), odziv = cv2.phaseCorrelate(plast_ref, plast_foto, okno)
            reg.append({"barva_srgb": [int(c) for c in b[::-1]], "zamik_mm": [round(sx / ppm, 2), round(sy / ppm, 2)],
                        "zanesljivost": round(float(odziv), 2), "delez": round(float(plast_ref.sum()), 0)})
        if reg:
            osn = max(reg, key=lambda r: r["delez"])  # najvecja plast = kljucna plast (osnova)
            for r in reg:
                r["glede_na_kljucno_mm"] = [round(r["zamik_mm"][0] - osn["zamik_mm"][0], 2),
                                            round(r["zamik_mm"][1] - osn["zamik_mm"][1], 2)]
                del r["delez"]
            najvec = max(math.hypot(*r["glede_na_kljucno_mm"]) for r in reg)
            izid["registracija"] = {"plasti": reg, "najvecji_zamik_mm": round(najvec, 2)}
            if najvec > tol["registracija_mm"]:
                izid["razlogi"].append(f"zamik barv {najvec:.2f} mm (meja {tol['registracija_mm']} mm)")

    if "barva" not in izid and not izid["razlogi"]:
        # N3: nikoli lazni OK - barva tankega motiva (napis, crte) ni bila izmerjena, zato ocene ni
        izid.update(ocena="NI MOGOCE IZMERITI", napaka="barva-ni-izmerjena",
                    razlogi=["barve motiva ni bilo mogoce izmeriti (motiv je pretanek); preveri rocno"])
        return izid, oznaci(rect8, motiv, M, izid, nast)
    izid["ocena"] = "OK" if not izid["razlogi"] else "NI OK"
    return izid, oznaci(rect8, motiv, M, izid, nast)


def oznaci(rect8, motiv, M, izid, nast):
    """Oznacena slika: zeleno pricakovano mesto, modro izmerjen okvir, rdece napake."""
    ppm = nast["px_na_mm"]
    out = rect8.copy()
    x0, y0, x1, y1 = okvir_motiva(motiv)
    pr = nast["pricakovano"]
    ox, oy = nast["obmocje_mm"][:2]
    sw = pr["sirina_mm"]
    visina = sw * (y1 - y0) / (x1 - x0)
    zx, zy = pr["zgoraj_sredina_mm"]
    a = (int((zx - sw / 2 - ox) * ppm), int((zy - oy) * ppm))
    b = (int((zx + sw / 2 - ox) * ppm), int((zy + visina - oy) * ppm))
    cv2.rectangle(out, a, b, (0, 170, 0), 3)
    vog = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)
    vog = (M @ np.c_[vog, np.ones(4)].T).T
    cv2.polylines(out, [vog.astype(np.int32)], True, (255, 80, 0), 3)
    for i, n in enumerate(izid["napake"], 1):
        x, y, ww, hh = n.pop("_px")
        cv2.rectangle(out, (x - 6, y - 6), (x + ww + 6, y + hh + 6), (0, 0, 255), 3)
        cv2.putText(out, str(i), (x, max(20, y - 10)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
    p = izid.get("polozaj", {})
    vrstice = [f"{izid.get('ocena', '')}", f"odmik X {p.get('odmik_x_mm', 0):+.1f} mm  Y {p.get('odmik_y_mm', 0):+.1f} mm",
               f"zasuk {p.get('zasuk_deg', 0):+.2f} st.  sirina {p.get('sirina_mm', 0):.1f} mm"]
    for i, t in enumerate(vrstice):
        cv2.putText(out, t, (20, 40 + 36 * i), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5)
        cv2.putText(out, t, (20, 40 + 36 * i), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    return out


def nastavitve_iz_json(besedilo):
    """Nastavitve iz Line (JSON niz); Lina jih ze preveri, tu se enkrat meje, ki varujejo pomnilnik in deljenje z 0."""
    try:
        dodatek = json.loads(besedilo) if besedilo else {}
    except ValueError:
        raise NapakaVhoda("nastavitve-neveljavne", "nastavitve niso JSON")
    if not isinstance(dodatek, dict):
        raise NapakaVhoda("nastavitve-neveljavne", "nastavitve niso objekt")
    n = _zdruzi(PRIVZETO, dodatek)
    try:
        ppm = float(n["px_na_mm"])
        x0, y0, x1, y1 = (float(v) for v in n["obmocje_mm"])
        assert 1.0 <= ppm <= 10.0 and x1 > x0 and y1 > y0 and float(n["pricakovano"]["sirina_mm"]) > 0
        assert n["oznake"] and all(len(v) == 3 and float(v[2]) > 0 for v in n["oznake"].values())
    except (AssertionError, KeyError, TypeError, ValueError):
        raise NapakaVhoda("nastavitve-neveljavne", "nastavitve so zunaj dovoljenih meja")
    return n


# --- Referenca »odobren prvi kos« (NOVO, ni bilo v prototipu; preverjeno samo na sinteticnih slikah) ---
def referenca_iz_kosa(foto_ref, nast):
    """Iz fotografije odobrenega kosa izreze motiv (v mm ravnini, px_na_mm) s prosojnostjo in vrne (motiv_bgra, pricakovano).

    Motiv = tocke, ki se od barve majice razlikujejo za vec kot dE00_napaka, brez kartic z oznakami. Pricakovan polozaj
    postane polozaj na odobrenem kosu: odmik, zasuk in sirina se merijo GLEDE NA ODOBRENI KOS.
    """
    slika = _preberi(foto_ref, cv2.IMREAD_COLOR, "referenca-neberljiva") if isinstance(foto_ref, str) else foto_ref
    src, dst, najdeni = zaznaj_oznake(slika, nast)
    if src is None:
        raise NapakaVhoda("referenca-brez-oznak", "na fotografiji odobrenega kosa ni oznake ArUco")
    rect, _ = poravnaj(slika, src, dst, nast)
    rect_f, _ = popravi_belino(rect, nast, najdeni)
    ppm = nast["px_na_mm"]
    h, w = rect_f.shape[:2]
    dovoljeno = np.full((h, w), 255, np.uint8)
    ox, oy = nast["obmocje_mm"][:2]
    for cx, cy, s in nast["oznake"].values():  # kartice (oznaka + 10 mm bele obrobe + rezerva) niso motiv
        r = s / 2 + 15
        cv2.rectangle(dovoljeno, (int((cx - r - ox) * ppm), int((cy - r - oy) * ppm)),
                      (int((cx + r - ox) * ppm), int((cy + r - oy) * ppm)), 0, -1)
    majica = np.median(rect_f[dovoljeno > 0], axis=0)
    dE = deltaE_ciede2000(_lab(rect_f), _lab(majica[None, None]))
    m = ((dE > nast["tolerance"]["dE00_napaka"]) & (dovoljeno > 0)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, oznake, stat, _ = cv2.connectedComponentsWithStats(m)
    min_px = 5.0 * ppm * ppm  # deli motiva pod 5 mm2 (sum blaga) ne stejejo
    obdrzi = [k for k in range(1, n) if stat[k][4] >= min_px]
    if not obdrzi:
        raise NapakaVhoda("referenca-brez-motiva", "na fotografiji odobrenega kosa ni najden motiv")
    maska = np.isin(oznake, obdrzi)
    ys, xs = np.nonzero(maska)
    ya, yb, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    motiv = np.dstack([np.clip(rect_f[ya:yb, xa:xb], 0, 255).astype(np.uint8), maska[ya:yb, xa:xb].astype(np.uint8) * 255])
    pricakovano = {"zgoraj_sredina_mm": [float((xa + xb) / 2 / ppm + ox), float(ya / ppm + oy)], "sirina_mm": float((xb - xa) / ppm)}
    return motiv, pricakovano


# --- Natisljiva stran z oznakami ArUco (PDF, vektorsko, natancno v mm) ---
MM = 72.0 / 25.4  # pt na mm


def celice_oznake(id_, slovar):
    """Biti oznake z obrobo (n x n, True = crno): isti vir kot zaznava (cv2.aruco)."""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, slovar))
    n = d.markerSize + 2
    return cv2.aruco.generateImageMarker(d, int(id_), n) < 128


def postavitev_kartic(nast):
    """Kartice na A4 (210 x 297 mm), najvec 4 na stran: (id, x_levo_mm, y_zgoraj_mm, stranica_mm) - y od vrha strani."""
    izhod = []
    for i, (id_, (_, _, s)) in enumerate(sorted(nast["oznake"].items(), key=lambda p: int(p[0]))):
        stran, mesto = divmod(i, 4)
        stolp, vrsta = mesto % 2, mesto // 2
        izhod.append((stran, int(id_), 15 + stolp * 95 + 10, 30 + vrsta * 115 + 10, float(s)))
    return izhod


def _ascii(t):
    return t.encode("ascii", "replace").decode().replace("\\", "/").replace("(", "[").replace(")", "]")


def oznake_pdf(nast):
    """Vrne bajte PDF: kartice z oznako (stranica iz nastavitev, bela obroba 10 mm), id, puscica GOR, rezne oznake, crta 100 mm."""
    kartice = postavitev_kartic(nast)
    if any(s > 70 for *_, s in kartice):
        raise NapakaVhoda("nastavitve-neveljavne", "oznaka vecja od 70 mm ne gre na kartico A4")
    strani = {}
    for stran, id_, x, y, s in kartice:
        ukazi = strani.setdefault(stran, [])
        celice = celice_oznake(id_, nast["slovar_aruco"])
        n = celice.shape[0]
        c = s / n
        Y = lambda ymm: (297 - ymm) * MM  # noqa: E731  PDF ima izhodisce spodaj levo
        ukazi.append("0 g")
        for r in range(n):
            for k in range(n):
                if celice[r, k]:
                    ukazi.append(f"{(x + k * c) * MM:.3f} {Y(y + (r + 1) * c):.3f} {c * MM:.3f} {c * MM:.3f} re f")
        # rezne oznake na vogalih kartice (oznaka + 10 mm), zunaj bele obrobe
        ukazi.append("0.3 w 0.5 G")
        for vx, vy in ((x - 10, y - 10), (x + s + 10, y - 10), (x - 10, y + s + 10), (x + s + 10, y + s + 10)):
            sx = -1 if vx < x else 1
            sy = -1 if vy < y else 1
            ukazi.append(f"{(vx + sx * 1) * MM:.2f} {Y(vy):.2f} m {(vx + sx * 5) * MM:.2f} {Y(vy):.2f} l S")
            ukazi.append(f"{vx * MM:.2f} {Y(vy + sy * 1):.2f} m {vx * MM:.2f} {Y(vy + sy * 5):.2f} l S")
        ox, oy, _ = nast["oznake"][str(id_)]
        ukazi.append(f"BT /F1 9 Tf {(x - 10) * MM:.2f} {Y(y + s + 15):.2f} Td (Lina oznaka {id_} - {s:g} mm) Tj ET")
        ukazi.append(f"BT /F1 7 Tf {(x - 10) * MM:.2f} {Y(y + s + 19):.2f} Td (sredisce: X {ox:g} mm, Y {oy:g} mm od ovratnika) Tj ET")
        ukazi.append(f"BT /F1 9 Tf {(x + s / 2 - 6) * MM:.2f} {Y(y - 14):.2f} Td (GOR ^) Tj ET")
    vsebine = []
    for stran in sorted(strani):
        u = strani[stran]
        u.append("0 g 0.5 w")
        u.append(f"{25 * MM:.2f} {(297 - 275) * MM:.2f} m {125 * MM:.2f} {(297 - 275) * MM:.2f} l S")
        for t in (25, 125):
            u.append(f"{t * MM:.2f} {(297 - 272) * MM:.2f} m {t * MM:.2f} {(297 - 278) * MM:.2f} l S")
        u.append(f"BT /F1 9 Tf {25 * MM:.2f} {(297 - 283) * MM:.2f} Td (Ta crta mora meriti natancno 100 mm. Natisni v merilu 100 %, brez prilagajanja strani.) Tj ET")
        u.append(f"BT /F1 9 Tf {25 * MM:.2f} {(297 - 288) * MM:.2f} Td ({_ascii('Izrezi po reznih oznakah; bela obroba okoli oznake mora ostati cela.')}) Tj ET")
        vsebine.append("\n".join(u).encode("ascii"))
    # najmanjsi PDF 1.4: katalog, strani, pisava Helvetica (vgrajena v vsak bralnik), ena vsebina na stran
    objekti = [b"<< /Type /Catalog /Pages 2 0 R >>", None, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    otroci = []
    for v in vsebine:
        st_v = len(objekti) + 1
        objekti.append(b"<< /Length %d >>\nstream\n" % len(v) + v + b"\nendstream")
        otroci.append(len(objekti) + 1)
        objekti.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % st_v)
    objekti[1] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % o for o in otroci) + b"] /Count %d >>" % len(otroci)
    izhod = bytearray(b"%PDF-1.4\n")
    odmiki = []
    for i, o in enumerate(objekti, 1):
        odmiki.append(len(izhod))
        izhod += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(izhod)
    izhod += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objekti) + 1)
    for o in odmiki:
        izhod += b"%010d 00000 n \n" % o
    izhod += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objekti) + 1, xref)
    return bytes(izhod)


def predogled_kartic(nast, ppm=8.0):
    """Rastrski predogled prve strani PDF (iste celice in mere) - za preizkus, da se oznake zaznajo s pravim id."""
    slika = np.full((int(297 * ppm), int(210 * ppm)), 255, np.uint8)
    for stran, id_, x, y, s in postavitev_kartic(nast):
        if stran:
            continue
        celice = celice_oznake(id_, nast["slovar_aruco"])
        o = cv2.resize(celice.astype(np.uint8) * 255, (int(round(s * ppm)),) * 2, interpolation=cv2.INTER_NEAREST)
        slika[int(round(y * ppm)):int(round(y * ppm)) + o.shape[0], int(round(x * ppm)):int(round(x * ppm)) + o.shape[1]] = 255 - o
    return slika


def _izpisi(izid):
    for n in izid.get("napake", []):
        n.pop("_px", None)
    sys.stdout.write(json.dumps(izid, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Kontrola tiska za Lino: meritev poravnave in kakovosti tiska.")
    pod = ap.add_subparsers(dest="ukaz", required=True)
    a_iz = pod.add_parser("izmeri")
    a_iz.add_argument("--fotografija", required=True)
    a_iz.add_argument("--referenca", required=True, help="PNG motiva s prosojnostjo ali fotografija odobrenega kosa")
    a_iz.add_argument("--vrsta", choices=["motiv", "prvi-kos"], default="motiv")
    a_iz.add_argument("--nastavitve-json", default="")
    a_iz.add_argument("--slika", help="kam shraniti oznaceno sliko (PNG)")
    a_pdf = pod.add_parser("oznake-pdf")
    a_pdf.add_argument("--izhod", required=True)
    a_pdf.add_argument("--nastavitve-json", default="")
    a_pdf.add_argument("--predogled")
    pod.add_parser("preveri")
    a = ap.parse_args(argv)

    if a.ukaz == "preveri":
        import skimage

        _izpisi({"ok": True, "opencv": cv2.__version__, "numpy": np.__version__, "skimage": skimage.__version__})
        return 0
    try:
        nast = nastavitve_iz_json(a.nastavitve_json)
        if a.ukaz == "oznake-pdf":
            with open(a.izhod, "xb") as f:  # nikoli ne prepise obstojece datoteke
                f.write(oznake_pdf(nast))
            if a.predogled:
                cv2.imwrite(a.predogled, predogled_kartic(nast))
            _izpisi({"ok": True, "oznake": sorted(int(k) for k in nast["oznake"])})
            return 0
        referenca = {"vrsta": a.vrsta}
        if a.vrsta == "prvi-kos":
            motiv, pricakovano = referenca_iz_kosa(a.referenca, nast)
            nast["pricakovano"] = pricakovano
            referenca["pricakovano"] = {"zgoraj_sredina_mm": [round(v, 2) for v in pricakovano["zgoraj_sredina_mm"]],
                                        "sirina_mm": round(pricakovano["sirina_mm"], 2)}
        else:
            motiv = nalozi_motiv(a.referenca)
        izid, slika = izmeri(a.fotografija, motiv, nast)
        izid["referenca"] = referenca
    except NapakaVhoda as e:
        _izpisi({"ocena": "NI MOGOCE IZMERITI", "napaka": e.koda, "razlogi": [e.razlog], "napake": []})
        return 0
    if a.slika and slika is not None:
        cv2.imwrite(a.slika, slika)
    _izpisi(izid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
