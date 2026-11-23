/**
 * Shematska slika korakov v navodilih (lastnik 12. 11. 2026: navodila ob predaji podjetju s slikovnim gradivom).
 * Namerno shema, ne posnetek zaslona: posnetki z racunom, e-posto ali stevilko ne gredo v repozitorij.
 * Vrstica je »naslov|podnaslov«; vrstica z ne=true je oznacena kot »tega ne vpisujte« (prekrizana, pikcasta, tudi z besedo, ne samo barvo).
 * Barve iz oznacitev (tokens.css), brez trdo kodiranih barv.
 */
export type Vrstica = { besedilo: string; ne?: boolean };

export function KorakiSlika({ naslov, vrstice }: { naslov: string; vrstice: Vrstica[] }) {
  const visina = 64;
  const skupaj = vrstice.length * visina + 8;
  return (
    <svg viewBox={`0 0 560 ${skupaj}`} role="img" aria-label={naslov} className="my-2 w-full max-w-xl">
      <title>{naslov}</title>
      {vrstice.map((v, i) => {
        const [glavno, podnaslov = ""] = v.besedilo.split("|");
        const y = 4 + i * visina;
        const barva = v.ne ? "var(--color-signal)" : "var(--color-ink)";
        return (
          <g key={`${i}-${glavno}`}>
            <rect x="2" y={y} width="556" height="48" rx="12" fill="var(--color-sheet)" stroke={barva} strokeWidth="1.5" strokeDasharray={v.ne ? "6 4" : undefined} />
            <circle cx="30" cy={y + 24} r="13" fill={barva} />
            <text x="30" y={y + 29} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--color-paper)">{v.ne ? "✕" : i + 1}</text>
            <text x="56" y={y + 21} fontSize="15" fontWeight="700" fill={barva}>{glavno}</text>
            <text x="56" y={y + 39} fontSize="12.5" fill="var(--color-moss)">{podnaslov}</text>
            {i < vrstice.length - 1 && !vrstice[i + 1].ne ? <path d={`M30 ${y + 48} v16`} stroke={barva} strokeWidth="1.5" /> : null}
          </g>
        );
      })}
    </svg>
  );
}
