import { useEffect, useRef, useState } from "react";
import { GUMB, GUMB_OBROBA, IZBIRA, NAMIG, OZNAKA_POLJA, POLJE, Podrazdelek, Razdelek } from "@/components/ui-lina.tsx";
import { t } from "@/lib/lina/besedila.ts";
import type { IzbiraRepozitorija, JavnoStanjeGithub, TokRepozitorija, VrstaIzdelka } from "@/lib/lina/github-dostop.ts";
import {
  izbiraGithubFn,
  odjavaGithubFn,
  preveriPrijavoGithubFn,
  repozitorijiGithubFn,
  shraniIzbiroGithubFn,
  shraniKljucGithubFn,
  stanjeGithubFn,
  tokoviGithubFn,
  uporabiGhFn,
  zacniPrijavoGithubFn,
} from "@/lib/lina/functions.ts";

const NACIN = { oauth: "ghdNacinOauth", gh: "ghdNacinGh", kljuc: "ghdNacinKljuc" } as const;
const VRSTE: Array<[VrstaIzdelka, "ghdVrstaApk" | "ghdVrstaDeb" | "ghdVrstaDrugo"]> = [
  ["apk", "ghdVrstaApk"],
  ["deb", "ghdVrstaDeb"],
  ["drugo", "ghdVrstaDrugo"],
];

/**
 * Nastavitve > GitHub (lastnik 24. 11. 2026): tri poti, najenostavnejsa prva (Prijava z GitHubom, ce je client id vpisan; obstojeca
 * prijava gh; kljuc), »Povezano kot <racun>« brez kljuca, izbira repozitorijev in tokov z rocnim zagonom, Odjava. Kljuc gre samo
 * na streznik; polje se izprazni.
 */
export function GithubDostop({ id, onError }: { id: string; onError: (m: string) => void }) {
  const [stanje, setStanje] = useState<JavnoStanjeGithub | null>(null);
  const [kljuc, setKljuc] = useState("");
  const [koda, setKoda] = useState<{ koda: string; naslov: string } | null>(null);
  const [obvestilo, setObvestilo] = useState("");
  const [lokalna, setLokalna] = useState("");
  const [zaposlen, setZaposlen] = useState(false);
  const casovnik = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void stanjeGithubFn()
      .then(setStanje)
      .catch(() => setStanje(null));
    return () => {
      if (casovnik.current) clearTimeout(casovnik.current);
    };
  }, []);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    onError("");
    setLokalna("");
    try {
      await delo();
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : "";
      setLokalna(m);
      onError(m);
    } finally {
      setZaposlen(false);
    }
  }

  function cakaj(intervalSek: number) {
    casovnik.current = setTimeout(() => {
      void preveriPrijavoGithubFn()
        .then((r) => {
          if (r.izid === "cakaj") cakaj(r.intervalSek ?? intervalSek);
          else {
            setKoda(null);
            if (r.izid === "povezano" && r.stanje) setStanje(r.stanje);
            else if (r.izid === "poteklo") setObvestilo(t("ghdOauthPoteklo"));
            else if (r.izid === "zavrnjeno") setObvestilo(t("ghdOauthZavrnjeno"));
          }
        })
        .catch((cause) => {
          setKoda(null);
          setLokalna(cause instanceof Error ? cause.message : "");
        });
    }, intervalSek * 1000);
  }

  const povezan = Boolean(stanje?.nacin && stanje.racun);
  return (
    <Razdelek id={id} naslov={t("ghdNaslov")} opis={t("ghdUvod")}>
      <div className="grid max-w-prose gap-4 text-sm">
        {povezan && stanje?.nacin ? (
          <>
            <p role="status">
              {t("ghdPovezan").replace("{racun}", stanje.racun ?? "")} ({t(NACIN[stanje.nacin])})
            </p>
            <button type="button" disabled={zaposlen} className={`${GUMB_OBROBA} w-fit`} onClick={() => izvedi(async () => setStanje(await odjavaGithubFn()))}>
              {t("ghdOdjava")}
            </button>
            <IzbiraTokov onError={onError} />
          </>
        ) : (
          <>
            {stanje?.oauthNaVoljo ? (
              <Podrazdelek naslov={t("ghdPotOauth")}>
                {koda ? (
                  <div className="grid gap-2" aria-live="polite">
                    <p>{t("ghdOauthKoda")}</p>
                    <p className="font-mono text-2xl tracking-widest">{koda.koda}</p>
                    <a className={`${GUMB} w-fit`} href={koda.naslov} target="_blank" rel="noreferrer noopener">
                      {t("ghdOauthOdpri")}
                    </a>
                    <p className="text-[var(--color-moss)]">{t("ghdOauthCakam")}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={zaposlen}
                    className={`${GUMB} w-fit`}
                    onClick={() =>
                      izvedi(async () => {
                        setObvestilo("");
                        const z = await zacniPrijavoGithubFn();
                        setKoda({ koda: z.koda, naslov: z.naslov });
                        cakaj(z.intervalSek);
                      })
                    }
                  >
                    {t("ghdPotOauth")}
                  </button>
                )}
              </Podrazdelek>
            ) : null}
            {stanje?.ghNaVoljo ? (
              <Podrazdelek naslov={t("ghdPotGh")}>
                <button type="button" disabled={zaposlen} className={`${stanje.oauthNaVoljo ? GUMB_OBROBA : GUMB} w-fit`} onClick={() => izvedi(async () => setStanje(await uporabiGhFn()))}>
                  {t("ghdPotGh")}
                </button>
              </Podrazdelek>
            ) : null}
            <Podrazdelek naslov={t("ghdPotKljuc")}>
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void izvedi(async () => {
                    const s = await shraniKljucGithubFn({ data: { kljuc } });
                    setKljuc("");
                    setStanje(s);
                  });
                }}
              >
                <p className="text-[var(--color-moss)]">{t("ghdKljucNavodilo")}</p>
                <label className={OZNAKA_POLJA} htmlFor="ghd-kljuc">
                  {t("ghdKljuc")}
                  <input id="ghd-kljuc" type="password" autoComplete="off" spellCheck={false} value={kljuc} onChange={(e) => setKljuc(e.target.value)} className={POLJE} />
                </label>
                <button type="submit" disabled={zaposlen || !kljuc} className={`${GUMB_OBROBA} w-fit`}>
                  {t("ghdShrani")}
                </button>
              </form>
            </Podrazdelek>
          </>
        )}
        {obvestilo ? <p role="status">{obvestilo}</p> : null}
        {lokalna ? <p role="alert" className="text-[var(--color-signal)]">{lokalna}</p> : null}
      </div>
    </Razdelek>
  );
}

/** Izbira repozitorija in tokov z rocnim zagonom; streznik vsak tok preveri na GitHubu, preden ga shrani. */
function IzbiraTokov({ onError }: { onError: (m: string) => void }) {
  const [izbira, setIzbira] = useState<IzbiraRepozitorija[]>([]);
  const [repoji, setRepoji] = useState<string[] | null>(null);
  const [repo, setRepo] = useState("");
  const [tokovi, setTokovi] = useState<TokRepozitorija[] | null>(null);
  const [oznaceni, setOznaceni] = useState<Record<string, VrstaIzdelka | null>>({});
  const [zaposlen, setZaposlen] = useState(false);
  const [sporocilo, setSporocilo] = useState("");

  useEffect(() => {
    void izbiraGithubFn()
      .then(setIzbira)
      .catch(() => setIzbira([]));
  }, []);

  async function izvedi(delo: () => Promise<void>) {
    setZaposlen(true);
    setSporocilo("");
    onError("");
    try {
      await delo();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "");
    } finally {
      setZaposlen(false);
    }
  }

  function izberiRepo(r: string) {
    setRepo(r);
    setTokovi(null);
    if (!r) return;
    void izvedi(async () => {
      const seznam = await tokoviGithubFn({ data: { repozitorij: r } });
      const prej = izbira.find((x) => x.repozitorij === r)?.tokovi ?? [];
      setOznaceni(Object.fromEntries(seznam.map((x) => [x.tok, prej.find((p) => p.tok === x.tok)?.vrsta ?? null])));
      setTokovi(seznam);
    });
  }

  const vsi = izbira.flatMap((r) => r.tokovi.map((x) => `${r.repozitorij} · ${x.tok} (${t(VRSTE.find(([v]) => v === x.vrsta)![1])})`));
  return (
    <Podrazdelek naslov={t("ghdRepoNaslov")} opis={t("ghdRepoUvod")}>
      <div className="grid gap-3">
        <div>
          <p className={OZNAKA_POLJA}>{t("ghdIzbrano")}</p>
          {vsi.length ? (
            <ul className="mt-1 grid list-disc gap-1 pl-5">
              {vsi.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          ) : (
            <p className={NAMIG}>{t("ghdIzbranoPrazno")}</p>
          )}
        </div>
        {repoji === null ? (
          <button type="button" disabled={zaposlen} className={`${GUMB_OBROBA} w-fit`} onClick={() => izvedi(async () => setRepoji((await repozitorijiGithubFn()).map((r) => r.repozitorij)))}>
            {t("ghdRepoNalozi")}
          </button>
        ) : (
          <label className={OZNAKA_POLJA} htmlFor="ghd-repo">
            {t("ghdRepoIzberi")}
            <select id="ghd-repo" className={POLJE} value={repo} disabled={zaposlen} onChange={(e) => izberiRepo(e.target.value)}>
              <option value="">-</option>
              {repoji.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
        {repo && tokovi ? (
          tokovi.some((x) => x.rocniZagon) ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void izvedi(async () => {
                  const tega = tokovi.filter((x) => x.rocniZagon && oznaceni[x.tok]).map((x) => ({ tok: x.tok, vrsta: oznaceni[x.tok]! }));
                  const nova = [...izbira.filter((r) => r.repozitorij !== repo), ...(tega.length ? [{ repozitorij: repo, tokovi: tega }] : [])];
                  setIzbira(await shraniIzbiroGithubFn({ data: { izbira: nova } }));
                  setSporocilo(t("ghdShranjeno"));
                });
              }}
            >
              <ul className="grid gap-2">
                {tokovi
                  .filter((x) => x.rocniZagon)
                  .map((x) => (
                    <li key={x.tok} className="grid gap-1">
                      <label className={IZBIRA}>
                        <input
                          type="checkbox"
                          checked={Boolean(oznaceni[x.tok])}
                          onChange={(e) => setOznaceni({ ...oznaceni, [x.tok]: e.target.checked ? "drugo" : null })}
                        />
                        {x.ime} ({x.tok})
                      </label>
                      {oznaceni[x.tok] ? (
                        <label className="ml-7 text-xs" htmlFor={`ghd-vrsta-${x.tok}`}>
                          {t("ghdVrsta")}{" "}
                          <select
                            id={`ghd-vrsta-${x.tok}`}
                            className={POLJE}
                            value={oznaceni[x.tok] ?? "drugo"}
                            onChange={(e) => setOznaceni({ ...oznaceni, [x.tok]: e.target.value as VrstaIzdelka })}
                          >
                            {VRSTE.map(([v, o]) => (
                              <option key={v} value={v}>
                                {t(o)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </li>
                  ))}
              </ul>
              <button type="submit" disabled={zaposlen} className={`${GUMB} w-fit`}>
                {t("ghdShraniIzbiro")}
              </button>
            </form>
          ) : (
            <p className={NAMIG}>{t("ghdTokoviBrez")}</p>
          )
        ) : null}
        {sporocilo ? <p role="status">{sporocilo}</p> : null}
      </div>
    </Podrazdelek>
  );
}
