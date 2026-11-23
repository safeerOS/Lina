import { useEffect, useState } from "react";
import { t } from "@/lib/lina/besedila.ts";

export type Tema = "sistem" | "svetla" | "temna";
const KLJUC = "lina-tema";

/**
 * Skript v <head>: nastavi data-theme pred prvim izrisom (brez utripa). Brez shranjene izbire je svetla (lastnikova skica
 * Lina 2.0, 21. 11. 2026); »Kot sistem« se shrani izrecno in sledi temni/svetli temi sistema (22. 11. 2026, temna tema).
 */
export const SKRIPT_TEMA =
  'try{var t=localStorage.getItem("lina-tema");var d=document.documentElement;if(t==="temna")d.dataset.theme="dark";else if(t==="sistem"){if(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)d.dataset.theme="dark";}else d.dataset.theme="light";}catch(e){}';

function uporabi(tema: Tema) {
  const el = document.documentElement;
  const sistemTemen = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (tema === "temna" || (tema === "sistem" && sistemTemen)) el.dataset.theme = "dark";
  else if (tema === "svetla") el.dataset.theme = "light";
  else delete el.dataset.theme;
}

export function TemaPreklop() {
  const [tema, setTema] = useState<Tema>("svetla");
  useEffect(() => {
    try {
      const s = localStorage.getItem(KLJUC);
      if (s === "temna" || s === "svetla" || s === "sistem") setTema(s);
    } catch {
      /* shramba ni na voljo: ostane sistem */
    }
  }, []);
  const izberi = (nova: Tema) => {
    setTema(nova);
    uporabi(nova);
    try {
      localStorage.setItem(KLJUC, nova);
    } catch {
      /* izbira velja do zaprtja strani */
    }
  };
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-moss)]">
      <span>{t("tema")}</span>
      <select
        value={tema}
        onChange={(e) => izberi(e.target.value as Tema)}
        className="rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-ink)]"
      >
        <option value="sistem">{t("temaSistem")}</option>
        <option value="svetla">{t("temaSvetla")}</option>
        <option value="temna">{t("temaTemna")}</option>
      </select>
    </label>
  );
}
