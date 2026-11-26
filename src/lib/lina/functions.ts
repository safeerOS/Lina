import { createServerFn } from "@tanstack/react-start";
import { seznamKlicev } from "./klici-seznam.server.ts";
import { deleteCookie, getCookie, getRequest, getRequestIP, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import {
  LEGACY_CONVERSATION_COOKIE,
  SESSION_COOKIE,
  loginOwner,
  logoutOwner,
  odpriLokalnoSejo,
  ownerExists,
  requireOwner,
  sessionIsValid,
  setupOwner,
} from "./auth.server.ts";
import {
  checkBrain,
  izberiModelPogovora,
  nastaviBrezplacneModele,
  odstraniKljucAsistentke,
  preveriAsistentko,
  readBrain,
  saveBrain,
  shraniKljucAsistentke,
  stanjeAsistentkeOpenRouter,
} from "./keys.server.ts";
import {
  namestiGcloudPoDovoljenju,
  pozabiGoogleRacun,
  preklicGooglePrijave,
  vnesiKodoGooglePrijave,
  projektiGoogle,
  stanjeGoogleRacuna,
  zacniGooglePrijavo,
} from "./google-racun.server.ts";
import { poveziTinyFish, pozabiTinyFish, stanjeTinyFish } from "./tinyfish.server.ts";
import { nastaviMejoBrave, poveziBrave, pozabiBrave, stanjeBrave } from "./brave.server.ts";
import { daSoglasje, soglasjeDano } from "./soglasje.server.ts";
import { opozoriloPotrjeno, potrdiOpozorilo } from "./opozorilo.server.ts";
import {
  odjavaGithub,
  preberiIzbiroGithub,
  preveriPrijavoGithub,
  seznamRepozitorijev,
  shraniIzbiroGithub,
  shraniKljucGithub,
  stanjeGithub,
  tokoviRepozitorija,
  uporabiGh,
  zacniPrijavoGithub,
} from "./github-dostop.server.ts";
import { stanjaDodatkov, uskladiEnkrat } from "./dodatki.server.ts";
import { stanjeSlovenskega } from "./dodatki-telefon.server.ts";
import { pozabiOmniroute, shraniOmniroute, stanjeOmniroute, type VnosOmniroute } from "./omniroute.server.ts";
import {
  odkleniPovezovanje, odlociSeznanitev, prekliciSeznanitev, potrdiIdSeznanitve, odstraniNapravo, shraniAsistenta, stanjeAsistenta, telefonZaLinijo, vnesiKodoTelefona, zacniSeznanitev, zacniSeznanitevSKodo, zapriSeznanitevSKodo,
} from "./asistent-telefon.server.ts";
import { dnevnikAvtonomije, stanjeAvtonomije, ukazAvtonomije } from "./avtonomija.server.ts";
import { jeNacrtVklopljen, nacrtClaudeNaloge, nastaviNacrt, stanjeClaudeNalog, ukazClaudeNalog } from "./claude-naloge.server.ts";
import { ClaudeNalogaNapaka } from "./claude-naloge.ts";
import { odgovorVprasanja, stanjeVprasanj } from "./vprasanja-agentov.server.ts";
import { VprasanjeNapaka } from "./vprasanja-agentov.ts";
import { stanjeGradenj, ukazGradenj } from "./gradnje-github.server.ts";
import { GradnjaNapaka } from "./gradnje-github.ts";
import { pravilaZaVmesnik, preberiNujne, shraniNujne } from "./nujni.server.ts";
import { pridobiStanjeNapak, pridobiZetonNapake, shraniNastavitveNapak } from "./napake.server.ts";
import { dodajDejstvo, izbrisiDejstvo, izbrisiVsaDejstva, izvoziSpomin, nastaviSpomin, preberiSpomin, urediDejstvo } from "./spomin.server.ts";
import { pozabiPodpisSharedKey, sharedKeyLine, vklopiPodpisSharedKey } from "./twilio-podpis.server.ts";
import { narociPreizkusniKlic } from "./twilio-preizkus.server.ts";
import { nastaviNaslovKlicev, pozabiTwilio, povezi as poveziTwilio, stanjeTwilioRacuna, stevilkeTwilio } from "./twilio-racun.server.ts";
import { pozabiSonioxKljuc, shraniSonioxKljuc, stanjeSoniox } from "./soniox-kljuc.server.ts";
import { dovoliStran, preklicStran, seznamStrani } from "./strani-dovoljenja.server.ts";
import { prekliciDovoljenje, seznamDovoljenj } from "./dovoljenja-podobne.server.ts";
import { pozabiNastavitveSip, preberiNastavitveSip, shraniNastavitveSip, stanjeRegistracijeSip } from "./sip/sluzba-sip.server.ts";
import { nastaviPot, pot } from "./pot.server.ts";
import { llmConfigured } from "./llm.server.ts";
import { asistentPogovor, asistentZgodovina } from "./asistent-pogovor.server.ts";
import { govorZaBesedilo, prepisiZvok } from "./glas-pogovor.server.ts";
import { koledarDodaj, koledarIzbrisi, koledarSeznam, koledarSpremeni } from "./koledar.server.ts";
import { imenikSeznam, imenikShrani, imenikIzbrisi } from "./imenik.server.ts";
import { noviceBeri, noviceDodajVir, noviceOceni, noviceOdstraniVir, noviceOsvezi, noviceShrani } from "./novice.server.ts";
import { dodajVrzel, listVrzeli, loadPravila, preizkusniOdgovor, savePravila, uskladiRsdoObPoizvedbi } from "./pravila.server.ts";
import { potrdiPredlog, preberiPotek, preberiPredlog, preberiStranPodjetja, zavrziPredlog } from "./splet.server.ts";
import { izbrisiVir, naloziVir, objaviVir, potrdiPredlogDatoteke, pregledVira, seznamVirov, zavrziPredlogDatoteke } from "./znanje-viri.server.ts";
import { chooseStorage, readStorage } from "./storage.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { izberiMapoZapiskov, odpriMapoZapiskov, pogledMapeZapiskov, preberiZapisek, seznamZapiskov, zdruziZapiske } from "./zapiski.server.ts";
import {
  listCalls as listCallsCore,
  phoneTurn as phoneTurnCore,
  publishLine as publishLineCore,
  readLine as readLineCore,
  speak as speakCore,
  talk as talkCore,
  vajaKlica as vajaKlicaCore,
} from "./service.server.ts";
import { assertLocalSetup, izvorIzGlav, jeLokalnaZahteva, type LokalnaZahteva, type SetupOrigin } from "./origin.ts";
import type { Pravila } from "./types.ts";

function noStore(): void {
  setResponseHeader("Cache-Control", "no-store");
  setResponseHeader("Vary", "Cookie");
}

/** Zeton odprte seje (Lina brez gesla); ostane samo v pomnilniku streznika, brskalnik ga ne dobi. */
let odprtZeton: string | null = null;

/**
 * Seja lastnika: piskotek, ali - dokler gesla ni - zahteva z istega racunalnika (lastnik 12. 11. 2026).
 * Prek javnega naslova (tunel, domena) seje brez gesla ni nikoli.
 */
async function sessionToken(): Promise<string | null> {
  const piskotek = getCookie(SESSION_COOKIE) ?? null;
  // Star piskotek (npr. iz casa z geslom) ne sme zapreti vrat brez gesla: 14. 11. 2026 je lastnik na 127.0.0.1 videl obrazec
  // za geslo, ker je Chrome hranil neveljaven piskotek. Veljaven piskotek velja; z geslom ostane vedno veljaven pogoj prijave.
  if (piskotek && ((await sessionIsValid(piskotek)) || (await ownerExists()))) return piskotek;
  if (await ownerExists()) {
    odprtZeton = null;
    return null;
  }
  const zahteva = lokalnaZahteva();
  if (!jeLokalnaZahteva(zahteva)) return null;
  if (odprtZeton && (await sessionIsValid(odprtZeton))) return odprtZeton;
  odprtZeton = await odpriLokalnoSejo(zahteva);
  return odprtZeton;
}

/** Odstrani stari piškotek pogovora. Zgodovina je samo na strežniku. */
function clearLegacyCookie(): void {
  deleteCookie(LEGACY_CONVERSATION_COOKIE, { path: "/", sameSite: "strict" });
}

function writeSessionCookie(token: string): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

/** Naslov vticnice in glave; glave posrednika ali tunela same zadoscajo za zavrnitev. */
function lokalnaZahteva(): LokalnaZahteva {
  return izvorIzGlav(getRequestIP(), getRequest().headers);
}

function setupOrigin(): SetupOrigin {
  return lokalnaZahteva();
}

export const authStatus = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  const token = await sessionToken();
  const brezGesla = !(await ownerExists());
  return {
    needsSetup: brezGesla,
    brezGesla,
    signedIn: await sessionIsValid(token),
    llm: llmConfigured() && process.env.LINA_LLM !== "0",
  };
});

export const setupOwnerFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => {
    if (!data || typeof data.password !== "string") throw new Error("Geslo manjka.");
    return { password: data.password };
  })
  .handler(async ({ data }) => {
    noStore();
    const token = await setupOwner(data.password, undefined, setupOrigin());
    writeSessionCookie(token);
    clearLegacyCookie();
    return { ok: true as const };
  });

export const loginFn = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => {
    if (!data || typeof data.password !== "string") throw new Error("Geslo manjka.");
    return { password: data.password };
  })
  .handler(async ({ data }) => {
    noStore();
    const token = await loginOwner(data.password);
    writeSessionCookie(token);
    clearLegacyCookie();
    return { ok: true as const };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  await logoutOwner(await sessionToken());
  deleteCookie(SESSION_COOKIE, { path: "/", sameSite: "strict" });
  clearLegacyCookie();
  return { ok: true as const };
});

export const publishLine = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return publishLineCore(data, { token: await sessionToken() });
  });

export const readLine = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return readLineCore({ token: await sessionToken() });
});

export const listCalls = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  // naloga 17: tudi klici, ki jih je sprejela Lina na telefonu
  return seznamKlicev({ token: await sessionToken() });
});

export const talk = createServerFn({ method: "POST" })
  .validator((data: { callSid?: string; from?: string; text?: string; hangup?: boolean }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return talkCore(data, { token: await sessionToken() });
  });

export const phoneTurn = createServerFn({ method: "POST" })
  .validator((data: { callSid?: string; from?: string; text?: string; hangup?: boolean }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return phoneTurnCore(data, { token: await sessionToken() });
  });

export const speak = createServerFn({ method: "POST" })
  .validator((data: { callSid?: string; text?: string }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return speakCore(data, { token: await sessionToken() });
  });

export const readBrainFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return readBrain(await sessionToken());
});

export const saveBrainFn = createServerFn({ method: "POST" })
  .validator((data: { provider?: unknown; model?: unknown; key?: unknown; project?: unknown; location?: unknown; samodejno?: unknown; naslov?: unknown; zaKlice?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return saveBrain(data, await sessionToken());
  });

export const izberiModelFn = createServerFn({ method: "POST" })
  .validator((data: { provider?: unknown; model?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return izberiModelPogovora(data, await sessionToken());
  });

/** Kljuc OpenRouter samo za asistentko (lastnik 24. 11. 2026, naloga C): nikoli v kljuci.json (klici). */
export const shraniKljucAsistentkeFn = createServerFn({ method: "POST" })
  .validator((data: { key?: unknown; model?: unknown; soglasje?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniKljucAsistentke(data, await sessionToken());
  });

export const odstraniKljucAsistentkeFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return odstraniKljucAsistentke(await sessionToken());
});

// ---- NALOGA-35: kljuci za mozgane na vseh seznanjenih napravah (samo lastnik; vmesnik nikoli ne dobi celega kljuca) ----

export const pregledKljucevFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await requireOwner(await sessionToken(), resolveDataDir());
  const { pregledKljucev } = await import("./kljuci-mozganov.server.ts");
  return pregledKljucev();
});

export const dodajKljucMozganovFn = createServerFn({ method: "POST" })
  .validator((data: { ponudnik?: unknown; oznaka?: unknown; kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await requireOwner(await sessionToken(), resolveDataDir());
    const { dodajKljucMozganov } = await import("./kljuci-mozganov.server.ts");
    return dodajKljucMozganov(data);
  });

export const urediKljucMozganovFn = createServerFn({ method: "POST" })
  .validator((data: { dejanje?: unknown; id?: unknown; oznaka?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await requireOwner(await sessionToken(), resolveDataDir());
    const k = await import("./kljuci-mozganov.server.ts");
    if (data.dejanje === "uporabi") return k.uporabiKljucMozganov(data.id);
    if (data.dejanje === "odstrani") return k.odstraniKljucMozganov(data.id);
    if (data.dejanje === "preimenuj") return k.preimenujKljucMozganov(data.id, data.oznaka);
    if (data.dejanje === "potrdi") return k.potrdiObvestiloKljucev();
    throw new Error("Neznano dejanje.");
  });

export const nastaviBrezplacneFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return nastaviBrezplacneModele(data.vklop, await sessionToken());
  });

export const preveriAsistentkoFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preveriAsistentko(await sessionToken());
});

export const stanjeOpenRouterFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeAsistentkeOpenRouter(await sessionToken());
});

export const checkBrainFn = createServerFn({ method: "POST" })
  .validator((data: { provider?: unknown; model?: unknown; key?: unknown; project?: unknown; location?: unknown; naslov?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return checkBrain(data, await sessionToken());
  });

export const readStorageFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return readStorage(await sessionToken());
});

export const chooseStorageFn = createServerFn({ method: "POST" })
  .validator((data: { mapa?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return chooseStorage(data?.mapa, await sessionToken());
  });

export const readPravilaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const root = resolveDataDir();
  await requireOwner(await sessionToken(), root);
  return pravilaZaVmesnik(root);
});

export const savePravilaFn = createServerFn({ method: "POST" })
  .validator((data: Partial<Pravila>) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return pravilaZaVmesnik(undefined, await savePravila(data, await sessionToken()));
  });

export const listVrzeliFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return listVrzeli(await sessionToken());
});

export const dodajVrzelFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; odgovor?: unknown }) => {
    if (!data || typeof data.id !== "string" || typeof data.odgovor !== "string") {
      throw new Error("Manjka vprasanje ali odgovor.");
    }
    return { id: data.id, odgovor: data.odgovor };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return dodajVrzel(data.id, data.odgovor, await sessionToken());
  });

export const preizkusFn = createServerFn({ method: "POST" })
  .validator((data: { text?: unknown }) => {
    if (!data || typeof data.text !== "string") throw new Error("Vprasanje manjka.");
    return { text: data.text };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return preizkusniOdgovor(data.text, await sessionToken());
  });

/** Vaja klica: ista zascita kot ostale funkcije vmesnika (seja lastnika); javna pot /api/voice je ne pozna. */
export const vajaKlicaFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; text?: unknown; konec?: unknown }) => {
    if (!data || (data.id !== undefined && typeof data.id !== "string") || (data.text !== undefined && typeof data.text !== "string")) {
      throw new Error("Vaja ni veljavna.");
    }
    return { id: data.id as string | undefined, text: (data.text as string | undefined)?.slice(0, 2000), konec: data.konec === true };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return vajaKlicaCore(data, { token: await sessionToken() });
  });

export const preberiSpletFn = createServerFn({ method: "POST" })
  .validator((data: { naslov?: unknown }) => {
    if (!data || typeof data.naslov !== "string") throw new Error("Naslov manjka.");
    return { naslov: data.naslov };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return preberiStranPodjetja(data.naslov, await sessionToken());
  });

export const preberiPredlogFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiPredlog(await sessionToken());
});

export const potekSpletaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiPotek(await sessionToken());
});

export const potrdiPredlogFn = createServerFn({ method: "POST" })
  .validator((data: { ids?: unknown }) => {
    if (!data || !Array.isArray(data.ids) || data.ids.some((id) => typeof id !== "string")) {
      throw new Error("Izbira manjka.");
    }
    return { ids: data.ids as string[] };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return potrdiPredlog(data.ids, await sessionToken());
  });

export const zavrziPredlogFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zavrziPredlog(await sessionToken());
});

/** Zapiski pogovorov (G5): vse brez prijave zavrnjeno; odjemalec poslje samo ID z seznama ali vnos mape, nikoli poti do datoteke. */
export const pogledMapeZapiskovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pogledMapeZapiskov(await sessionToken());
});

export const izberiMapoZapiskovFn = createServerFn({ method: "POST" })
  .validator((data: { mapa?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return izberiMapoZapiskov(data?.mapa, await sessionToken());
  });

export const odpriMapoZapiskovFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return odpriMapoZapiskov(await sessionToken());
});

export const seznamZapiskovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return seznamZapiskov(await sessionToken());
});

/** Posnetek klica (nacin podjetje z narocilom, 22. 11. 2026); odjemalec poslje samo ID zapiska s seznama. */
export const preberiPosnetekFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { preberiPosnetek } = await import("./zapiski.server.ts");
    return preberiPosnetek(data?.id, await sessionToken());
  });

export const preberiZapisekFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return preberiZapisek(data?.id, await sessionToken());
  });

/** Povzetek vseh sporocil istega klicatelja (22. 11. 2026); odjemalec poslje samo kljuc s seznama. */
export const povzetekKlicateljaFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { povzetekKlicatelja } = await import("./zapiski.server.ts");
    return povzetekKlicatelja(data?.kljuc, await sessionToken());
  });

export const zdruziZapiskeFn = createServerFn({ method: "POST" })
  .validator((data: { ids?: unknown; odstrani?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return zdruziZapiske(data?.ids, data?.odstrani, await sessionToken());
  });

/** Googlov racun Line (11. 11. 2026): stanje, namestitev gcloud po dovoljenju, prijava v privzetem brskalniku, projekti, pozabi. */
export const stanjeGoogleFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeGoogleRacuna(await sessionToken());
});

export const namestiGcloudFn = createServerFn({ method: "POST" })
  .validator((data: { soglasje?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return namestiGcloudPoDovoljenju(data?.soglasje, await sessionToken());
  });

export const zacniGoogleFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zacniGooglePrijavo(await sessionToken());
});

export const kodaGoogleFn = createServerFn({ method: "POST" })
  .validator((data: { koda?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return vnesiKodoGooglePrijave(data?.koda, await sessionToken());
  });

export const preklicGoogleFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preklicGooglePrijave(await sessionToken());
});

export const projektiGoogleFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return projektiGoogle(await sessionToken());
});

export const pozabiGoogleFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiGoogleRacun(await sessionToken());
});

/** Racun Twilio (12. 11. 2026): SID + API kljuc, stevilke, naslov klicev, pozabi. Skrivnost nikoli ne gre nazaj odjemalcu. */
export const stanjeTwilioFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeTwilioRacuna(await sessionToken());
});

export const poveziTwilioFn = createServerFn({ method: "POST" })
  .validator((data: { sid?: unknown; kljucSid?: unknown; skrivnost?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const niz = (v: unknown): string => (typeof v === "string" ? v : "");
    return poveziTwilio(await sessionToken(), { sid: niz(data?.sid), kljucSid: niz(data?.kljucSid), skrivnost: niz(data?.skrivnost) });
  });

export const stevilkeTwilioFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stevilkeTwilio(await sessionToken());
});

export const naslovTwilioFn = createServerFn({ method: "POST" })
  .validator((data: { stevilkaSid?: unknown; naslov?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await nastaviNaslovKlicev(
      await sessionToken(),
      typeof data?.stevilkaSid === "string" ? data.stevilkaSid : "",
      typeof data?.naslov === "string" ? data.naslov : "",
    );
    return { uspeh: true as const };
  });

export const pozabiTwilioFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await pozabiTwilio(await sessionToken());
  await pozabiPodpisSharedKey(await sessionToken());
  return stanjeTwilioRacuna(await sessionToken());
});

/**
 * Pot SIP (SIP-2): nastavitve ponudnika SIP in stanje registracije, z isto prijavo kot ostale nastavitve. Geslo nikoli ne gre
 * nazaj v brskalnik: odgovor pove samo, ali je nastavljeno (imaGeslo). Shrani zazene odjemalca na novo, pozabi ga ustavi.
 */
export const preberiSipFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiNastavitveSip(await sessionToken());
});

export const stanjeSipFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeRegistracijeSip(await sessionToken());
});

export const shraniSipFn = createServerFn({ method: "POST" })
  .validator(
    (data: { registrar?: unknown; vrata?: unknown; domena?: unknown; uporabnik?: unknown; avtUporabnik?: unknown; geslo?: unknown; expires?: unknown }) => data,
  )
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const niz = (v: unknown): string => (typeof v === "string" ? v : "");
    const stevilo = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));
    return shraniNastavitveSip(await sessionToken(), {
      registrar: niz(data?.registrar),
      vrata: stevilo(data?.vrata),
      domena: niz(data?.domena),
      uporabnik: niz(data?.uporabnik),
      avtUporabnik: niz(data?.avtUporabnik),
      geslo: niz(data?.geslo),
      expires: stevilo(data?.expires),
    });
  });

export const pozabiSipFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiNastavitveSip(await sessionToken());
});

/** Podpis klicev s SharedKey (brez Auth Tokena). Stanje ne vrne skrivnosti, samo ali je kljuc shranjen. */
export const stanjePodpisaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await stanjeTwilioRacuna(await sessionToken());
  return { vklopljen: (await sharedKeyLine()) !== null };
});

export const vklopiPodpisFn = createServerFn({ method: "POST" })
  .validator((data: { naslov?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const naslov = typeof data?.naslov === "string" ? data.naslov : "";
    await vklopiPodpisSharedKey(await sessionToken(), naslov.replace(/incoming\/?$/, ""));
    return { vklopljen: true as const };
  });

/** Testni klic (preizkusni racun Twilio): Twilio poklice uporabnikovo stevilko in klic pride k Lini. Brez terminala. */
export const testniKlicFn = createServerFn({ method: "POST" })
  .validator((data: { kam?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await narociPreizkusniKlic(await sessionToken(), typeof data?.kam === "string" ? data.kam : "");
    return { klice: true as const };
  });

/**
 * Pot javnega naslova (lastnik 12. 11. 2026): neposredna (domena + javno potrdilo), hitri tunel kot rezerva, samodejna izbira.
 * Vse zahteva lastnika (seja); naslov ne gre v dnevnik, samo v pravila in odgovor lastniku. Odjemalec ne poslje poti ali ukaza.
 */
export const stanjePotiFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pot.stanje(await sessionToken());
});

export const nastaviPotFn = createServerFn({ method: "POST" })
  .validator((data: { nacin?: unknown; domena?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await nastaviPot(await sessionToken(), { nacin: data?.nacin, domena: data?.domena });
    return pot.stanje(await sessionToken());
  });

export const vklopiPotFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pot.vklopi(await sessionToken());
});

export const izklopiPotFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pot.izklopi(await sessionToken());
});

export const namestiPotFn = createServerFn({ method: "POST" })
  .validator((data: { kaj?: unknown; soglasje?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return data?.kaj === "tunel" ? pot.namestiTunel(data?.soglasje, await sessionToken()) : pot.namestiNeposredno(data?.soglasje, await sessionToken());
  });

/** Neobvezni bralnik strani prek TinyFish z uporabnikovim lastnim kljucem. Kljuc nikoli ne gre nazaj odjemalcu. */
export const stanjeTinyFishFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeTinyFish(await sessionToken());
});

export const poveziTinyFishFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return poveziTinyFish(await sessionToken(), typeof data?.kljuc === "string" ? data.kljuc : "");
  });

export const pozabiTinyFishFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiTinyFish(await sessionToken());
});

/** Nujni klici na osebni telefon (lastnik 10. 11. 2026): stikali in stevilka. Stevilka nikoli ne gre nazaj odjemalcu. */
export const nujniNastavitveFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiNujne(await sessionToken());
});

export const shraniNujneFn = createServerFn({ method: "POST" })
  .validator((data: { obvesti?: unknown; prevezi?: unknown; stevilka?: unknown; cakanjeSek?: unknown; omejitevUra?: unknown; omejitevDan?: unknown; pozabiStevilko?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniNujne(
      { obvesti: data?.obvesti, prevezi: data?.prevezi, stevilka: data?.stevilka, cakanjeSek: data?.cakanjeSek, omejitevUra: data?.omejitevUra, omejitevDan: data?.omejitevDan, pozabiStevilko: data?.pozabiStevilko },
      await sessionToken(),
    );
  });

/** Brave Search (rezerva iskanja asistentke) z uporabnikovim lastnim kljucem. Kljuc nikoli ne gre nazaj odjemalcu. */
export const stanjeBraveFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeBrave(await sessionToken());
});

export const poveziBraveFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return poveziBrave(await sessionToken(), typeof data?.kljuc === "string" ? data.kljuc : "");
  });

export const pozabiBraveFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiBrave(await sessionToken());
});

export const nastaviMejoBraveFn = createServerFn({ method: "POST" })
  .validator((data: { meja?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return nastaviMejoBrave(await sessionToken(), data?.meja);
  });

/** Neobvezen prehod OmniRoute (privzeto izklopljen). Kljuc nikoli ne gre nazaj odjemalcu. */
export const stanjeOmnirouteFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeOmniroute(await sessionToken());
});

export const shraniOmnirouteFn = createServerFn({ method: "POST" })
  .validator((data: VnosOmniroute) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniOmniroute(await sessionToken(), data);
  });

export const pozabiOmnirouteFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiOmniroute(await sessionToken());
});

/** Naloga 31: Lina sama namesti, zazene in odstrani OmniRoute (samo na tem racunalniku, samo lastnik; ni v POTI_ODDALJENO). */
export const stanjeNamestitveOmnirouteFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeNamestitve } = await import("./omniroute-namestitev.server.ts");
  return stanjeNamestitve(await sessionToken());
});

/** Ob izbiri OmniRoute: ali na naslovu kaj tece (GET <naslov>/models, rok 2 s; naslov samo zanka ali https). */
export const preveriOmnirouteFn = createServerFn({ method: "POST" })
  .validator((data: { naslov?: unknown }) => ({ naslov: typeof data?.naslov === "string" ? data.naslov : "" }))
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await requireOwner(await sessionToken(), resolveDataDir());
    const { teceOmniroute } = await import("./keys.server.ts");
    const { veljavenNaslovOmniroute } = await import("./omniroute.ts");
    const naslov = veljavenNaslovOmniroute(data.naslov);
    return { tece: naslov ? await teceOmniroute(naslov) : false };
  });

export const namestiOmnirouteFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { namestiOmniroute } = await import("./omniroute-namestitev.server.ts");
  return namestiOmniroute(await sessionToken());
});

export const odstraniOmnirouteFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { odstraniOmniroute } = await import("./omniroute-namestitev.server.ts");
  return odstraniOmniroute(await sessionToken());
});

/** Soglasje ob prvem zagonu: racunalnik postane lokalni streznik za Lino; brez soglasja uporaba ni mogoca. Dati ga je mogoce samo na tem racunalniku. */
export const soglasjeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  return { dano: await soglasjeDano() };
});

export const daSoglasjeFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  assertLocalSetup(setupOrigin());
  await daSoglasje();
  return { dano: true as const };
});

/** Opozorilo ob prvem zagonu (lastnik 24. 11. 2026): »Razumem« z razlicico besedila; brez potrditve ni klicev in ne agentov. Samo na tem racunalniku. */
export const opozoriloFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  return { potrjeno: await opozoriloPotrjeno() };
});

export const potrdiOpozoriloFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  assertLocalSetup(setupOrigin());
  await potrdiOpozorilo();
  return { potrjeno: true as const };
});

/** Nastavitve > GitHub (lastnik 24. 11. 2026): prijava, gh ali kljuc; izbira repozitorijev in tokov. Kljuc nikoli nazaj odjemalcu. */
export const stanjeGithubFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeGithub(await sessionToken());
});

export const zacniPrijavoGithubFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zacniPrijavoGithub(await sessionToken());
});

export const preveriPrijavoGithubFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preveriPrijavoGithub(await sessionToken());
});

export const uporabiGhFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return uporabiGh(await sessionToken());
});

export const shraniKljucGithubFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniKljucGithub(await sessionToken(), typeof data?.kljuc === "string" ? data.kljuc : "");
  });

export const odjavaGithubFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return odjavaGithub(await sessionToken());
});

export const repozitorijiGithubFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return seznamRepozitorijev(await sessionToken());
});

export const tokoviGithubFn = createServerFn({ method: "POST" })
  .validator((data: { repozitorij?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return tokoviRepozitorija(await sessionToken(), data?.repozitorij);
  });

export const izbiraGithubFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiIzbiroGithub(await sessionToken());
});

export const shraniIzbiroGithubFn = createServerFn({ method: "POST" })
  .validator((data: { izbira?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniIzbiroGithub(await sessionToken(), data?.izbira);
  });

/** Naloga 16: telefon za oznako »Linija odprta/zaprta« (povezan, seznanjen, ne); samo branje. */
export const telefonZaLinijoFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return telefonZaLinijo(await sessionToken());
});

/** Telefon za asistentko (zaslon »Poveži telefon«): privzeto izklopljeno; QR in potrditev lastnika (asistent-telefon.server.ts). */
export const stanjeAsistentaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeAsistenta(await sessionToken());
});

export const shraniAsistentaFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown; naslov?: unknown; vrata?: unknown; ocenaIzida?: unknown; globalLink?: unknown; samodejniAgenti?: unknown; odobriOmrezje?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniAsistenta(await sessionToken(), { vklop: data?.vklop, naslov: data?.naslov, vrata: data?.vrata, ocenaIzida: data?.ocenaIzida, globalLink: data?.globalLink, samodejniAgenti: data?.samodejniAgenti, odobriOmrezje: data?.odobriOmrezje });
  });

export const zacniSeznanitevFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zacniSeznanitev(await sessionToken());
});

/** »Povezi s kodo«: 6-mestna koda za telefon (SPAKE2 kot v Safeer Linku, koda-seznanitev.ts). */
export const zacniSeznanitevSKodoFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zacniSeznanitevSKodo(await sessionToken());
});

export const vnesiKodoTelefonaFn = createServerFn({ method: "POST" })
  .validator((data: { pairId?: unknown; koda?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return vnesiKodoTelefona(await sessionToken(), data?.pairId, data?.koda);
  });

/** Naloga 21 (N2): ob zapustitvi zaslona »Poveži telefon« neporabljeni QR ne velja vec; CRR2: samo QR tega zaslona (koda). */
export const prekliciSeznanitevFn = createServerFn({ method: "POST" })
  .validator((data: { koda?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await prekliciSeznanitev(await sessionToken(), data?.koda);
    return { ok: true };
  });

export const zapriSeznanitevSKodoFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zapriSeznanitevSKodo(await sessionToken());
});

/** Lastnik koncna zaporo povezovanja s kodo (T1-N1): zaporo lahko sprozi neznanec iz omrezja. */
export const odkleniPovezovanjeFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return odkleniPovezovanje(await sessionToken());
});

export const odlociSeznanitevFn = createServerFn({ method: "POST" })
  .validator((data: { koda?: unknown; sprejmi?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return odlociSeznanitev(await sessionToken(), data?.koda, data?.sprejmi);
  });

/** N5: lastnik potrdi, da se id telefona ujema z id-jem na telefonu; streznik zahteva potrditev pred »Dodaj« (asistent-telefon.server.ts). */
export const potrdiIdSeznanitveFn = createServerFn({ method: "POST" })
  .validator((data: { koda?: unknown; id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return potrdiIdSeznanitve(await sessionToken(), data?.koda, data?.id);
  });

export const odstraniNapravoFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return odstraniNapravo(await sessionToken(), data?.id);
  });

/** Spomin lastnika, faza 1 (lastnik 15. 11. 2026): stikalo (privzeto izklopljeno) in dejstva, ki jih uporabnik napise sam. */
export const spominFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return preberiSpomin(await sessionToken());
});

export const nastaviSpominFn = createServerFn({ method: "POST" })
  .validator((data: { vklopljen?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return nastaviSpomin(data?.vklopljen, await sessionToken());
  });

export const dodajDejstvoFn = createServerFn({ method: "POST" })
  .validator((data: { besedilo?: unknown; klicatelju?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return dodajDejstvo({ besedilo: data?.besedilo, klicatelju: data?.klicatelju }, await sessionToken());
  });

export const urediDejstvoFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; besedilo?: unknown; klicatelju?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return urediDejstvo(data?.id, { besedilo: data?.besedilo, klicatelju: data?.klicatelju }, await sessionToken());
  });

export const izbrisiDejstvoFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return izbrisiDejstvo(data?.id, await sessionToken());
  });

export const izbrisiVsaDejstvaFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return izbrisiVsaDejstva(await sessionToken());
});

export const izvoziSpominFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return izvoziSpomin(await sessionToken());
});

/** Napake naprav (nastavitve in vnos): podobno kot nujni klici, v isti komponenti. */
export const napakeNastavitveFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await requireOwner(await sessionToken(), resolveDataDir());
  return pridobiStanjeNapak();
});

export const zetonNapakeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await requireOwner(await sessionToken(), resolveDataDir());
  if (!jeLokalnaZahteva(lokalnaZahteva())) {
    throw new Error("Žeton je na voljo samo z istega računalnika.");
  }
  return pridobiZetonNapake();
});

export const shraniNapakeFn = createServerFn({ method: "POST" })
  .validator((data: { obvesti?: unknown; stevilka?: unknown; pozabiStevilko?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    await requireOwner(await sessionToken(), resolveDataDir());
    return shraniNastavitveNapak(
      {
        obvesti: typeof data?.obvesti === "boolean" ? data.obvesti : undefined,
        stevilka: typeof data?.stevilka === "string" ? data.stevilka : undefined,
        pozabiStevilko: typeof data?.pozabiStevilko === "boolean" ? data.pozabiStevilko : undefined,
      }
    );
  });

export const asistentZgodovinaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return asistentZgodovina(await sessionToken());
});

export const asistentFn = createServerFn({ method: "POST" })
  .validator((data: { besedilo?: string; priponke?: Array<{ ime: string; mime: string; podatki: string }> }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    // Priponke preveri pripraviPriponke (vrsta po vsebini, velikost, ponudnik); tu gre naprej samo seznam.
    return asistentPogovor(String(data?.besedilo ?? ""), await sessionToken(), undefined, Array.isArray(data?.priponke) ? data.priponke : undefined);
  });

export const koledarSeznamFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return koledarSeznam(await sessionToken());
});

export const koledarDodajFn = createServerFn({ method: "POST" })
  .validator((data: { vrsta?: string; naslov?: string; cas?: string | null }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return koledarDodaj(data, await sessionToken());
  });

export const koledarSpremeniFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string; opravljeno?: boolean; obvesceno?: boolean }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return koledarSpremeni(String(data?.id ?? ""), { opravljeno: data?.opravljeno, obvesceno: data?.obvesceno }, await sessionToken());
  });

export const koledarIzbrisiFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return koledarIzbrisi(String(data?.id ?? ""), await sessionToken());
  });

export const prepisFn = createServerFn({ method: "POST" })
  .validator((data: { zvok?: string; mime?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return prepisiZvok(String(data?.zvok ?? ""), String(data?.mime ?? ""), await sessionToken());
  });

export const govorFn = createServerFn({ method: "POST" })
  .validator((data: { besedilo?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return govorZaBesedilo(String(data?.besedilo ?? ""), await sessionToken());
  });

export const imenikSeznamFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return imenikSeznam(await sessionToken());
});

export const imenikShraniFn = createServerFn({ method: "POST" })
  .validator((data: { ime?: string; telefon?: string; opomba?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return imenikShrani(data, await sessionToken());
  });

export const imenikIzbrisiFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return imenikIzbrisi(String(data.id ?? ""), await sessionToken());
  });

/** Novice (lastnik 21. 11. 2026): viri, pregled in ocene z modelom. Vsak klic zahteva sejo lastnika; viri se berejo samo prek varnega prenosa (zasebni naslovi so zavrnjeni). */
export const noviceBeriFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return noviceBeri(await sessionToken());
});

export const noviceOsveziFn = createServerFn({ method: "POST" })
  .validator((data: { sila?: boolean }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return noviceOsvezi(data?.sila === true, await sessionToken());
  });

export const noviceDodajVirFn = createServerFn({ method: "POST" })
  .validator((data: { vrsta?: string; vnos?: string; ime?: string; kategorija?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return noviceDodajVir(data, await sessionToken());
  });

export const noviceOdstraniVirFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return noviceOdstraniVir(String(data?.id ?? ""), await sessionToken());
  });

export const noviceShraniFn = createServerFn({ method: "POST" })
  .validator((data: { zanimanja?: string; nastavitve?: { najvec?: number; najvecNaKategorijo?: number; prag?: number } }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return noviceShrani({ zanimanja: data?.zanimanja, nastavitve: data?.nastavitve }, await sessionToken());
  });

export const noviceOceniFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return noviceOceni(await sessionToken());
});

/** Samostojna opravila Line (pravila avtonomije, 15. 11. 2026): stanje, dnevnik in ukazi lastnika. Vsak klic zahteva sejo lastnika. */
export const stanjeAvtonomijeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeAvtonomije(await sessionToken());
});

export const dnevnikAvtonomijeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return dnevnikAvtonomije(await sessionToken());
});

export const ukazAvtonomijeFn = createServerFn({ method: "POST" })
  .validator((data: { ukaz?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return ukazAvtonomije(await sessionToken(), data?.ukaz);
  });

/**
 * Zavihek Racunalnik: naloge za Claude Code (claude-naloge.server.ts). Zagon samo po potrditvi lastnika; razlog zavrnitve je stalna koda.
 */
export const stanjeClaudeNalogFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeClaudeNalog(await sessionToken());
});

export const ukazClaudeNalogFn = createServerFn({ method: "POST" })
  .validator((data: { ukaz?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    try {
      return { ok: true as const, stanje: await ukazClaudeNalog(await sessionToken(), data?.ukaz) };
    } catch (e) {
      if (e instanceof ClaudeNalogaNapaka) return { ok: false as const, razlog: e.razlog };
      throw e;
    }
  });

/** Vprasanja agenta (naloga 23): odprta vprasanja in dnevnik dela; odgovor lastnika (»dovoli« samo z geslom). */
export const stanjeVprasanjAgentovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeVprasanj(await sessionToken());
});

export const odgovorVprasanjaAgentaFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; odlocitev?: unknown; zgostitev?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    try {
      return { ok: true as const, stanje: await odgovorVprasanja(await sessionToken(), data ?? {}) };
    } catch (e) {
      if (e instanceof VprasanjeNapaka) return { ok: false as const, razlog: e.razlog };
      throw e;
    }
  });

/** Orkestrator (Lina sama vodi vecstopenjsko nalogo z orodji, 25. 11. 2026): stanje, nova naloga, ustavi, odgovor, potrdi/zavrni. */
export const stanjeOrkestratorjaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeOrkestratorja } = await import("./orkestrator.server.ts");
  return stanjeOrkestratorja(await sessionToken());
});

export const ukazOrkestratorjaFn = createServerFn({ method: "POST" })
  .validator((data: { ukaz?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { ukazOrkestratorja, OrkestratorNapaka } = await import("./orkestrator.server.ts");
    // pregled V6 (naloga 9): brez gesla novo nalogo ustvari samo okno lupine (zeton, ki ga lupina doda samo svojim zahtevam)
    const { GLAVA_LUPINE, veljavenZetonLupine, zetonLupine } = await import("./lupina.server.ts");
    try {
      return { ok: true as const, stanje: await ukazOrkestratorja(await sessionToken(), data?.ukaz, undefined, veljavenZetonLupine(getRequest().headers.get(GLAVA_LUPINE), zetonLupine())) };
    } catch (e) {
      if (e instanceof OrkestratorNapaka) return { ok: false as const, razlog: e.koda };
      if (e instanceof VprasanjeNapaka) return { ok: false as const, razlog: e.razlog };
      throw e;
    }
  });

export const nastaviOrkestratorFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    const { nastaviOrkestrator } = await import("./orkestrator.server.ts");
    return { vklopljen: await nastaviOrkestrator(data.vklop, root) };
  });

/** Nacrt naloge (nacrt.html) za izoliran okvir: varno prebran in ovit s CSP na strezniku; brez nacrta null. */
export const nacrtClaudeNalogeFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    try {
      return { html: await nacrtClaudeNaloge(await sessionToken(), data?.id) };
    } catch (e) {
      if (e instanceof ClaudeNalogaNapaka) return { html: null };
      throw e;
    }
  });

export const nastaviNacrtDiagramFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    return { vklopljen: await nastaviNacrt(data.vklop, root) };
  });

/**
 * Zavihek Racunalnik: gradnje na GitHubu (gradnje-github.server.ts, lastnik 24. 11. 2026). Zagon samo po potrditvi lastnika;
 * pot namestitve in mapo izbere streznik iz stanja; razlog zavrnitve je stalna koda.
 */
export const stanjeGradenjFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeGradenj(await sessionToken());
});

export const ukazGradenjFn = createServerFn({ method: "POST" })
  .validator((data: { ukaz?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    try {
      return { ok: true as const, stanje: await ukazGradenj(await sessionToken(), data?.ukaz) };
    } catch (e) {
      if (e instanceof GradnjaNapaka) return { ok: false as const, razlog: e.razlog };
      throw e;
    }
  });

/**
 * Izbirni dodatek Soniox (dobeseden zapis govora): stanje, shranjevanje in pozabljanje lastnikovega kljuca. Vklop je pravilo
 * `sonioxVklop` (savePravilaFn), privzeto izklopljeno. Kljuc nikoli ne gre nazaj v brskalnik: odgovor pove samo, ali je shranjen.
 */
export const stanjeSonioxFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return stanjeSoniox(await sessionToken());
});

export const shraniSonioxKljucFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return shraniSonioxKljuc(typeof data?.kljuc === "string" ? data.kljuc : "", await sessionToken());
  });

export const pozabiSonioxKljucFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return pozabiSonioxKljuc(await sessionToken());
});

/** Strani, kjer sme Lina delati (naloga #13): seznam, dovoli, preklici. Samo lastnik; gesla se ne hranijo nikjer. */
export const seznamStraniFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  await requireOwner(await sessionToken(), resolveDataDir());
  return seznamStrani();
});

export const dovoliStranFn = createServerFn({ method: "POST" })
  .validator((data: { izvor?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return dovoliStran(data?.izvor, await sessionToken());
  });

/** Nastavitve > Dovoljenja (02f): seznam in preklic dovoljenj »velja tudi za vse podobne«; samo lastnik. Dodajanja tu NI. */
export const seznamDovoljenjFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return seznamDovoljenj(await sessionToken());
});

export const prekliciDovoljenjeFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return prekliciDovoljenje(await sessionToken(), data?.id);
  });

export const preklicStranFn = createServerFn({ method: "POST" })
  .validator((data: { izvor?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return preklicStran(data?.izvor, await sessionToken());
  });

// --- 22. 11. 2026: slike in video (slike-generator, video-generator), ciscenje zvoka klicev, dnevna motivacija. Samo lastnik (zeton seje).
export const knjiznicaSlikFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { knjiznicaSlik } = await import("./slike-generator.server.ts");
  return knjiznicaSlik(await sessionToken());
});

export const generirajSlikoFn = createServerFn({ method: "POST" })
  .validator((data: { opis?: unknown; stevilo?: unknown; razmerje?: unknown; serija?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { generirajSliko } = await import("./slike-generator.server.ts");
    return generirajSliko(data?.opis, await sessionToken(), undefined, { stevilo: data?.stevilo, razmerje: data?.razmerje, serija: data?.serija });
  });

export const generirajVideoFn = createServerFn({ method: "POST" })
  .validator((data: { opis?: unknown; sekund?: unknown; razmerje?: unknown; zvok?: unknown; serija?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { generirajVideo } = await import("./video-generator.server.ts");
    return generirajVideo(data?.opis, await sessionToken(), undefined, { sekund: data?.sekund, razmerje: data?.razmerje, zvok: data?.zvok, serija: data?.serija });
  });

export const nastavitveZvokaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { preberiNastavitveZvoka } = await import("./zvok-ciscenje.server.ts");
  return preberiNastavitveZvoka(await sessionToken());
});

export const nastaviCiscenjeKlicevFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviCiscenjeKlicev } = await import("./zvok-ciscenje.server.ts");
    return nastaviCiscenjeKlicev(data?.vklop, await sessionToken());
  });

// --- 24. 11. 2026 (N3): izbira jezika vmesnika na strezniku, da prezivi nova vrata namizne lupine. Branje brez prijave, zapis samo lastnik.
export const preberiJezikFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  const { preberiIzbiroJezika } = await import("./jezik.server.ts");
  return preberiIzbiroJezika();
});

export const shraniJezikFn = createServerFn({ method: "POST" })
  .validator((data: { izbira?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { shraniIzbiroJezika } = await import("./jezik.server.ts");
    return shraniIzbiroJezika(data?.izbira, await sessionToken());
  });

export const dnevnaMotivacijaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { dnevnaMotivacija } = await import("./motivacija.server.ts");
  return dnevnaMotivacija(await sessionToken());
});

export const nastaviMotivacijoFn = createServerFn({ method: "POST" })
  .validator((data: { popravek?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviMotivacijo } = await import("./motivacija.server.ts");
    return nastaviMotivacijo(data?.popravek, await sessionToken());
  });

/** Zagon ob prijavi (naloga 21): stanje in stikalo v Nastavitvah. */
export const samodejniZagonFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeSamodejnegaZagona } = await import("./samodejni-zagon.server.ts");
  return stanjeSamodejnegaZagona(await sessionToken());
});

export const nastaviSamodejniZagonFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data ?? {})
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviSamodejniZagon } = await import("./samodejni-zagon.server.ts");
    return nastaviSamodejniZagon(data?.vklop, await sessionToken());
  });

/** Samo branje (brez ustvarjanja misli): stikalo v Nastavitvah in kartica v jeziku brez misli (25. 11. 2026). */
export const motivacijaStanjeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { preberiMotivacijo } = await import("./motivacija.server.ts");
  return preberiMotivacijo(await sessionToken());
});

// --- 22. 11. 2026: branje ustvarjene slike ali videa za okno Slike in video (samo lastnik, data URL).
export const medijPodatkiFn = createServerFn({ method: "GET" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { preberiMedij } = await import("./mediji-datoteka.server.ts");
    return preberiMedij(data?.id, await sessionToken());
  });

// --- 22. 11. 2026: spomin pogovorov asistentke (privzeto vklopljen, lastnik), stikalo in brisanje v Nastavitvah.
export const spominPogovorovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeSpominaPogovorov } = await import("./spomin-pogovor.server.ts");
  return stanjeSpominaPogovorov(await sessionToken());
});

export const nastaviSpominPogovorovFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviSpominPogovorov } = await import("./spomin-pogovor.server.ts");
    return nastaviSpominPogovorov(data?.vklop, await sessionToken());
  });

export const izbrisiSpominPogovorovFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { izbrisiSpominPogovorov } = await import("./spomin-pogovor.server.ts");
  return izbrisiSpominPogovorov(await sessionToken());
});

// --- 22. 11. 2026: samoucenje Line (privzeto vklopljeno, lastnik): stikalo, seznam naucenih tem, pozabi temo / vse.
export const samoucenjeFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeSamoucenja } = await import("./samoucenje-pogovor.server.ts");
  return stanjeSamoucenja(await sessionToken());
});

export const nastaviSamoucenjeFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviSamoucenjeLastnik } = await import("./samoucenje-pogovor.server.ts");
    return nastaviSamoucenjeLastnik(data?.vklop, await sessionToken());
  });

export const pozabiTemoFn = createServerFn({ method: "POST" })
  .validator((data: { tema?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { pozabiTemoLastnik } = await import("./samoucenje-pogovor.server.ts");
    return pozabiTemoLastnik(data?.tema, await sessionToken());
  });

export const pozabiVseSamoucenjeFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { pozabiVseLastnik } = await import("./samoucenje-pogovor.server.ts");
  return pozabiVseLastnik(await sessionToken());
});

// --- 22. 11. 2026: nastavitve obvestil (enotna odlocitev obvestil, obvestila-odlocitev.ts), samo lastnik.
export const nastavitveObvestilFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { preberiNastavitveObvestil } = await import("./obvestila.server.ts");
  return preberiNastavitveObvestil(await sessionToken());
});

export const shraniObvestilaFn = createServerFn({ method: "POST" })
  .validator((data: { popravek?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { shraniNastavitveObvestil } = await import("./obvestila.server.ts");
    return shraniNastavitveObvestil(data?.popravek, await sessionToken());
  });

// --- 23. 11. 2026: vgrajena posodobitev Line (Linux .deb), samo lastnik. Zagon ne sprejme podatkov iz brskalnika.
export const stanjePosodobitveFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjePosodobitve } = await import("./posodobitev.server.ts");
  return stanjePosodobitve(await sessionToken());
});

export const posodobiLinoFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { zacniPosodobitev } = await import("./posodobitev.server.ts");
  return zacniPosodobitev(await sessionToken());
});

// --- Naloga 28 (26. 11. 2026): samodejna preverba posodobitev. Branje vrne samo stanje v pomnilniku (brez zahteve na GitHub).
export const obvestiloPosodobitveFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { obvestiloPosodobitve } = await import("./posodobitev-samodejno.server.ts");
  return obvestiloPosodobitve(await sessionToken());
});

export const nastaviSamodejnoPosodobitevFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviSamodejno } = await import("./posodobitev-samodejno.server.ts");
    // vrednost gre naprej nespremenjena: tip (boolean) preveri nastaviSamodejno
    return nastaviSamodejno(await sessionToken(), data?.vklop);
  });

// --- 25. 11. 2026: drugi Safeer programi (samo namesceni, samo s seznama PAKETI). Brskalnik da samo ime; streznik ga preveri.
export const stanjeDrugihPaketovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeDrugihPaketov } = await import("./posodobitev.server.ts");
  return stanjeDrugihPaketov(await sessionToken());
});

export const posodobiPaketFn = createServerFn({ method: "POST" })
  .validator((data: { paket?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { zacniPosodobitev } = await import("./posodobitev.server.ts");
    return zacniPosodobitev(await sessionToken(), undefined, {}, typeof data?.paket === "string" ? data.paket : "");
  });

/** Pravo stanje dodatkov (vsebniki), da vmesnik ne trdi »deluje«, ce ne tece. */
export const stanjeDodatkovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const zeton = await sessionToken();
  void loadPravila().then((p) => uskladiEnkrat(p.dodatki)).catch(() => {});
  // slovenski (stalni proces RSDO): stanje v istem prikazu; poizvedba prijavljenega lastnika tudi ponovno poskusi zagon, ce namestitev
  // se ni bila koncana (pregled 029, najdba 11: brez prijave brez zagona procesa)
  void uskladiRsdoObPoizvedbi(zeton).catch(() => {});
  // Isti izracun kot za telefon (dodatki-telefon.server.ts); neuspela namestitev je vidna (najdba 12).
  const { stanje: slovenski, razlog: slovenskiRazlog } = stanjeSlovenskega();
  return { ...(await stanjaDodatkov()), slovenski, slovenskiRazlog };
});

/** Znanje iz datotek podjetja: vse samo za prijavljenega lastnika; odjemalec poslje ime in vsebino (base64), nikoli poti. */
const NAJVEC_B64_DOKUMENTA = Math.ceil((15 * 1024 * 1024) / 3) * 4 + 4;
export const naloziVirFn = createServerFn({ method: "POST" })
  .validator((data: { ime?: unknown; b64?: unknown }) => {
    if (!data || typeof data.ime !== "string" || typeof data.b64 !== "string" || data.b64.length > NAJVEC_B64_DOKUMENTA) {
      throw new Error("Dokument ni veljaven.");
    }
    return { ime: data.ime.slice(0, 255), b64: data.b64 };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return naloziVir(data.ime, data.b64, await sessionToken());
  });

export const seznamVirovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return seznamVirov(await sessionToken());
});

const idVira = (data: { id?: unknown }) => {
  if (!data || typeof data.id !== "string" || !/^[0-9a-f-]{36}$/.test(data.id)) throw new Error("Dokument ni veljaven.");
  return { id: data.id };
};

export const pregledViraFn = createServerFn({ method: "POST" })
  .validator(idVira)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return pregledVira(data.id, await sessionToken());
  });

/** Lastnik potrdi besedilo vira za znanje (N9: v klice gre sele po tej potrditvi). */
export const objaviVirFn = createServerFn({ method: "POST" })
  .validator(idVira)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return objaviVir(data.id, await sessionToken());
  });

export const izbrisiVirFn = createServerFn({ method: "POST" })
  .validator(idVira)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return izbrisiVir(data.id, await sessionToken());
  });

export const potrdiPredlogDatotekeFn = createServerFn({ method: "POST" })
  .validator((data: { ids?: unknown }) => {
    if (!data || !Array.isArray(data.ids) || data.ids.some((id) => typeof id !== "string")) throw new Error("Izbira manjka.");
    return { ids: (data.ids as string[]).slice(0, 500) };
  })
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    return potrdiPredlogDatoteke(data.ids, await sessionToken());
  });

export const zavrziPredlogDatotekeFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  return zavrziPredlogDatoteke(await sessionToken());
});

// --- 24. 11. 2026: ucenje iz popravkov lastnika (Task Observer), spomin nalog agentov (claude-mem) in pregled projekta (claude-code-setup).
export const stanjePopravkovFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const root = resolveDataDir();
  await requireOwner(await sessionToken(), root);
  const { preberiStanjePopravkov } = await import("./ucenje-popravkov.server.ts");
  return preberiStanjePopravkov(root);
});

export const nastaviPopravkeFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    const { nastaviUcenjePopravkov } = await import("./ucenje-popravkov.server.ts");
    return nastaviUcenjePopravkov(data.vklop, root);
  });

export const potrdiPopravekFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown; predlog?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.id !== "string") throw new Error("Manjka oznaka kandidata.");
    const { shraniKandidata } = await import("./ucenje-popravkov.server.ts");
    return shraniKandidata(data.id, typeof data.predlog === "string" ? data.predlog : undefined, root);
  });

export const zavrziPopravekFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.id !== "string") throw new Error("Manjka oznaka kandidata.");
    const { zavrziKandidata } = await import("./ucenje-popravkov.server.ts");
    return zavrziKandidata(data.id, root);
  });

export const izbrisiPraviloPopravkaFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.id !== "string") throw new Error("Manjka oznaka pravila.");
    const { izbrisiPraviloPopravka } = await import("./ucenje-popravkov.server.ts");
    return izbrisiPraviloPopravka(data.id, root);
  });

// --- 25. 11. 2026: ucenje postopkov (modul ucenje-lh, AGPL, prek vrat; brez modula v gradnji naVoljo: false).
export const stanjeUcenjaLHFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeUcenjaLH } = await import("./ucenje-lh-vrata.server.ts");
  return stanjeUcenjaLH(await sessionToken());
});

export const nastaviUcenjeLHFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { nastaviUcenjeLH } = await import("./ucenje-lh-vrata.server.ts");
    return nastaviUcenjeLH(data?.vklop, await sessionToken());
  });

export const izbrisiEnotoLHFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { izbrisiEnotoLH } = await import("./ucenje-lh-vrata.server.ts");
    return izbrisiEnotoLH(data?.id, await sessionToken());
  });

export const izbrisiVseLHFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { izbrisiVseLH } = await import("./ucenje-lh-vrata.server.ts");
  return izbrisiVseLH(await sessionToken());
});

export const stanjeAgentPomociFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const root = resolveDataDir();
  await requireOwner(await sessionToken(), root);
  const [{ jeSpominNalogVklopljen }, { jePregledProjektaVklopljen }] = await Promise.all([
    import("./spomin-nalog.server.ts"),
    import("./pregled-projekta.server.ts"),
  ]);
  return {
    spominNalog: await jeSpominNalogVklopljen(root),
    pregledProjekta: await jePregledProjektaVklopljen(root),
    nacrtDiagram: await jeNacrtVklopljen(root),
    orkestrator: await (await import("./orkestrator.server.ts")).jeOrkestratorVklopljen(root),
  };
});

export const nastaviSpominNalogFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    const { nastaviSpominNalog } = await import("./spomin-nalog.server.ts");
    return { vklopljen: await nastaviSpominNalog(data.vklop, root) };
  });

export const nastaviPregledProjektaFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    const { nastaviPregledProjekta } = await import("./pregled-projekta.server.ts");
    return { vklopljen: await nastaviPregledProjekta(data.vklop, root) };
  });

export const podrobnostiOpazanjaFn = createServerFn({ method: "POST" })
  .validator((data: { nalogaId?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const root = resolveDataDir();
    await requireOwner(await sessionToken(), root);
    if (typeof data?.nalogaId !== "string" && typeof data?.nalogaId !== "number") throw new Error("Manjka oznaka opazanja.");
    const { podrobnostiOpazanja } = await import("./spomin-nalog.server.ts");
    return podrobnostiOpazanja(root, data.nalogaId);
  });

// --- 24. 11. 2026: prilagodljivi kontekst (slovar strok). Samo lastnik; vse lokalno v stroke.json. Vsaka funkcija vrne pogled za Nastavitve.
async function lastnikStrok() {
  noStore();
  clearLegacyCookie();
  const root = resolveDataDir();
  await requireOwner(await sessionToken(), root);
  return { root, m: await import("./stroke.server.ts") };
}

export const stanjeStrokFn = createServerFn({ method: "GET" }).handler(async () => {
  const { root, m } = await lastnikStrok();
  return m.pogledStrok(root);
});

export const nastaviStrokeFn = createServerFn({ method: "POST" })
  .validator((data: { vklop?: unknown }) => data)
  .handler(async ({ data }) => {
    const { root, m } = await lastnikStrok();
    if (typeof data?.vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
    await m.nastaviPrilagodljiviKontekst(data.vklop, root);
    return m.pogledStrok(root);
  });

export const izberiStrokoFn = createServerFn({ method: "POST" })
  .validator((data: { kljuc?: unknown; izbrana?: unknown }) => data)
  .handler(async ({ data }) => {
    const { root, m } = await lastnikStrok();
    if (typeof data?.kljuc !== "string" || typeof data.izbrana !== "boolean") throw new Error("Neveljavna stroka.");
    await m.izberiStroko(data.kljuc, data.izbrana, root);
    return m.pogledStrok(root);
  });

export const potrdiIzrazStrokeFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    const { root, m } = await lastnikStrok();
    if (typeof data?.id !== "string") throw new Error("Manjka oznaka izraza.");
    await m.potrdiIzraz(data.id, root);
    return m.pogledStrok(root);
  });

export const izbrisiIzrazStrokeFn = createServerFn({ method: "POST" })
  .validator((data: { izraz?: unknown }) => data)
  .handler(async ({ data }) => {
    const { root, m } = await lastnikStrok();
    if (typeof data?.izraz !== "string") throw new Error("Manjka izraz.");
    await m.izbrisiIzraz(data.izraz, root);
    return m.pogledStrok(root);
  });

export const dodajIzrazStrokeFn = createServerFn({ method: "POST" })
  .validator((data: { izraz?: unknown; razlaga?: unknown }) => data)
  .handler(async ({ data }) => {
    const { root, m } = await lastnikStrok();
    if (typeof data?.izraz !== "string") throw new Error("Manjka izraz.");
    const r = await m.dodajIzraz(data.izraz, typeof data.razlaga === "string" ? data.razlaga : "", root);
    return { ok: r.ok, pogled: await m.pogledStrok(root) };
  });

export const pozabiStrokeFn = createServerFn({ method: "POST" }).handler(async () => {
  const { root, m } = await lastnikStrok();
  await m.pozabiVseStroke(root);
  return m.pogledStrok(root);
});

// ---------------------------------------------------------------- Narocila podjetja (Nastavitve, 24. 11. 2026)

export const stanjeNarocilFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeNarocil } = await import("./narocila.server.ts");
  return stanjeNarocil(await sessionToken());
});

/** Uvoz iz mape: seja lastnika; brez potrditve samo ze dovoljena ista mapa (skupni modul dovoljenj, vrsta narocila-uvoz). */
export const uvoziNarocilaFn = createServerFn({ method: "POST" })
  .validator((data: { mapa?: unknown; potrjeno?: unknown; podobne?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { uvoziNarocilaLastnik } = await import("./narocila.server.ts");
    return uvoziNarocilaLastnik(await sessionToken(), { mapa: data?.mapa, potrjeno: data?.potrjeno, podobne: data?.podobne });
  });

// ---------------------------------------------------------------- Kontrola tiska (vid, 24. 11. 2026)

export const stanjeKontroleTiskaFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeKontrole, zadnjeKontrole } = await import("./kontrola-tiska.server.ts");
  const token = await sessionToken();
  return { ...(await stanjeKontrole(token)), dnevnik: await zadnjeKontrole(token, 20) };
});

export const shraniNastavitveKontroleFn = createServerFn({ method: "POST" })
  .validator((data: { nastavitve?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { shraniNastavitveKontrole } = await import("./kontrola-tiska.server.ts");
    return shraniNastavitveKontrole(await sessionToken(), data?.nastavitve);
  });

/** Namestitev knjiznic vida: samo z izrecnim soglasjem (gumb po prikazanem opisu); streznik preveri soglasje === true. */
export const namestiKnjizniceVidaFn = createServerFn({ method: "POST" })
  .validator((data: { soglasje?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { namestiKnjizniceVida } = await import("./kontrola-tiska.server.ts");
    return namestiKnjizniceVida(await sessionToken(), data?.soglasje);
  });

export const izmeriTiskFn = createServerFn({ method: "POST" })
  .validator((data: { fotografija?: unknown; referenca?: unknown; vrstaReference?: unknown; nalog?: unknown; imeReference?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { izmeriTisk } = await import("./kontrola-tiska.server.ts");
    return izmeriTisk(await sessionToken(), {
      fotografija: data?.fotografija,
      referenca: data?.referenca,
      vrstaReference: data?.vrstaReference,
      nalog: data?.nalog,
      imeReference: data?.imeReference,
    });
  });

export const oznacenaSlikaKontroleFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { oznacenaSlika } = await import("./kontrola-tiska.server.ts");
    return { png: await oznacenaSlika(await sessionToken(), data?.id) };
  });

export const oznakePdfFn = createServerFn({ method: "POST" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { oznakePdf } = await import("./kontrola-tiska.server.ts");
  return oznakePdf(await sessionToken());
});

export const opisiNapakeTiskaFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { opisiNapake } = await import("./kontrola-tiska.server.ts");
    return opisiNapake(await sessionToken(), data?.id);
  });

export const prejeteSlikeKontroleFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { prejeteSlike } = await import("./kontrola-tiska.server.ts");
  return { slike: await prejeteSlike(await sessionToken()) };
});

export const pocistiPrejeteKontroleFn = createServerFn({ method: "POST" })
  .validator((data: { potrditev?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { pocistiPrejete } = await import("./kontrola-tiska.server.ts");
    return pocistiPrejete(await sessionToken(), data?.potrditev);
  });

export const prejetaSlikaKontroleFn = createServerFn({ method: "POST" })
  .validator((data: { id?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { prejetaSlika } = await import("./kontrola-tiska.server.ts");
    return { slika: await prejetaSlika(await sessionToken(), data?.id) };
  });

/** Uporaba lokalnega n8n (24. 11. 2026): seznam tokov, predlogi ustvarjanja/zagona in potrditev lastnika. */
export const stanjeN8nFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  clearLegacyCookie();
  const { stanjeN8n } = await import("./n8n.server.ts");
  return stanjeN8n(await sessionToken());
});

export const ukazN8nFn = createServerFn({ method: "POST" })
  .validator((data: { ukaz?: unknown }) => data)
  .handler(async ({ data }) => {
    noStore();
    clearLegacyCookie();
    const { ukazN8n } = await import("./n8n.server.ts");
    const { N8nNapaka } = await import("./n8n.ts");
    try {
      return { ok: true as const, stanje: await ukazN8n(await sessionToken(), data?.ukaz) };
    } catch (e) {
      if (e instanceof N8nNapaka) return { ok: false as const, razlog: e.razlog };
      throw e;
    }
  });
