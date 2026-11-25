/**
 * Rezerva za setup Live (naloga 17a, 25. 11. 2026). Streznik odpira Vertex v1 (odjemalec.server.ts); ali v1 sprejme
 * realtimeInputConfig (START_SENSITIVITY_LOW za stikalom »Zmanjsanje hrupa«), ni potrjeno: uradni SDK google-genai 2.19.0 odpira
 * Vertex Live na v1beta1 (_api_client.py) in polje poslje tam (_live_converters.py); za v1 ni vira, pravi klic ni bil narejen.
 * Isti SDK (types.py, StartSensitivity) navaja, da je na Vertexu LOW ze privzeto - polje je torej verjetno brez ucinka.
 * Ce streznik sejo zapre PRED setupComplete in je bilo polje poslano, se Live odpre se ENKRAT brez polja (staro vedenje),
 * da klic ne gre v opravicilo samo zaradi te nastavitve. Brez polja ali po setupComplete se nic ne spremeni.
 * Cista koda brez omrezja (odpiranje je vbrizgano). Komentarji so brez sumnikov.
 */
import type { LiveOdpri, LiveSeja } from "./most.ts";

/** Kopija setupa brez realtimeInputConfig ali null, ce ga ni. Izvirnik ostane nespremenjen. */
export function brezObcutljivosti(setup: object): object | null {
  const s = (setup as { setup?: unknown }).setup;
  if (!s || typeof s !== "object" || !("realtimeInputConfig" in s)) return null;
  const { realtimeInputConfig: _odstrani, ...ostalo } = s as Record<string, unknown>;
  return { ...setup, setup: ostalo };
}

export function zRezervoSetupa(odpri: LiveOdpri, dnevnik?: (koda: string) => void): LiveOdpri {
  return async ({ setup, onSporocilo, onZaprto }) => {
    const rezerva = brezObcutljivosti(setup);
    if (!rezerva) return odpri({ setup, onSporocilo, onZaprto });
    let poskus = 0;
    let pripravljena = false;
    let zaprl = false;
    let trenutna: LiveSeja | null = null;
    const odpriPoskus = (s: object): Promise<LiveSeja> => {
      const moj = ++poskus;
      return odpri({
        setup: s,
        onSporocilo: (m) => {
          if (moj !== poskus || zaprl) return;
          if (m.setupComplete !== undefined) pripravljena = true;
          onSporocilo(m);
        },
        onZaprto: (razlog) => {
          if (moj !== poskus || zaprl) return;
          if (moj === 1 && !pripravljena) {
            try {
              dnevnik?.("live-setup-brez-obcutljivosti");
            } catch {
              /* dnevnik ne sme podreti klica */
            }
            odpriPoskus(rezerva).then(
              (druga) => {
                if (zaprl) druga.zapri();
                else trenutna = druga;
              },
              () => {
                if (!zaprl) onZaprto(razlog);
              },
            );
            return;
          }
          onZaprto(razlog);
        },
      });
    };
    trenutna = await odpriPoskus(setup);
    return {
      poslji(sporocilo: object) {
        trenutna?.poslji(sporocilo);
      },
      zapri() {
        zaprl = true;
        trenutna?.zapri();
      },
    };
  };
}
