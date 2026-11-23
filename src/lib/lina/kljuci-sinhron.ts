import { hkdfSync, randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

export const VRSTE_KLJUCEV = ["gemini", "vertex", "twilio", "tinyfish", "brave", "soniox", "sip"] as const;
export type VrstaKljuca = (typeof VRSTE_KLJUCEV)[number];

export function jeVrstaKljuca(v: unknown): v is VrstaKljuca {
  return typeof v === "string" && (VRSTE_KLJUCEV as readonly string[]).includes(v);
}

export type StanjeKljuca = {
  vrsta: VrstaKljuca;
  rev: number;
  gen: number;
  stanje: "nastavljen" | "pozabljen" | "brez";
  vrednost: string | null;
  izvor: string;
  cas: number;
  konflikt: { izvor: string; odtis: string; cas: number } | null;
};

export type Zapis = {
  vrsta: VrstaKljuca;
  baza: number;
  gen: number;
  izvor: string;
  cas: number;
  vrednost: string | null;
};

export type IzidZapisa =
  | { izid: "sprejet"; stanje: StanjeKljuca }
  | { izid: "brez-spremembe"; stanje: StanjeKljuca }
  | { izid: "konflikt"; stanje: StanjeKljuca }
  | { izid: "zastarel"; stanje: StanjeKljuca }
  | { izid: "neveljaven"; razlog: "vrsta" | "vrednost" | "polja" };

export function prazno(vrsta: VrstaKljuca): StanjeKljuca {
  return {
    vrsta,
    rev: 0,
    gen: 0,
    stanje: "brez",
    vrednost: null,
    izvor: "",
    cas: 0,
    konflikt: null
  };
}

export function odtisKljuca(vrednost: string): string {
  if (!vrednost) return "";
  return createHash("sha256").update(vrednost, "utf-8").digest("hex").slice(0, 6);
}

export function zaPrikaz(stanje: StanjeKljuca): { vrsta: VrstaKljuca; rev: number; gen: number; stanje: StanjeKljuca["stanje"]; izvor: string; cas: number; odtis: string; konflikt: boolean } {
  return {
    vrsta: stanje.vrsta,
    rev: stanje.rev,
    gen: stanje.gen,
    stanje: stanje.stanje,
    izvor: stanje.izvor,
    cas: stanje.cas,
    odtis: stanje.stanje === "nastavljen" && stanje.vrednost ? odtisKljuca(stanje.vrednost) : "",
    konflikt: stanje.konflikt !== null
  };
}

export function uporabiZapis(stanje: StanjeKljuca, zapis: Zapis): IzidZapisa {
  if (!jeVrstaKljuca(zapis.vrsta) || zapis.vrsta !== stanje.vrsta) {
    return { izid: "neveljaven", razlog: "vrsta" };
  }
  
  if (
    typeof zapis.baza !== "number" || zapis.baza < 0 || !Number.isInteger(zapis.baza) ||
    typeof zapis.gen !== "number" || zapis.gen < 0 || !Number.isInteger(zapis.gen) ||
    typeof zapis.izvor !== "string" || !zapis.izvor || zapis.izvor.length > 80 || !/^[A-Za-z0-9._-]+$/.test(zapis.izvor) ||
    typeof zapis.cas !== "number" || !Number.isFinite(zapis.cas) || zapis.cas < 0
  ) {
    return { izid: "neveljaven", razlog: "polja" };
  }
  
  if (zapis.baza > stanje.rev) {
    return { izid: "neveljaven", razlog: "polja" };
  }
  
  if (zapis.vrednost !== null) {
    if (
      typeof zapis.vrednost !== "string" ||
      zapis.vrednost.length < 8 ||
      zapis.vrednost.length > 200 ||
      /\s/.test(zapis.vrednost) ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1F\x7F]/.test(zapis.vrednost)
    ) {
      return { izid: "neveljaven", razlog: "vrednost" };
    }
  }

  if (zapis.gen < stanje.gen) {
    return { izid: "zastarel", stanje };
  }

  if (zapis.vrednost === null) {
    if (stanje.stanje !== "nastavljen") {
      return { izid: "brez-spremembe", stanje };
    }
    if (zapis.baza === stanje.rev) {
      return {
        izid: "sprejet",
        stanje: {
          ...stanje,
          rev: stanje.rev + 1,
          gen: stanje.gen + 1,
          stanje: "pozabljen",
          vrednost: null,
          izvor: zapis.izvor,
          cas: zapis.cas,
          konflikt: null
        }
      };
    } else {
      return {
        izid: "konflikt",
        stanje: {
          ...stanje,
          konflikt: {
            izvor: zapis.izvor,
            odtis: "",
            cas: zapis.cas
          }
        }
      };
    }
  }
  
  if (stanje.stanje === "nastavljen" && stanje.vrednost === zapis.vrednost) {
    return { izid: "brez-spremembe", stanje };
  }
  
  if (zapis.baza === stanje.rev) {
    return {
      izid: "sprejet",
      stanje: {
        ...stanje,
        rev: stanje.rev + 1,
        stanje: "nastavljen",
        vrednost: zapis.vrednost,
        izvor: zapis.izvor,
        cas: zapis.cas,
        konflikt: null
      }
    };
  } else {
    return {
      izid: "konflikt",
      stanje: {
        ...stanje,
        konflikt: {
          izvor: zapis.izvor,
          odtis: odtisKljuca(zapis.vrednost),
          cas: zapis.cas
        }
      }
    };
  }
}

export type Ovojnica = { v: 1; iv: string; ct: string; tag: string };
export const NAMEN_OVOJNICE = "lina-kljuci-v1";

export function izpeljiKljucOvoja(skrivnost: Buffer, sol: Buffer): Buffer {
  if (skrivnost.length < 16 || sol.length < 16) {
    throw new Error("kljuc");
  }
  return Buffer.from(hkdfSync("sha256", skrivnost, sol, NAMEN_OVOJNICE, 32));
}

export function aadOvojnice(p: { vrsta: VrstaKljuca; rev: number; gen: number; izvor: string; smer: "telefon-racunalnik" | "racunalnik-telefon" }): Buffer {
  return Buffer.from(`${NAMEN_OVOJNICE}|${p.vrsta}|${p.rev}|${p.gen}|${p.izvor}|${p.smer}`, "utf-8");
}

export function zapakiraj(kljucOvoja: Buffer, vrednost: string, aad: Buffer): Ovojnica {
  if (kljucOvoja.length !== 32) throw new Error("kljuc");
  
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kljucOvoja, iv);
  cipher.setAAD(aad);
  
  const ct = Buffer.concat([cipher.update(vrednost, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64")
  };
}

export function odpakiraj(kljucOvoja: Buffer, o: Ovojnica, aad: Buffer): string {
  try {
    if (kljucOvoja.length !== 32) throw new Error("kljuc");
    if (o.v !== 1 || typeof o.iv !== "string" || typeof o.ct !== "string" || typeof o.tag !== "string") {
      throw new Error("ovojnica");
    }
    
    const iv = Buffer.from(o.iv, "base64");
    const ct = Buffer.from(o.ct, "base64");
    const tag = Buffer.from(o.tag, "base64");
    if (tag.length !== 16) throw new Error("ovojnica");
    if (iv.length !== 12) throw new Error("ovojnica");
    
    const decipher = createDecipheriv("aes-256-gcm", kljucOvoja, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf-8");
  } catch (e: any) {
    if (e.message === "kljuc") throw e;
    throw new Error("ovojnica");
  }
}
