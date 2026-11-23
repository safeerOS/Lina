import { t } from "./besedila.ts";
import { razlogPolja, razlogTeme } from "./plast.ts";
import type { Catalog, Material, Product, Zapisek } from "./types.ts";
import { normirajZnanje } from "./znanje-besedilo.ts";

export type PublishInput = {
  open?: boolean;
  /** Uporabnik je izrecno potrdil odprtje brez pripravljenega glasu. */
  brezGlasu?: boolean;
  catalog?: Catalog;
};

function zavrniDenar(polje: string, value: string): void {
  const zavrnitev = razlogPolja(polje, value);
  if (zavrnitev) throw new Error(zavrnitev);
}

/** Telefon po obliki. Crke in prekratka stevilka ne gresta skozi. Prazno polje je dovoljeno. */
function blagTelefon(phone: string): void {
  if (!phone.trim()) return;
  if (/\p{L}/u.test(phone)) throw new Error(t("telefonOblika"));
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error(t("telefonOblika"));
}

/** Hisna stevilka je obvezna, ce je naslov vpisan. Postna ni, ker vzorec delavnice je nima. */
function blagNaslov(address: string): void {
  if (!address.trim()) return;
  if (!/\d/.test(address)) throw new Error(t("naslovOblika"));
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function slug(name: string, used: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "postavka";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function readCatalog(raw: unknown): Catalog {
  if (!raw || typeof raw !== "object") throw new Error("Katalog manjka.");
  const body = raw as Record<string, unknown>;
  const companyRaw = (body.company ?? {}) as Record<string, unknown>;
  const name = text(companyRaw.name, 80);
  if (!name) throw new Error("Ime podjetja je obvezno.");
  const trade = text(companyRaw.trade, 120);
  const phone = text(companyRaw.phone, 40);
  const address = text(companyRaw.address, 160);
  const hours = text(companyRaw.hours, 240);
  const about = text(companyRaw.about, 2000);
  blagTelefon(phone);
  blagNaslov(address);
  zavrniDenar("opis", about);

  const materialsRaw = Array.isArray(body.materials) ? body.materials.slice(0, 40) : [];
  const materialIds = new Set<string>();
  const materials: Material[] = [];
  for (const item of materialsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const materialName = text(row.name, 80);
    if (!materialName) continue;
    const note = text(row.note, 240);
    zavrniDenar("opomba", note);
    materials.push({
      id: slug(materialName, materialIds),
      name: materialName,
      note,
    });
  }

  const productsRaw = Array.isArray(body.products) ? body.products.slice(0, 40) : [];
  const productIds = new Set<string>();
  const products: Product[] = [];
  for (const item of productsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const productName = text(row.name, 80);
    if (!productName) continue;
    const kind = text(row.kind, 80);
    const summary = text(row.summary, 240);
    zavrniDenar("vrsta", kind);
    zavrniDenar("povzetek", summary);
    const wanted = Array.isArray(row.materialIds) ? row.materialIds : [];
    const linked = [
      ...new Set(
        wanted
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .map((id) => {
            const byId = materials.find((item) => item.id === id);
            if (byId) return byId.id;
            const byName = materials.find((item) => item.name.toLowerCase() === id.toLowerCase());
            return byName?.id ?? "";
          })
          .filter((id) => id && materialIds.has(id)),
      ),
    ];
    products.push({
      id: slug(productName, productIds),
      name: productName,
      kind,
      summary,
      materialIds: linked,
    });
  }

  const zapiskiRaw = Array.isArray(body.zapiski) ? body.zapiski : [];
  if (zapiskiRaw.length > 100) throw new Error(t("mejaZapiskov"));
  const zapiski: Zapisek[] = [];
  for (const item of zapiskiRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const vprasanje = text(row.vprasanje, 400);
    const odgovor = text(row.odgovor, 800);
    if (!vprasanje || !odgovor) continue;
    zavrniDenar("odgovor", odgovor);
    const tema = razlogTeme(`${vprasanje} ${odgovor}`);
    if (tema) throw new Error(`${tema} Zapisek: ${vprasanje}.`);
    zapiski.push({
      id: text(row.id, 80) || slug(vprasanje, new Set(zapiski.map((note) => note.id))),
      vprasanje,
      odgovor,
    });
  }

  return {
    company: {
      name,
      trade,
      phone,
      address,
      hours,
      about,
    },
    materials,
    products,
    zapiski,
    // Prosto besedilo (najvec 20000 znakov): podatek, ne navodilo. Denarni signal tu ne zavrne dokumenta; odgovor Line ga
    // vedno preveri posebej (razumevanje.server.ts), cene in roka Lina iz znanja ne pove.
    znanje: normirajZnanje(body.znanje),
  };
}

/** Sprejme samo znana polja. Odprtost linije in katalog. */
export function parsePublish(input: unknown): PublishInput {
  if (!input || typeof input !== "object") throw new Error("Neveljavna zahteva.");
  const body = input as Record<string, unknown>;
  const patch: PublishInput = {};
  if ("open" in body) {
    if (typeof body.open !== "boolean") throw new Error("Odprtost linije mora biti da ali ne.");
    patch.open = body.open;
  }
  // Izrecna potrditev uporabnika »odpri brez glasu«; velja samo skupaj z odprtjem.
  if (body.brezGlasu === true && body.open === true) patch.brezGlasu = true;
  if ("catalog" in body && body.catalog != null) patch.catalog = readCatalog(body.catalog);
  return patch;
}

/** Star zapisek o garanciji ali dostavi se ob branju spet preveri in ne velja. */
export function brezTematskihZapiskov(catalog: Catalog): Catalog {
  const zapiski = (catalog.zapiski ?? []).filter((zapis) => !razlogTeme(`${zapis.vprasanje} ${zapis.odgovor}`));
  if (zapiski.length === (catalog.zapiski ?? []).length) return catalog;
  return { ...catalog, zapiski };
}
