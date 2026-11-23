/**
 * Sklanjanje imena lastnika v tozilnik (lastnik, 21. 11. 2026): »Poklicali ste Tomaža«, »Poklicali ste Alena«, »Poklicali ste Ano«.
 * Osebna tajnica NIKOLI ne reče »poklicali ste podjetje/osebo/organizacijo/društvo«, samo ime. Če uporabnik zapiše sklon sam
 * (pravila.imeLastnikaTozilnik), velja njegov zapis; sicer pravila spodaj. Besede brez zanesljivega pravila ostanejo nespremenjene.
 */

const IZJEME: Record<string, string> = {
  peter: "Petra", pavel: "Pavla", domen: "Domna", aleksander: "Aleksandra", alexander: "Alexandra", ozbej: "Ožbeja",
  lovrenc: "Lovrenca", franc: "Franca", marjan: "Marjana", jure: "Jureta", tone: "Toneta", anze: "Anžeta",
  bine: "Bineta", done: "Doneta", sime: "Simeta", mate: "Mateta", rene: "Reneja", vinko: "Vinka",
};

/** Ženska imena na soglasnik: tožilnik je enak imenovalniku. */
const ZENSKA_NA_SOGLASNIK = new Set(["ines", "karmen", "mirjam", "nives", "ingrid", "iris", "agnes", "jasmin", "ruth", "sonja_"]);

/** Moška imena na -a: Luka, Žiga, Miha, Jaka, Mitja, Matija ... imajo tožilnik na -o enako kot ženska. */
function brezNaglasov(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/č/g, "c").replace(/š/g, "s").replace(/ž/g, "z").toLowerCase();
}

function veliko(izvirnik: string, sklonjeno: string): string {
  return izvirnik[0] === izvirnik[0].toUpperCase() ? sklonjeno[0].toUpperCase() + sklonjeno.slice(1) : sklonjeno;
}

function sklanjajBesedo(beseda: string): string {
  const b = beseda.trim();
  if (b.length < 2) return b;
  const k = brezNaglasov(b);
  const izjema = IZJEME[k];
  if (izjema) return izjema;
  if (ZENSKA_NA_SOGLASNIK.has(k)) return b;
  const zadnja = b[b.length - 1].toLowerCase();
  const prej = b.slice(0, -1);
  if (zadnja === "a") return prej + "o"; // Ana -> Ano, Luka -> Luko
  if (zadnja === "e") return b + "ta"; // Jure -> Jureta
  if (zadnja === "o") return prej + "a"; // Marko -> Marka, Samo -> Sama
  if (zadnja === "i" || zadnja === "u") return b; // Tomi, Mimi: brez zanesljivega pravila
  if (/(or|ar)$/i.test(b) && !/^(sandor)$/i.test(k)) return b + "ja"; // Igor -> Igorja, Gregor -> Gregorja
  if (/(ec)$/i.test(b) && b.length > 4) return b.slice(0, -2) + "ca"; // Matevžec je izjema, a -ec: Nejec -> Nejca
  return b + "a"; // Tomaž -> Tomaža, Alen -> Alena, Primož -> Primoža
}

const MOSKA_NA_A = new Set(["luka", "ziga", "miha", "jaka", "mitja", "matija", "tilen_", "saso_"]);

function jeMoskoIme(prvo: string): boolean {
  const k = brezNaglasov(prvo);
  if (MOSKA_NA_A.has(k)) return true;
  if (ZENSKA_NA_SOGLASNIK.has(k)) return false;
  return !/[a]$/.test(k);
}

/** Ime ali ime in priimek v tožilniku. Prazen niz, če imena ni. Priimek se sklanja samo ob moškem imenu. */
export function imeVTozilniku(ime: string, uporabnikovZapis = ""): string {
  const zapis = uporabnikovZapis.replace(/\s+/g, " ").trim();
  if (zapis) return zapis;
  const cisto = ime.replace(/\s+/g, " ").trim();
  if (!cisto) return "";
  const dele = cisto.split(" ");
  const mosko = jeMoskoIme(dele[0]);
  const prvo = veliko(dele[0], sklanjajBesedo(dele[0]));
  const priimki = dele.slice(1).map((d) => (mosko ? veliko(d, sklanjajBesedo(d)) : d));
  return [prvo, ...priimki].join(" ");
}

/** Besede, ki v osebnem načinu NE smejo stati za »poklicali ste« (kažejo, da klic ni osebna raba). */
export const PREPOVEDANO_ZA_POKLICALI = /poklicali ste\s+(?:podjetje|osebo|organizacijo|društvo|drustvo|družbo|druzbo|firmo|podjetja|oseb|organizacij|ustanovo|zavod)/i;
