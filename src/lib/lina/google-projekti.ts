/**
 * Projekti Google Cloud po prijavi (lastnik 22. 11. 2026: »tako kot na telefonu tudi na racunalniku naj se uporabniku ponudi
 * primeren id projekta, ki ga ima pripravljenega za Lino«). `gcloud projects list` po prijavi ADC vrne prazno (zahteva aktiven
 * racun gcloud), zato beremo REST z zetonom ADC: Cloud Resource Manager (aktivni projekti) in Cloud Billing (ali je obracun
 * vklopljen). Isti postopek kot telefon (GoogleCloud.kt). Projekti z obracunom so prvi; en sam tak projekt se izbere sam.
 * Komentarji so brez sumnikov.
 */

export type ProjektGoogle = { id: string; ime: string; obracun: boolean | null };

export const NASLOV_PROJEKTOV = "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100";
export const NAJVEC_PREVERJENIH = 20;
const ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function naslovObracuna(projekt: string): string {
  if (!ID.test(projekt)) throw new Error("Neveljaven ID projekta.");
  return `https://cloudbilling.googleapis.com/v1/projects/${projekt}/billingInfo`;
}

/** Aktivni projekti iz odgovora Resource Manager; samo veljavni ID-ji. */
export function razberiProjekteRest(json: unknown): { id: string; ime: string }[] {
  const seznam = (json as { projects?: unknown })?.projects;
  if (!Array.isArray(seznam)) return [];
  const izid: { id: string; ime: string }[] = [];
  for (const el of seznam) {
    const { projectId, name, lifecycleState } = (el ?? {}) as { projectId?: unknown; name?: unknown; lifecycleState?: unknown };
    if (typeof projectId !== "string" || !ID.test(projectId)) continue;
    if (lifecycleState !== undefined && lifecycleState !== "ACTIVE") continue;
    izid.push({ id: projectId, ime: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : projectId });
  }
  return izid;
}

/** billingEnabled iz odgovora Cloud Billing: true/false, null ce ni znano. */
export function razberiObracun(json: unknown): boolean | null {
  const v = (json as { billingEnabled?: unknown })?.billingEnabled;
  if (v === true) return true;
  // Odgovor brez polja pomeni, da obracun ni vezan (API vrne prazen objekt).
  if (v === false || (json && typeof json === "object" && !("billingEnabled" in json) && "name" in json)) return false;
  return null;
}

/** Najprej z obracunom, nato neznani, nazadnje brez; znotraj po imenu. */
export function razvrstiProjekte(p: readonly ProjektGoogle[]): ProjektGoogle[] {
  const red = (o: boolean | null) => (o === true ? 0 : o === null ? 1 : 2);
  return [...p].sort((a, b) => red(a.obracun) - red(b.obracun) || a.ime.localeCompare(b.ime, "sl"));
}

/**
 * Projekt, ki ga Lina izbere sama: edini z obracunom; ce obracuna ni mogoce preveriti, edini projekt sploh.
 * Vec moznih projektov: izbere uporabnik (null).
 */
export function samodejniProjekt(p: readonly ProjektGoogle[]): string | null {
  const zObracunom = p.filter((x) => x.obracun === true);
  if (zObracunom.length === 1) return zObracunom[0]!.id;
  if (zObracunom.length === 0 && p.length === 1 && p[0]!.obracun !== false) return p[0]!.id;
  return null;
}

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Prebere projekte in obracun. Napaka omrezja ali zavrnitev: prazen seznam (klicatelj uporabi rezervo gcloud). */
export async function preberiProjekteRest(zeton: string, f: Fetch): Promise<ProjektGoogle[]> {
  const glava = { authorization: `Bearer ${zeton}` };
  let projekti: { id: string; ime: string }[];
  try {
    const odg = await f(NASLOV_PROJEKTOV, { headers: glava });
    if (!odg.ok) return [];
    projekti = razberiProjekteRest(await odg.json());
  } catch {
    return [];
  }
  const z = await Promise.all(
    projekti.slice(0, NAJVEC_PREVERJENIH).map(async (p): Promise<ProjektGoogle> => {
      try {
        const odg = await f(naslovObracuna(p.id), { headers: glava });
        return { ...p, obracun: odg.ok ? razberiObracun(await odg.json()) : null };
      } catch {
        return { ...p, obracun: null };
      }
    }),
  );
  const ostali = projekti.slice(NAJVEC_PREVERJENIH).map((p) => ({ ...p, obracun: null }));
  return razvrstiProjekte([...z, ...ostali]);
}
