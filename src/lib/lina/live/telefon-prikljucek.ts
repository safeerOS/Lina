/**
 * Prilagodilnik poti telefona za most Live (L3, 15. 11. 2026): PrikljucekTelefona (glas-telefon.server.ts, L2) <-> LiveMost.
 * Cista logika brez omrezja in diska (odvisnosti so vbrizgane), kot TwilioVrata pri poti Twilio.
 *
 * Kaj dela:
 *  - zacni: klic dobi svoj LiveMost; telefon se mostu predstavi kot Twilio 'start' (zeton je ZAPRT v tem prilagodilniku, ne
 *    pride od zunaj; remoteNumber je samo podatek za zapis, callId se ne uporabi, nic od tega ne odloca).
 *  - pozdrav: zacniKlicTelefon (L4) poslje pozdrav z razkritjem UI kot PRVI zvok (surov PCM 16 kHz), Live se odpre sele po
 *    njem; brez razkritja ali posnetka se klic zavrne in Live se ne odpre (isto pravilo kot pot Twilio).
 *  - zvok: surov PCM 16 kHz od telefona gre naravnost v most (LiveMost.naPcm16k) po isti poti kot Twilio vhod: iste varovalke
 *    (cena/rok/obljuba, ura, stikalo naPot, razkritje UI v pozdravu) so v LiveMost in jih ta datoteka ne obide ne spremeni.
 *  - izhod: most govori v obliki Twilio (mu-law 8 kHz, JSON); prilagodilnik ga pretvori v surov PCM 16 kHz proti telefonu;
 *    'clear' (prekinitev, varovalka) postane {"type":"clear"}; 'mark' vrne mostu, ko je po oceni predvajano (telefon marka ne pozna).
 *  - ustavi (stop, odklop, napaka): most se zakljuci (zapis klica, Live seja, zasedenost), casovniki se pospravijo.
 *  - VAROVALKE KOT POT TWILIO (L-04, 15. 11. 2026): pred mostom `sprejem` preveri linijo odprto, nacin prevzema/uro in »en klic naenkrat«
 *    (zapis v aktivniKlici skupaj s potjo Twilio); stikalo glasu telefona nadomesti nastavitev naPot (locena odlocitev lastnika).
 *    Oznako zapisa klica (callSid) izda Lina sama (tel-<16 hex>), callId od telefona ne gre v knjigo klicev (L-03).
 * Ta pot ne spreminja klicev Twilia: vstop.server.ts in zeton.ts se je ne dotakneta.
 */
import { randomBytes } from "node:crypto";
import type { PrikljucekTelefona, RazlogKonca, VrataTelefona } from "../glas-telefon.server.ts";
import { LiveMost, type NacinBesedila, type OdvisnostiMosta, type TwilioVrata } from "./most.ts";
import { OKVIR_PCM16_BAJTOV, zacniKlicTelefon } from "./pozdrav-telefon.ts";
import { Prevzorcevalnik, mulawVPcm, pcmVBajte } from "./zvok.ts";

/** Sintetican streamSid za most (ne zapusti procesa). */
const STREAM_SID = "MZtelefon";
/** Bajtov surovega PCM 16 kHz mono s16le na ms: 2 bajta na vzorec, 16 vzorcev na ms. */
const BAJTOV_NA_MS = 32;

export type OdvisnostiPrikljucka = {
  /** Odvisnosti mosta za ta klic (v produkciji pravaOdvisnost, v preizkusih lazne). porabiZeton in zacetekKlica prilagodilnik PREPISE. */
  odvisnosti(): OdvisnostiMosta;
  /** Predsnet posnetek pozdrava kot PCM 16 kHz (posnetekPcm16); null = ni posnetka, klic se zavrne. */
  posnetekPcm16(besedilo: string): Promise<Uint8Array | null>;
  nacin?: NacinBesedila;
  ura?: () => number;
  dnevnik?: (koda: string) => void;
  /**
   * Prevzem linije (L-04): isti pogoji kot pot Twilio (linija odprta, nacin prevzema in ura, »en klic naenkrat« z zapisom v aktivniKlici).
   * Vrne null = sprejet (linija je zasedena za ta sid), sicer razlog zavrnitve. Brez te odvisnosti se klic sprejme takoj (preizkusi).
   */
  sprejem?(sid: string): Promise<string | null>;
  /** Sprosti linijo, ce se je klic koncal, ko je prevzem se tekel. */
  sprosti?(sid: string): void;
};

type Klic = {
  most: LiveMost;
  vrata: VrataTelefona;
  pretvornik: Prevzorcevalnik;
  predvajanoDo: number;
  casovniki: Set<ReturnType<typeof setTimeout>>;
  konec: boolean;
  /** Linija je prevzeta in most zagnan; do takrat zvok od telefona ne gre nikamor (L-04). */
  pripravljen: boolean;
};

/** Ustvari priklop za nastaviPrikljucekTelefona. En klic naenkrat: nov zacni ob tekocem klicu zavrne novega (streznik to ze preprecuje). */
export function prikljucekZaMost(o: OdvisnostiPrikljucka): PrikljucekTelefona {
  let tekoci: Klic | null = null;
  const ura = () => (o.ura ?? Date.now)();
  const dnevnik = (koda: string) => {
    try {
      o.dnevnik?.(koda);
    } catch {
      /* dnevnik ne sme podreti klica */
    }
  };

  function pospravi(k: Klic): void {
    k.konec = true;
    for (const c of k.casovniki) clearTimeout(c);
    k.casovniki.clear();
    if (tekoci === k) tekoci = null;
  }

  /** Kar most poslje Twilio (JSON), gre kot PCM / clear k telefonu. */
  function izMosta(k: Klic, besedilo: string): void {
    if (k.konec) return;
    let d: { event?: unknown; media?: { payload?: unknown }; mark?: { name?: unknown } };
    try {
      d = JSON.parse(besedilo) as typeof d;
    } catch {
      return;
    }
    if (d.event === "media" && typeof d.media?.payload === "string") {
      const mulaw = new Uint8Array(Buffer.from(d.media.payload, "base64"));
      const pcm = pcmVBajte(k.pretvornik.process(mulawVPcm(mulaw)));
      if (pcm.length === 0) return;
      k.predvajanoDo = Math.max(k.predvajanoDo, ura()) + pcm.length / BAJTOV_NA_MS;
      k.vrata.posljiZvok(Buffer.from(pcm));
    } else if (d.event === "clear") {
      for (const c of k.casovniki) clearTimeout(c);
      k.casovniki.clear();
      k.predvajanoDo = ura();
      k.vrata.posljiClear();
    } else if (d.event === "mark" && typeof d.mark?.name === "string") {
      // telefon marka ne pozna: vrni ga, ko je po oceni vse predvajano (most ima ob izostanku svoj varnostni rok)
      const ime = d.mark.name;
      const caka = Math.max(0, k.predvajanoDo - ura());
      const c = setTimeout(() => {
        k.casovniki.delete(c);
        if (!k.konec) k.most.naSporocilo(JSON.stringify({ event: "mark", streamSid: STREAM_SID, mark: { name: ime } }));
      }, caka);
      c.unref?.();
      k.casovniki.add(c);
    }
  }

  return {
    zacni(klic, vrata) {
      if (tekoci) {
        dnevnik("telefon-dvojni-klic");
        try {
          vrata.zapri();
        } catch {
          /* ze zaprto */
        }
        return;
      }
      const zeton = randomBytes(16).toString("hex");
      // L-03: oznako zapisa klica izda Lina sama; callId od telefona NIKOLI ne postane kljuc v knjigi klicev (ne trci s tujimi zapisi ali CallSid Twilia)
      const sid = `tel-${randomBytes(8).toString("hex")}`;
      const drzi: { k?: Klic } = {};
      const twilio: TwilioVrata = {
        poslji: (b) => {
          if (drzi.k) izMosta(drzi.k, b);
        },
        zapri: () => {
          try {
            vrata.zapri();
          } catch {
            /* ze zaprto */
          }
        },
      };
      const osnova = o.odvisnosti();
      const odv: OdvisnostiMosta = {
        ...osnova,
        // Pot telefona ne porablja zetonov Twilia: veljaven je samo zeton, ki ga je ta klic sam izdal ob zacni (nic z omrezja).
        porabiZeton: (z) => (z === zeton ? { izid: "ok", from: klic.remoteNumber } : { izid: "neveljaven", from: "" }),
        ura: o.ura ?? osnova.ura,
        dnevnik: o.dnevnik ?? osnova.dnevnik,
        zacetekKlica: async (pozdrav, odpri) => {
          let poslanih = 0;
          const izid = await zacniKlicTelefon(pozdrav, {
            posnetek: o.posnetekPcm16,
            posljiOkvir: (okvir) => {
              const k = drzi.k;
              if (!k || k.konec) throw new Error("klic je koncan");
              k.predvajanoDo = Math.max(k.predvajanoDo, ura()) + OKVIR_PCM16_BAJTOV / BAJTOV_NA_MS;
              k.vrata.posljiZvok(Buffer.from(okvir));
              poslanih += 1;
            },
            odpriLive: () => odpri(poslanih * (OKVIR_PCM16_BAJTOV / BAJTOV_NA_MS)),
            dnevnik,
          });
          return izid.izid !== "zavrnjeno";
        },
      };
      const most = new LiveMost(twilio, odv, o.nacin ?? "clientContent");
      const k: Klic = { most, vrata, pretvornik: new Prevzorcevalnik(8_000, 16_000), predvajanoDo: 0, casovniki: new Set(), konec: false, pripravljen: false };
      drzi.k = k;
      tekoci = k;
      const zagon = (): void => {
        k.pripravljen = true;
        most.naSporocilo(JSON.stringify({
          event: "start",
          start: { streamSid: STREAM_SID, callSid: sid, mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000 }, customParameters: { zeton } },
        }));
      };
      const zavrni = (koda: string): void => {
        dnevnik(koda);
        pospravi(k);
        try {
          vrata.zapri();
        } catch {
          /* ze zaprto */
        }
      };
      if (!o.sprejem) return zagon();
      void o.sprejem(sid).then(
        (razlog) => {
          if (k.konec) {
            if (razlog === null) o.sprosti?.(sid);
            return;
          }
          if (razlog !== null) return zavrni(`telefon-zavrnjen-${razlog}`);
          zagon();
        },
        () => {
          if (!k.konec) zavrni("telefon-sprejem-napaka");
        },
      );
    },
    zvok(pcm) {
      const k = tekoci;
      if (!k || k.konec || !k.pripravljen) return;
      k.most.naPcm16k(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length));
    },
    ustavi(razlog: RazlogKonca) {
      const k = tekoci;
      if (!k) return;
      pospravi(k);
      if (k.pripravljen) void k.most.zakljuci(`telefon-${razlog}`);
    },
  };
}
