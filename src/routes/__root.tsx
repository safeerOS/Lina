import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { zacetniJezik } from "@/components/jezik-preklop.tsx";
import { nastaviJezikVmesnika, t, type Jezik } from "@/lib/lina/besedila.ts";
import lina2Css from "@/components/lina2/lina2.css?url";
import appCss from "../styles.css?url";

/** Izbrana tema (svetla/temna) se nastavi pred prvim izrisom, da stran ne zabliska v napacni temi. */
const SKRIPT_TEMA =
  'try{var t=localStorage.getItem("lina-tema");var d=document.documentElement;if(t==="temna")d.dataset.theme="dark";else if(t==="sistem"){if(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)d.dataset.theme="dark";}else d.dataset.theme="light";}catch(e){}';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LINA · digitalna tajnica" },
      { name: "theme-color", content: "#1c1612" },
      { name: "description", content: "LINA sprejme klic, pozna katalog delavnice in zapiše naročilo." },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: lina2Css },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,680&family=Outfit:wght@380;500;640&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Zasloni se izrisejo SELE, ko je jezik razresen (N4): sicer otroci ze v slovenscini klicejo streznik (misel dneva z zapiski),
  // nato jih menjava jezika priklopi se enkrat. Streznik in prvi izris brskalnika sta oba brez zaslonov, zato brez neujemanja.
  const [jezik, setJezik] = useState<Jezik | null>(null);
  useEffect(() => {
    let ziv = true;
    // Napaka pri razresevanju ne sme pustiti praznega vmesnika: rezerva je slovenscina.
    void zacetniJezik().catch((): Jezik => "sl").then((j) => {
      if (!ziv) return;
      nastaviJezikVmesnika(j);
      document.title = t("uiNaslovStrani");
      document.querySelector('meta[name="description"]')?.setAttribute("content", t("uiOpisStrani"));
      setJezik(j);
    });
    return () => {
      ziv = false;
    };
  }, []);
  return (
    <html lang={jezik ?? "sl"}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKRIPT_TEMA }} />
        <HeadContent />
      </head>
      <body>
        {jezik ? <Outlet key={jezik} /> : null}
        <Scripts />
      </body>
    </html>
  );
}
