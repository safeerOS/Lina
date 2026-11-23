import { existsSync, mkdirSync } from "node:fs";
import { obnoviOsvezevanjePoMenjavi, pozabiZeton, vertexAccessToken } from "./adc.server.ts";
import { preberiProjekteRest, type ProjektGoogle } from "./google-projekti.ts";
import { httpsFetch } from "./providers.ts";
import { requireOwner } from "./auth.server.ts";
import { mapaOrodja, mapaPrijave } from "./google-poti.server.ts";
import { arhivZaPlatformo, namestiGcloud } from "./gcloud-namestitev.server.ts";
import {
  poisciGcloud,
  potAdc,
  pozabiGoogle,
  preberiProjekte,
  preklicPrijave,
  stanjePrijave,
  vnesiKodoPrijave,
  zacniPrijavo,
  type StanjePrijave,
} from "./prijava-google.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { klicTece } from "./voice.server.ts";

/**
 * Googlov racun Line (lastnik 11. 11. 2026): en gumb, privzeti brskalnik, gcloud v Lini lastni mapi, dovoljenje za
 * namestitev, pozabi/zamenjaj racun. Vse zahteva lastnika (prijava v Lino); odjemalec ne poslje nobene poti ali ukaza.
 */
export type StanjeNamestitve = "mirno" | "tece" | "uspeh" | "napaka";

export type StanjeGoogleRacuna = {
  gcloudNajden: boolean;
  namestljiv: boolean;
  namestitev: { faza: StanjeNamestitve; sporocilo: string | null };
  prijavljen: boolean;
  prijava: StanjePrijave;
  klicTece: boolean;
};

let namestitev: { faza: StanjeNamestitve; sporocilo: string | null } = { faza: "mirno", sporocilo: null };
let uspehPrijaveObdelan = true;

function prijavaPoUspehu(): StanjePrijave {
  const p = stanjePrijave();
  // Po uspesni prijavi se mora zeton pridobiti znova z novo datoteko (enkrat).
  if (p.faza === "uspeh" && !uspehPrijaveObdelan) {
    uspehPrijaveObdelan = true;
    pozabiZeton();
    obnoviOsvezevanjePoMenjavi();
  }
  if (p.faza === "caka") uspehPrijaveObdelan = false;
  return p;
}

export async function stanjeGoogleRacuna(token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return {
    gcloudNajden: poisciGcloud(mapaOrodja(root)) !== null,
    namestljiv: arhivZaPlatformo() !== null,
    namestitev: { ...namestitev },
    prijavljen: existsSync(potAdc(mapaPrijave(root))),
    prijava: prijavaPoUspehu(),
    klicTece: klicTece(root),
  };
}

/** Namestitev SAMO ob izrecnem dovoljenju uporabnika (soglasje === true); ena naenkrat. */
export async function namestiGcloudPoDovoljenju(soglasje: unknown, token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (soglasje !== true) throw new Error("Namestitev zahteva dovoljenje uporabnika.");
  if (namestitev.faza !== "tece" && poisciGcloud(mapaOrodja(root)) === null) {
    namestitev = { faza: "tece", sporocilo: null };
    const izid = await namestiGcloud(mapaOrodja(root));
    namestitev = izid.uspeh ? { faza: "uspeh", sporocilo: null } : { faza: "napaka", sporocilo: izid.sporocilo };
  }
  return stanjeGoogleRacuna(token, dir);
}

export async function zacniGooglePrijavo(token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (klicTece(root)) throw new Error("Med klicem računa ni mogoče menjati.");
  const gcloud = poisciGcloud(mapaOrodja(root));
  if (gcloud) {
    mkdirSync(mapaPrijave(root), { recursive: true, mode: 0o700 });
    uspehPrijaveObdelan = false;
    zacniPrijavo(gcloud, mapaPrijave(root));
  }
  return stanjeGoogleRacuna(token, dir);
}

/** Verifikacijska koda, ko gcloud brez brskalnika zahteva kodo (15. 11. 2026). Koda gre samo na stdin procesa; nikjer se ne zapise. */
export async function vnesiKodoGooglePrijave(koda: unknown, token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  vnesiKodoPrijave(koda);
  return stanjeGoogleRacuna(token, dir);
}

export async function preklicGooglePrijave(token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  preklicPrijave();
  return stanjeGoogleRacuna(token, dir);
}

export async function projektiGoogle(token: string | null, dir?: string): Promise<ProjektGoogle[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const gcloud = poisciGcloud(mapaOrodja(root));
  if (!gcloud || !existsSync(potAdc(mapaPrijave(root)))) return [];
  // 22. 11. 2026: REST z zetonom ADC (projekti in obracun, kot telefon); gcloud projects list po prijavi ADC vrne prazno.
  const rest = await vertexAccessToken()
    .then((zeton) => preberiProjekteRest(zeton, (url, init) => httpsFetch(url, init)))
    .catch(() => [] as ProjektGoogle[]);
  if (rest.length) return rest;
  return (await preberiProjekte(gcloud, mapaPrijave(root))).map((p) => ({ ...p, obracun: null }));
}

/** Pozabi Googlov racun (preklic, brisanje Line mape, zeton iz pomnilnika). Med klicem ne. */
export async function pozabiGoogleRacun(token: string | null, dir?: string): Promise<StanjeGoogleRacuna> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (klicTece(root)) throw new Error("Med klicem računa ni mogoče menjati.");
  await pozabiGoogle(poisciGcloud(mapaOrodja(root)), mapaPrijave(root), pozabiZeton);
  return stanjeGoogleRacuna(token, dir);
}
