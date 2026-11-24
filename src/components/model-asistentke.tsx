import { useState } from "react";
import { GUMB, GUMB_OBROBA, NAMIG, OZNAKA_POLJA, POLJE, Podrazdelek, Razdelek } from "@/components/ui-lina.tsx";
import { tM } from "@/lib/lina/besedila-mozgani.ts";
import {
  izberiModelFn,
  nastaviBrezplacneFn,
  odstraniKljucAsistentkeFn,
  preveriAsistentkoFn,
  shraniKljucAsistentkeFn,
  stanjeOpenRouterFn,
} from "@/lib/lina/functions.ts";
import { IME_PONUDNIKA, jeBrezplacenModel, PREDLOGI_BREZPLACNIH, PRIVZETI_BREZPLACNI, type BrainPublic } from "@/lib/lina/types.ts";

/**
 * Model za asistentko (lastnik 24. 11. 2026, A1, A6, B5, C1-C4, C8): locen od modela za klice (razdelek Mozgani). Z enim ponudnikom
 * je izbira zaklenjena na »Isti kot klici«; drugi izbirnik se pokaze sele z drugim shranjenim ponudnikom. Kljuc OpenRouter za
 * asistentko gre samo v ponudniki.json (nikoli v kljuci.json, klici ga ne dobijo). Brezplacni modeli samo s potrditvijo.
 */
type Stanje = Awaited<ReturnType<typeof stanjeOpenRouterFn>>;

function napaka(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function ModelAsistentke({
  brain,
  busy,
  onBrain,
  onError,
  onBusy,
}: {
  brain: BrainPublic;
  busy: boolean;
  onBrain: (brain: BrainPublic) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [kljuc, setKljuc] = useState("");
  const [model, setModel] = useState<string>(PRIVZETI_BREZPLACNI);
  const [soglasje, setSoglasje] = useState(false);
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [sporocilo, setSporocilo] = useState("");
  const shranjeni = brain.shranjeni ?? [];
  const asistentka = shranjeni.find((p) => p.provider === "openrouter" && p.samoAsistentka);
  const brezplacni = brain.brezplacniModeli === true;
  // A6 izjema: edini ponudnik je kljuc asistentke ali je v kljuci.json brezplacen model - klici nimajo modela.
  const kliciBrezModela = brain.provider === null ? Boolean(asistentka) : jeBrezplacenModel(brain.model);

  async function izvedi(delo: () => Promise<void>) {
    onBusy(true);
    onError("");
    setSporocilo("");
    try {
      await delo();
    } catch (cause) {
      onError(napaka(cause));
    } finally {
      onBusy(false);
    }
  }

  const izberi = (vrednost: string) =>
    izvedi(async () => {
      const [provider, ...ostalo] = vrednost.split("|");
      onBrain(await izberiModelFn({ data: vrednost ? { provider, model: ostalo.join("|") } : { provider: "", model: "" } }));
    });

  const shrani = () =>
    izvedi(async () => {
      onBrain(await shraniKljucAsistentkeFn({ data: { key: kljuc, model, soglasje } }));
      setKljuc("");
      setSporocilo(tM("shranjeno"));
      setStanje(await stanjeOpenRouterFn());
    });

  return (
    <Razdelek id="nast-asistentka" naslov={tM("naslovAsistentka")} opis={tM("asistentkaOpis")}>
      <Podrazdelek naslov={tM("naslovAsistentka")} id="asist-izbira">
        {kliciBrezModela ? (
          <p className="mb-3 text-sm text-[var(--color-signal)]" role="alert">
            {tM("samoBrezplacniZaKlice")}
          </p>
        ) : null}
        <label className={OZNAKA_POLJA} htmlFor="model-asistentke">
          {tM("naslovAsistentka")}
          <select
            id="model-asistentke"
            className={POLJE}
            disabled={busy || shranjeni.length < 2}
            value={brain.pogovor ? `${brain.pogovor.provider}|${brain.pogovor.model}` : ""}
            onChange={(e) => void izberi(e.target.value)}
          >
            <option value="">{tM("istiKotKlici")}</option>
            {shranjeni.length < 2
              ? // Zaklenjeno: pokaze dejanski model (npr. edini ponudnik je kljuc asistentke), ne »Isti kot klici«.
                brain.pogovor ? (
                  <option value={`${brain.pogovor.provider}|${brain.pogovor.model}`}>
                    {`${IME_PONUDNIKA[brain.pogovor.provider]}: ${brain.pogovor.model}`}
                  </option>
                ) : null
              : shranjeni.map((p) => (
                  <optgroup key={p.provider} label={IME_PONUDNIKA[p.provider]}>
                    {p.modeli.map((m) => (
                      <option key={m} value={`${p.provider}|${m}`}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
        </label>
        {shranjeni.length < 2 ? <span className={NAMIG}>{tM("enPonudnik")}</span> : null}
      </Podrazdelek>

      <Podrazdelek naslov={tM("kljucAsistentke")} opis={tM("kljucAsistentkeOpis")} id="asist-kljuc">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={OZNAKA_POLJA} htmlFor="kljuc-asistentke">
            {tM("kljucAsistentke")}
            <input
              id="kljuc-asistentke"
              type="password"
              autoComplete="off"
              value={kljuc}
              placeholder={asistentka?.namig ? `…${asistentka.namig}` : "sk-or-…"}
              onChange={(e) => setKljuc(e.target.value)}
              className={POLJE}
            />
          </label>
          <label className={OZNAKA_POLJA} htmlFor="model-or-asistentke">
            {tM("modelAsistentke")}
            <input
              id="model-or-asistentke"
              list="modeli-or-asistentke"
              value={model}
              autoComplete="off"
              onChange={(e) => setModel(e.target.value)}
              className={POLJE}
            />
            <datalist id="modeli-or-asistentke">
              {(stanje?.modeli.length ? stanje.modeli : [...PREDLOGI_BREZPLACNIH]).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>
        {!brezplacni ? (
          <label className="mt-4 flex items-start gap-3 text-sm" htmlFor="soglasje-brezplacni">
            <input
              id="soglasje-brezplacni"
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={soglasje}
              onChange={(e) => setSoglasje(e.target.checked)}
            />
            <span>
              <span className="block">{tM("soglasje")}</span>
              <span className="mt-1 block font-medium">{tM("soglasjePotrdi")}</span>
            </span>
          </label>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className={GUMB} disabled={busy} onClick={() => void shrani()}>
            {tM("shraniKljuc")}
          </button>
          <button
            type="button"
            className={GUMB_OBROBA}
            disabled={busy}
            onClick={() =>
              void izvedi(async () => {
                const izid = await preveriAsistentkoFn();
                setSporocilo([izid.sporocilo, izid.opozorilo].filter(Boolean).join(" "));
                if (!izid.ok) onError(izid.sporocilo);
              })
            }
          >
            {tM("preveri")}
          </button>
          {asistentka ? (
            <>
              <button type="button" className={GUMB_OBROBA} disabled={busy} onClick={() => void izvedi(async () => setStanje(await stanjeOpenRouterFn()))}>
                {tM("osveziStanje")}
              </button>
              <button
                type="button"
                className={GUMB_OBROBA}
                disabled={busy}
                onClick={() =>
                  void izvedi(async () => {
                    onBrain(await odstraniKljucAsistentkeFn());
                    setStanje(null);
                  })
                }
              >
                {tM("odstraniKljuc")}
              </button>
            </>
          ) : null}
        </div>
        {stanje ? (
          <p className="mt-3 text-sm" role="status">
            {stanje.sporocilo ||
              [
                stanje.brezplacniRacun === null ? "" : stanje.brezplacniRacun ? tM("racunBrezplacen") : tM("racunPlacljiv"),
                stanje.dnevnoPreostalo !== null && stanje.dnevnoMeja !== null
                  ? tM("dnevno").replace("{preostalo}", String(stanje.dnevnoPreostalo)).replace("{meja}", String(stanje.dnevnoMeja))
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
          </p>
        ) : null}
        {sporocilo ? (
          <p className="mt-3 text-sm" role="status">
            {sporocilo}
          </p>
        ) : null}
      </Podrazdelek>

      <Podrazdelek naslov={tM("stikalo")} opis={tM("stikaloOpis")} id="asist-brezplacni">
        <label className="flex items-center gap-3 text-sm" htmlFor="stikalo-brezplacni">
          <input
            id="stikalo-brezplacni"
            type="checkbox"
            role="switch"
            aria-checked={brezplacni}
            className="h-5 w-5"
            disabled={busy}
            checked={brezplacni}
            onChange={(e) => {
              const vklop = e.target.checked;
              void izvedi(async () => onBrain(await nastaviBrezplacneFn({ data: { vklop } })));
            }}
          />
          {tM("stikalo")}
        </label>
      </Podrazdelek>
    </Razdelek>
  );
}
