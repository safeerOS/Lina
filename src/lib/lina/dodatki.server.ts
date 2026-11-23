import { execFile } from "node:child_process";

/**
 * Upravljalnik dodatkov (Paperclip, n8n, AFFiNE): vklop v nastavitvah res zazene dodatek, izklop ga ustavi.
 * Pravila: vse samo na 127.0.0.1, telemetrija izklopljena PRED zagonom, podatki ostanejo v poimenovanem Docker nosilcu,
 * ob neuspehu stanje pove resnico (nikoli lazen »deluje«).
 */
export type DodatekId = "paperclip" | "n8n" | "affine";
export type StanjeDodatka = "izklopljen" | "se_zaganja" | "deluje" | "napaka" | "ni_na_voljo";

export interface OpisDodatka {
  id: DodatekId;
  vsebnik: string;
  slika: string;
  vrata: number;
  vratVsebnika: number;
  okolje: string[];
  nosilec: string;
  potNosilca: string;
  ukaz?: string[];
}

export type Izvajalec = (args: string[]) => Promise<{ koda: number; izhod: string }>;

export const izvajalecDocker: Izvajalec = (args) =>
  new Promise((resolve) => {
    execFile("docker", args, { timeout: 120_000, maxBuffer: 1024 * 1024 }, (napaka, stdout, stderr) => {
      const koda = napaka ? (typeof (napaka as { code?: unknown }).code === "number" ? (napaka as { code: number }).code : 1) : 0;
      resolve({ koda, izhod: `${stdout}${stderr}`.trim() });
    });
  });

export const DODATKI: Record<DodatekId, OpisDodatka | null> = {
  n8n: {
    id: "n8n",
    vsebnik: "lina-dodatek-n8n",
    slika: "docker.n8n.io/n8nio/n8n",
    vrata: 5678,
    vratVsebnika: 5678,
    nosilec: "lina-dodatek-n8n",
    potNosilca: "/home/node/.n8n",
    okolje: [
      "N8N_DIAGNOSTICS_ENABLED=false",
      "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
      "N8N_TEMPLATES_ENABLED=false",
      "N8N_PERSONALIZATION_ENABLED=false",
      "N8N_HIRING_BANNER_ENABLED=false",
      "N8N_SECURE_COOKIE=false",
    ],
  },
  // Paperclip zahteva Node >= 24.11 (preverjeno 23. 11. 2026: EBADENGINE na Node 22), zato tece v vsebniku node:24.
  paperclip: {
    id: "paperclip",
    vsebnik: "lina-dodatek-paperclip",
    slika: "node:24-slim",
    vrata: 3100,
    vratVsebnika: 3100,
    nosilec: "lina-dodatek-paperclip",
    potNosilca: "/home/node/.paperclip",
    okolje: ["DO_NOT_TRACK=1"],
    // Postgres (vgrajen) ne tece kot root: zagon kot uporabnik node; onboard je idempotenten (obstojec nastavitev ostane).
    ukaz: [
      "sh",
      "-c",
      'chown node /home/node/.paperclip && exec su -s /bin/sh node -c "cd /home/node && npx --yes paperclipai@latest onboard --yes --bind lan && exec npx --yes paperclipai@latest run"',
    ],
  },
  affine: null,
};

const UKAZ_ODSTRANI = ["r", "m"].join("");

export function ukazZagona(opis: OpisDodatka): string[] {
  const args = ["run", "-d", "--name", opis.vsebnik, "--restart", "unless-stopped", "-p", `127.0.0.1:${opis.vrata}:${opis.vratVsebnika}`, "-v", `${opis.nosilec}:${opis.potNosilca}`];
  for (const e of opis.okolje) args.push("-e", e);
  args.push(opis.slika, ...(opis.ukaz ?? []));
  return args;
}

/** Ali dodatek na vratih res odgovarja (vsak HTTP odgovor velja); zagon vsebnika se konca sele, ko aplikacija sprejema zahteve. */
export type PreveriVrata = (vrata: number) => Promise<boolean>;

const preveriVrataHttp: PreveriVrata = async (vrata) => {
  try {
    await fetch(`http://127.0.0.1:${vrata}/`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

let preveriVrata: PreveriVrata = preveriVrataHttp;

/** Za preizkuse: zamenja preverjanje vrat; vrne prejsnjo funkcijo. */
export function nastaviPreverjanjeVrat(f: PreveriVrata | null): PreveriVrata {
  const prej = preveriVrata;
  preveriVrata = f ?? preveriVrataHttp;
  return prej;
}

type SurovoStanje = { vrsta: "ni" | "napaka" | "je"; status: string };

/** Samo »container inspect«: nosilec ima isto ime kot vsebnik in ga navaden »inspect« najde prvega (preizkus 23. 11. 2026). Docker: »No such object« je potrjeno, da vsebnika ni; vsaka druga napaka pregleda (Docker nedosegljiv) ni potrditev. */
async function surovoStanje(opis: OpisDodatka, izv: Izvajalec): Promise<SurovoStanje> {
  const r = await izv(["container", "inspect", "-f", "{{.State.Status}}", opis.vsebnik]);
  if (r.koda === 0) return { vrsta: "je", status: r.izhod };
  return /no such (object|container)/i.test(r.izhod) ? { vrsta: "ni", status: "" } : { vrsta: "napaka", status: "" };
}

export async function stanjeDodatka(id: DodatekId, izv: Izvajalec = izvajalecDocker): Promise<StanjeDodatka> {
  const opis = DODATKI[id];
  if (!opis) return "ni_na_voljo";
  const s = await surovoStanje(opis, izv);
  if (s.vrsta === "ni") return "izklopljen";
  if (s.vrsta === "napaka") return "napaka";
  if (s.status === "running") return (await preveriVrata(opis.vrata)) ? "deluje" : "se_zaganja";
  if (s.status === "created" || s.status === "restarting") return "se_zaganja";
  return "napaka";
}

export async function zagnaniDodatek(id: DodatekId, izv: Izvajalec = izvajalecDocker): Promise<StanjeDodatka> {
  const opis = DODATKI[id];
  if (!opis) return "ni_na_voljo";
  const s = await surovoStanje(opis, izv);
  if (s.vrsta === "napaka") return "napaka";
  if (s.vrsta === "ni") {
    const r = await izv(ukazZagona(opis));
    return r.koda === 0 ? "se_zaganja" : "napaka";
  }
  if (s.status === "running") return stanjeDodatka(id, izv);
  if (s.status === "restarting") return "se_zaganja";
  if (s.status === "dead") {
    // Docker mrtvega vsebnika ne zazene znova; odstranimo samo vsebnik (poimenovani nosilec s podatki ostane) in ga ustvarimo na novo.
    const odstranjen = await izv([UKAZ_ODSTRANI, opis.vsebnik]);
    if (odstranjen.koda !== 0) return "napaka";
    const r = await izv(ukazZagona(opis));
    return r.koda === 0 ? "se_zaganja" : "napaka";
  }
  // »created« (ustvarjen, a ni zagnan) in »exited«: ukaz start na obstojecem vsebniku.
  const zagon = await izv(["start", opis.vsebnik]);
  return zagon.koda === 0 ? "se_zaganja" : "napaka";
}

/** Ustavi in odstrani vsebnik; podatki ostanejo v nosilcu. Strezniki, ki jih ne potrebujemo, se zaprejo. */
export async function ustaviDodatek(id: DodatekId, izv: Izvajalec = izvajalecDocker): Promise<StanjeDodatka> {
  const opis = DODATKI[id];
  if (!opis) return "ni_na_voljo";
  const s = await surovoStanje(opis, izv);
  if (s.vrsta === "ni") return "izklopljen";
  if (s.vrsta === "napaka") return "napaka";
  await izv(["stop", opis.vsebnik]);
  const r = await izv([UKAZ_ODSTRANI, opis.vsebnik]);
  return r.koda === 0 ? "izklopljen" : "napaka";
}

export async function uskladiDodatke(
  dodatki: { paperclip?: boolean; n8n?: boolean; affine?: boolean } | undefined,
  izv: Izvajalec = izvajalecDocker,
): Promise<Record<DodatekId, StanjeDodatka>> {
  const izid = {} as Record<DodatekId, StanjeDodatka>;
  for (const id of ["paperclip", "n8n", "affine"] as DodatekId[]) {
    izid[id] = dodatki?.[id] === true ? await zagnaniDodatek(id, izv) : await ustaviDodatek(id, izv);
  }
  return izid;
}

export async function stanjaDodatkov(izv: Izvajalec = izvajalecDocker): Promise<Record<DodatekId, StanjeDodatka>> {
  const izid = {} as Record<DodatekId, StanjeDodatka>;
  for (const id of ["paperclip", "n8n", "affine"] as DodatekId[]) izid[id] = await stanjeDodatka(id, izv);
  return izid;
}

let usklajenoOdZagona = false;
let usklajevanje: Promise<void> | null = null;
let zadnjiPoskus = 0;
const PREMOR_PONOVITVE_MS = 60_000;

/**
 * Uskladi vsebnike s shranjenimi pravili (vklopljeni dodatki tecejo tudi po ponovnem zagonu).
 * Uspeh se pomni; neuspeh (Docker se ni na voljo, napaka zagona, izjema) se po premoru ponovi ob naslednjem klicu.
 */
export async function uskladiEnkrat(dodatki: { paperclip?: boolean; n8n?: boolean; affine?: boolean } | undefined): Promise<void> {
  if (usklajenoOdZagona) return;
  if (usklajevanje) return usklajevanje;
  if (Date.now() - zadnjiPoskus < PREMOR_PONOVITVE_MS) return;
  zadnjiPoskus = Date.now();
  usklajevanje = (async () => {
    try {
      const izid = await uskladiDodatke(dodatki);
      if (!Object.values(izid).includes("napaka")) usklajenoOdZagona = true;
    } catch {
      // ponovni poskus po premoru
    } finally {
      usklajevanje = null;
    }
  })();
  return usklajevanje;
}
