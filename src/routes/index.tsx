import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Lina2Okvir } from "@/components/lina2/okvir.tsx";
import {
  GUMB,
  GUMB_OBROBA,
  NAMIG,
  OZNAKA_POLJA,
  PLOSCA,
  POLJE,
  StanjeNalaganja,
  StanjeNapaka,
} from "@/components/ui-lina.tsx";
import {
  authStatus,
  daSoglasjeFn,
  listCalls,
  listVrzeliFn,
  loginFn,
  readBrainFn,
  readLine,
  readPravilaFn,
  readStorageFn,
  setupOwnerFn,
  soglasjeFn,
} from "@/lib/lina/functions.ts";
import { t } from "@/lib/lina/besedila.ts";

export const Route = createFileRoute("/")({
  loader: async () => {
    const auth = await authStatus();
    const soglasje = (await soglasjeFn()).dano;
    // Brez soglasja ali prijave se podatki ne preberejo (zaslon ni dosegljiv).
    if (!soglasje || !auth.signedIn) {
      return {
        soglasje,
        auth,
        line: null,
        calls: [],
        brain: { provider: null, model: "", nastavljen: false, namig: null },
        storage: null,
        pravila: null,
        vrzeli: [],
      };
    }
    const [line, calls, brain, storage, pravila, vrzeli] = await Promise.all([
      readLine(),
      listCalls(),
      readBrainFn(),
      readStorageFn(),
      readPravilaFn(),
      listVrzeliFn(),
    ]);
    return { soglasje, auth, line, calls, brain, storage, pravila, vrzeli };
  },
  component: Home,
  pendingComponent: Nalaganje,
  pendingMs: 500,
});

function Nalaganje() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <p className="display text-4xl">Lina</p>
      <StanjeNalaganja />
    </main>
  );
}

function Home() {
  const data = Route.useLoaderData();
  const router = useRouter();
  if (!data.soglasje) return <Soglasje onDone={() => router.invalidate()} />;
  if (!data.auth.signedIn || !data.line || !data.storage || !data.pravila) {
    return <Gate needsSetup={data.auth.needsSetup} onDone={() => router.invalidate()} />;
  }
  return (
    <Lina2Okvir
      line={data.line}
      calls={data.calls}
      llm={data.auth.llm}
      brezGesla={data.auth.brezGesla}
      brain={data.brain}
      storage={data.storage}
      pravila={data.pravila}
      vrzeli={data.vrzeli}
    />
  );
}

/** Soglasje ob prvem zagonu: brez njega se Lina ne more uporabljati (zaslon ni dosegljiv, sprejem klicev je zaprt). */
function Soglasje({ onDone }: { onDone: () => void }) {
  const [napaka, setNapaka] = useState("");
  const [ne, setNe] = useState(false);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-5 py-10">
      <h1 className="display text-4xl">{t("soglNaslov")}</h1>
      <p>{t("soglUvod")}</p>
      <ul className="grid list-disc gap-2 pl-5 text-sm">
        <li>{t("soglTocka1")}</li>
        <li>{t("soglTocka2")}</li>
        <li>{t("soglTocka3")}</li>
      </ul>
      {ne ? (
        <p role="status" className="text-sm text-[var(--color-moss)]">
          {t("soglBrez")}
        </p>
      ) : null}
      {napaka ? <StanjeNapaka razlog={napaka} /> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={GUMB}
          onClick={async () => {
            setNapaka("");
            try {
              await daSoglasjeFn();
              onDone();
            } catch (cause) {
              setNapaka(cause instanceof Error ? cause.message : "");
            }
          }}
        >
          {t("soglSoglasam")}
        </button>
        <button type="button" className={GUMB_OBROBA} onClick={() => setNe(true)}>
          {t("soglNeSoglasam")}
        </button>
      </div>
    </main>
  );
}

/** Prva nastavitev in prijava: en korak, en gumb, en stavek (AGENTS.md »Nastavitev mora biti zelo enostavna«). */
function Gate({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void | Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pokazi, setPokazi] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (needsSetup) await setupOwnerFn({ data: { password } });
      else await loginFn({ data: { password } });
      setPassword("");
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("uiPrijavaNiUspela"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <p className="text-xs font-medium tracking-wide text-[var(--color-brass)] uppercase">
        {needsSetup ? t("uiGatePrva") : t("uiGatePrijava")}
      </p>
      <h1 className="display mt-2 text-5xl leading-none text-[var(--color-ink)]">Lina</h1>
      <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">{t("podnaslov")}</p>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-moss)]">{t("uiGateUvod")}</p>
      <form onSubmit={submit} className={`${PLOSCA} mt-8 p-6`} aria-busy={busy}>
        {needsSetup ? <p className="mb-4 text-xs font-medium text-[var(--color-brass)]">{t("uiGateKorak")}</p> : null}
        <label className={OZNAKA_POLJA} htmlFor="geslo">
          {needsSetup ? t("uiGesloNovo") : t("uiGeslo")}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="geslo"
            type={pokazi ? "text" : "password"}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            minLength={8}
            required
            aria-describedby="geslo-namig"
            aria-invalid={error ? true : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${POLJE} mt-0 min-w-0 flex-1`}
          />
          <button type="button" className={`${GUMB_OBROBA} px-4`} aria-pressed={pokazi} onClick={() => setPokazi((v) => !v)}>
            {pokazi ? t("uiGesloSkrij") : t("uiGesloPokazi")}
          </button>
        </div>
        <p id="geslo-namig" className={NAMIG}>
          {t("uiGesloNamig")}
        </p>
        {error ? (
          <div className="mt-4">
            <StanjeNapaka razlog={error} />
          </div>
        ) : null}
        <button type="submit" disabled={busy} className={`${GUMB} mt-6 w-full`}>
          {busy ? t("uiTrenutek") : needsSetup ? t("uiGesloNastavi") : t("uiVstopi")}
        </button>
        {needsSetup ? <p className="mt-4 text-xs leading-relaxed text-[var(--color-moss)]">{t("uiGateNaprej")}</p> : null}
      </form>
    </main>
  );
}
