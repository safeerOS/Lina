import { tD } from "@/lib/lina/besedila-dovoljenja.ts";

/**
 * Izbira ob potrditvi (lastnik 24. 11. 2026): »Velja tudi za vse podobne«, privzeto obkljukano. Kar izbere lastnik tukaj, gre na
 * streznik kot `podobne: true`; drugih poti do dovoljenja ni (besedilo modela ali predloga ga ne more nastaviti).
 */
export function PodobneIzbira({ id, izbrano, onIzbira, onemogoceno }: { id: string; izbrano: boolean; onIzbira: (v: boolean) => void; onemogoceno?: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-xs" title={tD("izbiraPojasnilo")}>
      <input id={id} type="checkbox" checked={izbrano} disabled={onemogoceno} onChange={(e) => onIzbira(e.target.checked)} aria-describedby={`${id}-pojasnilo`} />
      <span>{tD("izbira")}</span>
      <span id={`${id}-pojasnilo`} className="sr-only">{tD("izbiraPojasnilo")}</span>
    </label>
  );
}
