"""Sinteticne fotografije majic z znanim odmikom, zasukom, merilom in napakami (za preizkus natancnosti).

Ravnina majice se izrise v mm (izhodisce = tocka ovratnika), nato jo "kamera" preslika s homografijo
(nagib telefona), doda gradient svetlobe, barvni odtenek, zameglitev, sum in JPEG.
"""
import cv2
import numpy as np

PPM_RAVNINE = 4.0  # px/mm pri risanju ravnine
OBMOCJE = (-260.0, -90.0, 260.0, 520.0)  # x0, y0, x1, y1 v mm


def motiv(sirina=1000, visina=760, seme=1):
    """Testni motiv s tremi ploskovnimi barvami, napisom in drobnimi detajli; ozadje prosojno."""
    rng = np.random.default_rng(seme)
    m = np.zeros((visina, sirina, 4), np.uint8)
    rdeca, modra, rumena = (40, 40, 200), (170, 90, 20), (30, 200, 240)  # BGR
    cv2.circle(m, (300, 330), 230, (*rdeca, 255), -1)
    cv2.rectangle(m, (480, 120), (930, 560), (*modra, 255), -1)
    cv2.circle(m, (300, 330), 120, (*rumena, 255), -1)
    tocke = np.array([[560, 200], [880, 230], [700, 520]], np.int32)
    cv2.fillPoly(m, [tocke], (*rumena, 255))
    cv2.putText(m, "SAFEER TISK", (70, 700), cv2.FONT_HERSHEY_DUPLEX, 3.2, (*modra, 255), 9)
    for _ in range(40):  # drobni detajli za zanesljivo ujemanje znacilk
        x, y = int(rng.integers(520, 900)), int(rng.integers(140, 540))
        cv2.circle(m, (x, y), int(rng.integers(5, 14)), (*rumena, 255), -1)
    for _ in range(25):
        x, y = int(rng.integers(150, 450)), int(rng.integers(150, 520))
        if (x - 300) ** 2 + (y - 330) ** 2 > 140 ** 2:
            cv2.rectangle(m, (x, y), (x + 10, y + 10), (*modra, 255), -1)
    return m


def _v_px(x, y):
    # Pravilo OpenCV: sredisce tocke i je na i, zato je rob ravnine (OBMOCJE[0]) na koordinati -0,5.
    return ((x - OBMOCJE[0]) * PPM_RAVNINE - 0.5, (y - OBMOCJE[1]) * PPM_RAVNINE - 0.5)


def oznaka_aruco(id_, stranica_mm, slovar="DICT_4X4_50"):
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, slovar))
    return cv2.aruco.generateImageMarker(d, id_, int(round(stranica_mm * PPM_RAVNINE)))


def ravnina(motiv_bgra, oznake, zg_sredina_mm, zasuk_deg, sirina_mm, majica_bgr=(215, 215, 210),
            madezi=(), manjkajoce=(), zamik_plasti=None, barvni_premik=0.0, seme=0):
    """Vrne sliko ravnine (BGR) in resnico (slovar)."""
    rng = np.random.default_rng(seme)
    W = int((OBMOCJE[2] - OBMOCJE[0]) * PPM_RAVNINE)
    H = int((OBMOCJE[3] - OBMOCJE[1]) * PPM_RAVNINE)
    pl = np.empty((H, W, 3), np.float64)
    pl[:] = majica_bgr
    tkanina = cv2.GaussianBlur(rng.normal(0, 6, (H, W)), (0, 0), 1.2)  # tekstura blaga
    pl += tkanina[..., None]

    m = motiv_bgra.copy()
    for (x, y, w, h) in manjkajoce:  # v px motiva
        m[y:y + h, x:x + w, 3] = 0
    if zamik_plasti is not None:  # (barva_bgr, dx_mm, dy_mm): ena plast natisnjena z zamikom
        barva, dxm, dym = zamik_plasti
        plast = np.all(m[..., :3] == barva, axis=2) & (m[..., 3] > 0)
        ysb, xsb = np.nonzero(motiv_bgra[..., 3] > 0)
        s = (xsb.max() + 1 - xsb.min()) / sirina_mm  # px motiva na mm (sirina okvirja motiva, ne platna)
        T = np.float32([[1, 0, dxm * s], [0, 1, dym * s]])
        prem = cv2.warpAffine(plast.astype(np.uint8), T, (m.shape[1], m.shape[0]), flags=cv2.INTER_NEAREST) > 0
        ostalo = m.copy()
        ostalo[plast, 3] = 0  # na mestu stare plasti ostane majica ali spodnja plast (poenostavljeno: majica)
        ostalo[prem, :3] = barva
        ostalo[prem, 3] = 255
        m = ostalo

    ys, xs = np.nonzero(motiv_bgra[..., 3] > 0)
    x0, y0, x1 = xs.min(), ys.min(), xs.max() + 1
    s = sirina_mm / (x1 - x0) * PPM_RAVNINE  # px motiva -> px ravnine
    a = np.deg2rad(zasuk_deg)
    R = s * np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    cilj = np.array(_v_px(*zg_sredina_mm))
    t = cilj - R @ np.array([(x0 + x1) / 2, y0])
    A = np.c_[R, t]
    rgb = cv2.warpAffine(m[..., :3].astype(np.float64), A, (W, H), flags=cv2.INTER_LINEAR)
    al = cv2.warpAffine(m[..., 3].astype(np.float64) / 255, A, (W, H), flags=cv2.INTER_LINEAR)[..., None]
    if barvni_premik:
        rgb = np.clip(rgb + barvni_premik, 0, 255)
    pl = rgb * al + pl * (1 - al)

    resnica = {"madezi_mm": [], "manjkajoce_mm": []}
    for (xm, ym, r_mm, barva) in madezi:
        cx, cy = _v_px(xm, ym)
        cv2.ellipse(pl, (int(cx), int(cy)), (int(r_mm * PPM_RAVNINE), int(r_mm * 0.6 * PPM_RAVNINE)), 30, 0, 360,
                    barva, -1, cv2.LINE_AA)
        resnica["madezi_mm"].append([xm, ym, r_mm])
    for (x, y, w, h) in manjkajoce:
        c = (A @ np.array([x + w / 2, y + h / 2, 1])) / PPM_RAVNINE + np.array(OBMOCJE[:2])
        resnica["manjkajoce_mm"].append([float(c[0]), float(c[1])])

    for id_, (cx, cy, st) in oznake.items():  # kartica: bela obroba 10 mm, nato oznaka
        r = 10
        a_ = _v_px(cx - st / 2 - r, cy - st / 2 - r)
        b_ = _v_px(cx + st / 2 + r, cy + st / 2 + r)
        cv2.rectangle(pl, (int(a_[0]), int(a_[1])), (int(b_[0]), int(b_[1])), (245, 245, 245), -1)
        o = oznaka_aruco(int(id_), st).astype(np.float64)
        px, py = _v_px(cx - st / 2, cy - st / 2)
        # OpenCV: sredisce tocke i je na koordinati i, njen levi rob na i-0,5; rob oznake na px pomeni indeks px+0,5
        px, py = int(round(px + 0.5)), int(round(py + 0.5))
        pl[py:py + o.shape[0], px:px + o.shape[1]] = o[..., None] * (245 / 255) + 12 * (o[..., None] < 128)

    resnica.update(zg_sredina_mm=list(zg_sredina_mm), zasuk_deg=zasuk_deg, sirina_mm=sirina_mm)
    return np.clip(pl, 0, 255).astype(np.uint8), resnica


def fotografiraj(pl, nagib=0.05, svetloba=0.15, odtenek=0.04, sum=3.0, jpeg=88, seme=0, velikost=(2400, 2800)):
    """Perspektivna "kamera": nakljucna homografija, gradient svetlobe, odtenek, zameglitev, sum, JPEG."""
    rng = np.random.default_rng(seme)
    H, W = pl.shape[:2]
    vw, vh = velikost
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    rob = 0.06
    dst = np.float32([[rob * vw, rob * vh], [(1 - rob) * vw, rob * vh], [(1 - rob) * vw, (1 - rob) * vh], [rob * vw, (1 - rob) * vh]])
    dst += rng.uniform(-nagib, nagib, dst.shape).astype(np.float32) * np.float32([vw, vh])
    Hc = cv2.getPerspectiveTransform(src, dst)
    f = cv2.warpPerspective(pl, Hc, (vw, vh), flags=cv2.INTER_AREA, borderValue=(60, 60, 60)).astype(np.float64)
    yy, xx = np.mgrid[0:vh, 0:vw]
    smer = rng.uniform(-1, 1, 2)
    grad = 1 + svetloba * ((xx / vw - 0.5) * smer[0] + (yy / vh - 0.5) * smer[1])
    f *= grad[..., None] * (1 + rng.uniform(-odtenek, odtenek, 3))
    f = cv2.GaussianBlur(f, (0, 0), 0.8) + rng.normal(0, sum, f.shape)
    ok, buf = cv2.imencode(".jpg", np.clip(f, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, jpeg])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)
