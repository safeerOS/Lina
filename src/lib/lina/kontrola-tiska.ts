/**
 * Kontrola tiska (vid, lastnik 24. 11. 2026): ciste funkcije brez diska in procesov.
 * Meritev naredi scripts/kontrola_tiska.py (OpenCV, algoritem iz prototipa lina-delo/vid-kontrola-tiska-1510); tu so
 * nastavitve s preverbo mej, preverba izida (izid Pythona je vhod od zunaj: nic ne verjamemo brez preverbe), vrstica dnevnika
 * in poti/argumenti namestitve knjiznic za Linux in Windows.
 *
 * Pravilo: stevilke (mm, stopinje, dE00) in ocena OK/NI OK pridejo SAMO iz meritve. Neveljaven ali nepopoln izid je vedno
 * »NI MOGOCE IZMERITI«, nikoli OK.
 */

export type Oznake = Record<string, [number, number, number]>;

export type Tolerance = {
  odmik_x_mm: number;
  odmik_y_mm: number;
  zasuk_deg: number;
  sirina_rel: number;
  registracija_mm: number;
  dE00_povprecje: number;
  dE00_napaka: number;
  napaka_min_mm2: number;
  rob_izkljuci_mm: number;
  okolica_mm: number;
  ecc_min: number;
};

/** Nastavitve meritve; imena polj so ista kot v scripts/kontrola_tiska.py (PRIVZETO). */
export type NastavitveMeritve = {
  slovar_aruco: "DICT_4X4_50";
  oznake: Oznake;
  bela_kartice_srgb: [number, number, number];
  rob_bele_mm: number;
  px_na_mm: number;
  obmocje_mm: [number, number, number, number];
  pricakovano: { zgoraj_sredina_mm: [number, number]; sirina_mm: number };
  tolerance: Tolerance;
};

export type NastavitveKontrole = {
  meritev: NastavitveMeritve;
  /** Mapa dnevnika kontrole (polna pot); prazno = »kontrola-tiska« v podatkovni mapi Line. */
  mapaDnevnika: string;
  /** Opis napak z modelom z vidom: privzeto IZKLOPLJENO; tudi vklopljen poslje sliko samo ob kliku »Opisi napake«. */
  opisZModelom: boolean;
};

/**
 * Privzeto iz prototipa (NACRT.md §7, meri_tisk.py PRIVZETO): ena kartica 50 mm pri ovratniku. Tolerance so DOMNEVE, dokler
 * lastnik ne odgovori na vprasanja v POROCILO.md prototipa (1: mm in stopinje, 5: barvne meje).
 */
export const PRIVZETA_MERITEV: NastavitveMeritve = {
  slovar_aruco: "DICT_4X4_50",
  oznake: { "0": [0, -40, 50] },
  bela_kartice_srgb: [245, 245, 245],
  rob_bele_mm: 6,
  px_na_mm: 4,
  obmocje_mm: [-300, -80, 300, 600],
  pricakovano: { zgoraj_sredina_mm: [0, 75], sirina_mm: 250 },
  tolerance: {
    odmik_x_mm: 5,
    odmik_y_mm: 5,
    zasuk_deg: 2,
    sirina_rel: 0.03,
    registracija_mm: 1,
    dE00_povprecje: 5,
    dE00_napaka: 15,
    napaka_min_mm2: 2,
    rob_izkljuci_mm: 0.75,
    okolica_mm: 30,
    ecc_min: 0.8,
  },
};

/** Stiri oznake na mizi/paleti (NACRT.md §4): natancnejse od ene (prototip: polozaj < 0,03 mm, zasuk < 0,01°). */
export const STIRI_OZNAKE: Oznake = { "0": [0, -40, 50], "1": [-200, 100, 50], "2": [200, 100, 50], "3": [0, 460, 50] };

export const PRIVZETE_NASTAVITVE: NastavitveKontrole = { meritev: PRIVZETA_MERITEV, mapaDnevnika: "", opisZModelom: false };

/** Najvec tock poravnane slike (isto kot NAJVEC_PORAVNANE v Pythonu): obmocje_mm x px_na_mm dolocata porabo pomnilnika. */
export const NAJVEC_PORAVNANE = 40_000_000;
/** DICT_4X4_50 ima oznake 0..49. */
export const NAJVEC_ID_OZNAKE = 49;
export const NAJVEC_OZNAK = 16;

/** Meje toleranc [najmanj, najvec] (vkljucno); zunaj = nastavitev zavrnjena (nic ne popravljamo potiho). */
export const MEJE_TOLERANC: Record<keyof Tolerance, [number, number]> = {
  odmik_x_mm: [0.1, 100],
  odmik_y_mm: [0.1, 100],
  zasuk_deg: [0.01, 45],
  sirina_rel: [0.001, 0.5],
  registracija_mm: [0.05, 20],
  dE00_povprecje: [0.5, 50],
  dE00_napaka: [2, 100],
  napaka_min_mm2: [0.1, 10_000],
  rob_izkljuci_mm: [0, 5],
  okolica_mm: [1, 200],
  ecc_min: [0.3, 0.999],
};

const jeStevilo = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vMejah = (v: unknown, a: number, b: number): v is number => jeStevilo(v) && v >= a && v <= b;

export type IzidNastavitev = { ok: true; nastavitve: NastavitveKontrole } | { ok: false; napake: string[] };

/**
 * Preveri nastavitve iz vmesnika ali datoteke. Manjkajoca polja dobijo privzeto vrednost; podano, a neveljavno polje
 * zavrne celoto (z imenom polja), da uporabnik ve, kaj popraviti.
 */
export function normirajNastavitve(vnos: unknown): IzidNastavitev {
  const v = (vnos && typeof vnos === "object" ? vnos : {}) as Record<string, unknown>;
  const m = (v.meritev && typeof v.meritev === "object" ? v.meritev : {}) as Record<string, unknown>;
  const P = PRIVZETA_MERITEV;
  const napake: string[] = [];

  if (m.slovar_aruco !== undefined && m.slovar_aruco !== "DICT_4X4_50") napake.push("slovar_aruco");

  let oznake: Oznake = P.oznake;
  if (m.oznake !== undefined) {
    const o = m.oznake;
    const vnosi = o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>) : [];
    const veljavne = vnosi.every(
      ([id, t]) =>
        /^\d{1,2}$/.test(id) &&
        Number(id) <= NAJVEC_ID_OZNAKE &&
        Array.isArray(t) &&
        t.length === 3 &&
        vMejah(t[0], -2000, 2000) &&
        vMejah(t[1], -2000, 2000) &&
        vMejah(t[2], 10, 70),
    );
    if (!vnosi.length || vnosi.length > NAJVEC_OZNAK || !veljavne) napake.push("oznake");
    else oznake = Object.fromEntries(vnosi.map(([id, t]) => [String(Number(id)), [...(t as number[])] as [number, number, number]]));
  }

  let bela = P.bela_kartice_srgb;
  if (m.bela_kartice_srgb !== undefined) {
    const b = m.bela_kartice_srgb;
    if (Array.isArray(b) && b.length === 3 && b.every((c) => Number.isInteger(c) && vMejah(c, 150, 255))) bela = [b[0], b[1], b[2]];
    else napake.push("bela_kartice_srgb");
  }

  const stevilo = (ime: string, privzeto: number, a: number, b: number): number => {
    if (m[ime] === undefined) return privzeto;
    if (vMejah(m[ime], a, b)) return m[ime] as number;
    napake.push(ime);
    return privzeto;
  };
  const rob = stevilo("rob_bele_mm", P.rob_bele_mm, 1, 9);
  const ppm = stevilo("px_na_mm", P.px_na_mm, 1, 10);

  let obmocje = P.obmocje_mm;
  if (m.obmocje_mm !== undefined) {
    const o = m.obmocje_mm;
    if (Array.isArray(o) && o.length === 4 && o.every((x) => vMejah(x, -3000, 3000)) && o[2] > o[0] && o[3] > o[1]) obmocje = [o[0], o[1], o[2], o[3]];
    else napake.push("obmocje_mm");
  }
  if ((obmocje[2] - obmocje[0]) * ppm * (obmocje[3] - obmocje[1]) * ppm > NAJVEC_PORAVNANE) napake.push("obmocje_mm");

  let pricakovano = P.pricakovano;
  if (m.pricakovano !== undefined) {
    const p = (m.pricakovano && typeof m.pricakovano === "object" ? m.pricakovano : {}) as Record<string, unknown>;
    const zs = p.zgoraj_sredina_mm;
    if (Array.isArray(zs) && zs.length === 2 && zs.every((x) => vMejah(x, -2000, 2000)) && vMejah(p.sirina_mm, 10, 2000)) {
      pricakovano = { zgoraj_sredina_mm: [zs[0], zs[1]], sirina_mm: p.sirina_mm as number };
    } else napake.push("pricakovano");
  }

  const tolerance = { ...P.tolerance };
  if (m.tolerance !== undefined) {
    const t = (m.tolerance && typeof m.tolerance === "object" ? m.tolerance : {}) as Record<string, unknown>;
    for (const [k, [a, b]] of Object.entries(MEJE_TOLERANC) as Array<[keyof Tolerance, [number, number]]>) {
      if (t[k] === undefined) continue;
      if (vMejah(t[k], a, b)) tolerance[k] = t[k] as number;
      else napake.push(`tolerance.${k}`);
    }
  }

  let mapaDnevnika = "";
  if (v.mapaDnevnika !== undefined) {
    if (typeof v.mapaDnevnika === "string" && v.mapaDnevnika.length <= 1024 && !v.mapaDnevnika.includes("\0")) mapaDnevnika = v.mapaDnevnika.trim();
    else napake.push("mapaDnevnika");
  }
  if (v.opisZModelom !== undefined && typeof v.opisZModelom !== "boolean") napake.push("opisZModelom");

  if (napake.length) return { ok: false, napake: [...new Set(napake)] };
  return {
    ok: true,
    nastavitve: {
      meritev: { slovar_aruco: "DICT_4X4_50", oznake, bela_kartice_srgb: bela, rob_bele_mm: rob, px_na_mm: ppm, obmocje_mm: obmocje, pricakovano, tolerance },
      mapaDnevnika,
      opisZModelom: v.opisZModelom === true,
    },
  };
}

// ---------------------------------------------------------------- izid meritve

export type Ocena = "OK" | "NI OK" | "NI MOGOCE IZMERITI";

export type NapakaTiska = { vrsta: string; okvir_mm: [number, number, number, number]; povrsina_mm2: number; dE00_najvec: number };

export type IzidKontrole = {
  ocena: Ocena;
  razlogi: string[];
  /** Stalna koda, ko meritev ni mogoca (npr. knjiznice-manjkajo, fotografija-neberljiva); sicer null. */
  napaka: string | null;
  polozaj: null | {
    zgoraj_sredina_mm: [number, number];
    odmik_x_mm: number;
    odmik_y_mm: number;
    zasuk_deg: number;
    sirina_mm: number;
    sirina_odstopanje_rel: number;
  };
  /** Merilo = izmerjena sirina / pricakovana (1 = prava velikost). */
  merilo: number | null;
  barva: null | { dE00_povprecje: number; dE00_p95: number };
  registracija: null | { najvecji_zamik_mm: number; plasti: Array<{ barva_srgb: [number, number, number]; glede_na_kljucno_mm: [number, number]; zanesljivost: number }> };
  napake: NapakaTiska[];
  oznakeNajdene: number[];
  referenca: { vrsta: "motiv" | "prvi-kos" };
};

export const NAJVEC_NAPAK = 200;
export const NAJVEC_RAZLOGOV = 30;
const MEJA_NIZA = 300;
const KRMILNI = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function niz(v: unknown): string {
  return typeof v === "string" ? v.replace(KRMILNI, " ").slice(0, MEJA_NIZA) : "";
}
function par(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && v.every(jeStevilo) ? [v[0], v[1]] : null;
}

/** Izid ni mogoc: stalna koda in razlog (za prikaz in dnevnik). */
export function niMogoce(napaka: string, razlog: string): IzidKontrole {
  return {
    ocena: "NI MOGOCE IZMERITI",
    razlogi: [niz(razlog)],
    napaka: niz(napaka) || "neznano",
    polozaj: null,
    merilo: null,
    barva: null,
    registracija: null,
    napake: [],
    oznakeNajdene: [],
    referenca: { vrsta: "motiv" },
  };
}

/**
 * Preveri izid Pythona. OK in NI OK veljata samo s popolnim polozajem (koncna stevila); sicer NI MOGOCE IZMERITI.
 * OK z razlogi ali napakami je protisloven izid in se zavrne (nikoli lazni OK).
 */
export function preveriIzid(surovo: unknown): IzidKontrole {
  if (!surovo || typeof surovo !== "object" || Array.isArray(surovo)) return niMogoce("izid-neveljaven", "Meritev ni vrnila veljavnega izida.");
  const s = surovo as Record<string, unknown>;
  const razlogi = Array.isArray(s.razlogi) ? s.razlogi.slice(0, NAJVEC_RAZLOGOV).map(niz).filter(Boolean) : [];
  const napake: NapakaTiska[] = [];
  if (Array.isArray(s.napake)) {
    for (const n of s.napake.slice(0, NAJVEC_NAPAK)) {
      if (!n || typeof n !== "object") continue;
      const r = n as Record<string, unknown>;
      const ok = Array.isArray(r.okvir_mm) && r.okvir_mm.length === 4 && r.okvir_mm.every(jeStevilo);
      if (!ok || !jeStevilo(r.povrsina_mm2) || !jeStevilo(r.dE00_najvec)) continue;
      const o = r.okvir_mm as number[];
      napake.push({ vrsta: niz(r.vrsta) || "napaka", okvir_mm: [o[0], o[1], o[2], o[3]], povrsina_mm2: r.povrsina_mm2, dE00_najvec: r.dE00_najvec });
    }
  }
  const oznakeNajdene = Array.isArray(s.oznake_najdene) ? s.oznake_najdene.filter((x): x is number => Number.isInteger(x)).slice(0, NAJVEC_OZNAK) : [];
  const vrstaRef = (s.referenca as { vrsta?: unknown } | undefined)?.vrsta === "prvi-kos" ? "prvi-kos" : "motiv";

  if (s.ocena !== "OK" && s.ocena !== "NI OK") {
    const izid = niMogoce(niz(s.napaka) || "ni-izmerjeno", razlogi[0] ?? "Meritev ni mogoča.");
    return { ...izid, razlogi: razlogi.length ? razlogi : izid.razlogi, oznakeNajdene, referenca: { vrsta: vrstaRef } };
  }
  const p = (s.polozaj && typeof s.polozaj === "object" ? s.polozaj : {}) as Record<string, unknown>;
  const zs = par(p.zgoraj_sredina_mm);
  const polja = ["odmik_x_mm", "odmik_y_mm", "zasuk_deg", "sirina_mm", "sirina_odstopanje_rel"] as const;
  if (!zs || !polja.every((k) => jeStevilo(p[k]))) return { ...niMogoce("izid-nepopoln", "Meritev ni vrnila položaja motiva."), oznakeNajdene };
  if (s.ocena === "OK" && (razlogi.length || napake.length)) return { ...niMogoce("izid-protisloven", "Izid meritve je protisloven."), oznakeNajdene };
  if (s.ocena === "NI OK" && !razlogi.length) return { ...niMogoce("izid-protisloven", "Izid meritve je protisloven."), oznakeNajdene };

  const b = s.barva as Record<string, unknown> | undefined;
  const barva = b && jeStevilo(b.dE00_povprecje) && jeStevilo(b.dE00_p95) ? { dE00_povprecje: b.dE00_povprecje, dE00_p95: b.dE00_p95 } : null;
  // N3: OK brez izmerjene barve (tanek motiv) ni preverjen kos; registracija sme manjkati (enobarven motiv)
  if (s.ocena === "OK" && !barva) return { ...niMogoce("barva-ni-izmerjena", "Barve motiva ni bilo mogoče izmeriti; preverite ročno."), oznakeNajdene };
  const rg = s.registracija as Record<string, unknown> | undefined;
  let registracija: IzidKontrole["registracija"] = null;
  if (rg && jeStevilo(rg.najvecji_zamik_mm) && Array.isArray(rg.plasti)) {
    const plasti = rg.plasti.slice(0, 16).flatMap((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const z = par(r.glede_na_kljucno_mm);
      const c = r.barva_srgb;
      if (!z || !Array.isArray(c) || c.length !== 3 || !c.every((v) => Number.isInteger(v)) || !jeStevilo(r.zanesljivost)) return [];
      return [{ barva_srgb: [c[0], c[1], c[2]] as [number, number, number], glede_na_kljucno_mm: z, zanesljivost: r.zanesljivost }];
    });
    registracija = { najvecji_zamik_mm: rg.najvecji_zamik_mm, plasti };
  }
  const polozaj = {
    zgoraj_sredina_mm: zs,
    odmik_x_mm: p.odmik_x_mm as number,
    odmik_y_mm: p.odmik_y_mm as number,
    zasuk_deg: p.zasuk_deg as number,
    sirina_mm: p.sirina_mm as number,
    sirina_odstopanje_rel: p.sirina_odstopanje_rel as number,
  };
  return {
    ocena: s.ocena,
    razlogi,
    napaka: null,
    polozaj,
    merilo: Math.round((1 + polozaj.sirina_odstopanje_rel) * 10_000) / 10_000,
    barva,
    registracija,
    napake,
    oznakeNajdene,
    referenca: { vrsta: vrstaRef },
  };
}

// ---------------------------------------------------------------- dnevnik

export type ZapisDnevnika = {
  id: string;
  cas: string;
  nalog: string;
  referenca: string;
  vrstaReference: "motiv" | "prvi-kos";
  izid: IzidKontrole;
  /** Ime oznacene slike v mapi dnevnika (brez poti); prazno, ce je ni. */
  slika: string;
  /** Narocilo podjetja, ce je nalog ENAK znani stevilki naloga (narociloZaNalog); brez zadetka polja ni - nikoli ugibanja. */
  narocilo?: { stevilka: string; stranka: string };
};

export const DATOTEKA_DNEVNIKA_CSV = "kontrola-tiska.csv";
export const DATOTEKA_DNEVNIKA_JSONL = "kontrola-tiska.jsonl";
export const GLAVA_CSV =
  "cas;id;nalog;referenca;vrsta_reference;ocena;odmik_x_mm;odmik_y_mm;zasuk_deg;sirina_mm;merilo;dE00_povprecje;dE00_p95;zamik_barv_mm;st_napak;razlogi;slika;narocilo;stranka";

/**
 * Celica CSV (locilo ;): v narekovajih; zacetek = + - @ TAB CR se nevtralizira z ' (vbrizg formul v preglednico).
 * Stevila z decimalno VEJICO: slovenski Excel bi »1.5« prebral kot datum (1. maj).
 */
export function celicaCsv(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
  s = s.replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function vrsticaCsv(z: ZapisDnevnika): string {
  const i = z.izid;
  const p = i.polozaj;
  return [
    z.cas,
    z.id,
    z.nalog,
    z.referenca,
    z.vrstaReference,
    i.ocena,
    p?.odmik_x_mm,
    p?.odmik_y_mm,
    p?.zasuk_deg,
    p?.sirina_mm,
    i.merilo,
    i.barva?.dE00_povprecje,
    i.barva?.dE00_p95,
    i.registracija?.najvecji_zamik_mm,
    i.napake.length,
    i.razlogi.join(" | "),
    z.slika,
    z.narocilo?.stevilka,
    z.narocilo?.stranka,
  ]
    .map(celicaCsv)
    .join(";");
}

// ---------------------------------------------------------------- vhodne slike

/** Najvec bajtov ene slike (fotografija telefona 12-50 MP v JPEG je 3-20 MB). */
export const NAJVEC_BAJTOV_SLIKE = 30 * 1024 * 1024;

/** Najvec slikovnih tock (enako kot NAJVEC_TOCK v kontrola_tiska.py); vecja slika se zavrne pred dekodiranjem (N1). */
export const NAJVEC_TOCK_SLIKE = 60_000_000;

/** Mere slike iz glave (PNG IHDR, JPEG SOFn), brez dekodiranja; null = glave ni mogoce prebrati. */
export function mereSlike(b: Uint8Array): { sirina: number; visina: number } | null {
  const v = vrstaSlike(b);
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  if (v === "png") {
    if (b.length < 24 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
    const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    return { sirina: u32(16), visina: u32(20) };
  }
  if (v !== "jpg") return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null; // konec ali podatki pred SOF: mer ni
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { sirina: u16(i + 7), visina: u16(i + 5) };
    i += 2 + u16(i + 2);
  }
  return null;
}

/** Slika z berljivimi merami in najvec NAJVEC_TOCK_SLIKE tockami (slika-bomba: majhna datoteka, vec GB ob dekodiranju). */
export function sprejemljiveMere(b: Uint8Array): boolean {
  const m = mereSlike(b);
  return !!m && m.sirina > 0 && m.visina > 0 && m.sirina * m.visina <= NAJVEC_TOCK_SLIKE;
}

/** Vrsta slike po prvih bajtih (ne po imenu): samo JPEG in PNG. */
export function vrstaSlike(b: Uint8Array): "jpg" | "png" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((x, i) => b[i] === x)) return "png";
  return null;
}

/** Nalog (oznaka naloga ali motiva) za dnevnik: kratek, brez krmilnih znakov. */
export function cistNalog(v: unknown): string {
  return niz(v).trim().slice(0, 80);
}

// ---------------------------------------------------------------- namestitev knjiznic

/**
 * Natancne razlicice iz okolja, v katerem je prototip izmeril natancnost (POROCILO.md prototipa); licence: OpenCV Apache-2.0,
 * numpy BSD-3 (in druge proste), scikit-image BSD-3. Samo kolesa (--only-binary): pip ne zazene nobenega setup.py.
 */
export const PAKETI_VIDA = ["opencv-contrib-python-headless==5.1.0.95", "numpy==2.5.5", "scikit-image==0.26.0"] as const;

/** Mapa okolja Python za vid v podatkovni mapi Line (ne v sistemu, brez skrbniskih pravic). */
export const MAPA_OKOLJA = "kontrola-tiska-python";

/** Python v okolju venv: Windows Scripts\python.exe, drugje bin/python. */
export function pythonOkolja(mapaOkolja: string, windows: boolean): string {
  return windows ? `${mapaOkolja}\\Scripts\\python.exe` : `${mapaOkolja}/bin/python`;
}

/** Sistemski Python za ustvarjanje okolja: Windows zaganjalnik »py -3«, drugje python3. */
export function sistemskiPython(windows: boolean): { program: string; args: string[] } {
  return windows ? { program: "py", args: ["-3"] } : { program: "python3", args: [] };
}

// -I: trenutna mapa procesa Line ne gre v sys.path (pip.py/venv/ v njej se ne izvede).
export function argumentiVenv(mapaOkolja: string): string[] {
  return ["-I", "-m", "venv", mapaOkolja];
}

/**
 * --isolated: pip ne bere PIP_* iz okolja ne pip.conf (zrcalo ali extra-index bi zamenjal vir); --index-url: samo uradni PyPI.
 * Pripeti so samo PAKETI_VIDA; njihove odvisnosti in zgoscene vrednosti (--require-hashes) se NISO pripete (odprto, N2).
 */
export function argumentiPip(): string[] {
  return ["-I", "-m", "pip", "install", "--isolated", "--disable-pip-version-check", "--no-input", "--no-cache-dir", "--index-url", "https://pypi.org/simple", "--only-binary=:all:", ...PAKETI_VIDA];
}

// ---------------------------------------------------------------- opis z modelom z vidom

/**
 * Navodilo modelu z vidom: samo besedni opis napak na oznaceni sliki. Stevilk ne sme dati; stevilke v odgovoru Lina
 * odstrani (odstraniStevilke), ker so edine veljavne stevilke tiste iz meritve.
 */
export const NAVODILO_OPISA =
  "Si pomočnik kontrolorja tiska. Dobiš fotografijo tiska, poravnano na mizo, z rdeče označenimi mesti napak. " +
  "Z besedami opiši, kaj vidiš na označenih mestih (npr. nitka, razmaz, pikice, manjkajoč del, madež, zamik barve) in ali vidiš še kaj, " +
  "kar bi kontrolor moral pogledati (napačen motiv, napis narobe, napačna stran). Ne navajaj nobenih številk, mer, odstotkov ali ocene " +
  "OK/NI OK: te določi samo meritev. Napake opisuj po legi (zgoraj levo, na sredini ...). Največ 6 kratkih alinej, slovensko.";

// N4: stevniki (sl, en) kot cele besede; \b ne pozna č, š, ž, zato meje po crkah in stevkah Unicode.
// R5 (24. 11. 2026): tudi sestavljeni (petindvajset, dvesto), pregibani (petnajstih, treh) in -krat; »en/ena/eno/eden/enega/nič/one/
// zero« so lahko clen ali »ni nič narobe«, zato se odstranijo samo pred enoto.
const ENICE = "dva|tri|štiri|pet|šest|sedem|osem|devet";
const DESETICE = "dvajset|trideset|štirideset|petdeset|šestdeset|sedemdeset|osemdeset|devetdeset";
const NAJST = "enajst|dvanajst|trinajst|štirinajst|petnajst|šestnajst|sedemnajst|osemnajst|devetnajst";
const STEVNIKI = [
  `(?:(?:ena|${ENICE})in(?:${DESETICE})|${DESETICE}|${NAJST}|deset)(?:ih|im|imi|ega|emu)?`,
  `(?:dve|${ENICE.replace("dva|", "")})?sto|(?:dva|dve)?tisoč|milijon\\p{L}*|milijard\\p{L}*`,
  `(?:en|dva|dve|tri|štiri|pet|šest|sedem|osem|devet|deset)krat`,
  `dve|dvema|dveh|trije|treh|tremi|trem|štirje|štirih|štirim|petih|šestih|sedmih|osmih|devetih|${ENICE}|pol|polovico|četrt`,
  "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen",
  "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|twice|thrice|half|quarter",
].join("|");
const PRED_ENOTO = "nič|ena|en|eno|eden|enega|zero|one";
const ENOTA = "mm|cm|°|%|stopinj\\p{L}*|milimet\\p{L}*|centimet\\p{L}*|odstot\\p{L}*|millimet\\p{L}*|degree\\p{L}*|percent";
// stevke brez mej (tudi »5mm«, »2x«), stevniki samo kot cele besede
const STEVILKA = new RegExp(
  `(?:\\p{N}+(?:[.,]\\p{N}+)?|(?<![\\p{L}\\p{N}])(?:${STEVNIKI})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:${PRED_ENOTO})(?=\\s*(?:${ENOTA})))(\\s*(${ENOTA}))?`,
  "giu",
);
const OCENA = /(?<![\p{L}\p{N}])(?:ni\s+)?ok(?![\p{L}\p{N}])/giu;

/** Iz besedila modela odstrani stevilke (stevke vseh pisav, stevnike) in oceno OK/NI OK: stevilke in ocena so samo iz meritve. */
export function odstraniStevilke(besedilo: string): string {
  return besedilo
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .normalize("NFKC")
    .replace(STEVILKA, "…")
    .replace(OCENA, "…")
    .slice(0, 2000);
}

/**
 * N5 (B9): klic modela z vidom za opis tiska. Slika motiva stranke gre SAMO izbranemu ponudniku in modelu: nikoli prek OmniRoute
 * (posreduje tudi brezplacnim tretjim ponudnikom), nikoli samodejno zamenjanemu modelu, brez prehoda in brez brezplacnih modelov.
 * null = ponudnik ni dovoljen za slike strank.
 */
export function klicOpisa(
  brain: { provider: string; model: string; key: string; project?: string; location?: string; naslov?: string },
  slika: Uint8Array,
) {
  if (brain.provider === "omniroute") return null;
  const { provider, model, key, project, location, naslov } = brain;
  return {
    provider,
    model,
    key,
    project,
    location,
    naslov,
    text: "Opiši označene napake na tej fotografiji tiska.",
    system: NAVODILO_OPISA,
    priponke: [{ ime: "kontrola.png", mime: "image/png", podatki: Buffer.from(slika).toString("base64"), vrsta: "slika" }],
    najvecVhoda: 2000,
    maxTokens: 500,
    najvecZnakov: 2000,
    timeoutMs: 60_000,
    vsebinaKlica: false,
    brezZamenjave: true,
  };
}
