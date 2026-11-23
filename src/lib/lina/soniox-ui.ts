export function jeVeljavenKljucSoniox(kljuc: string): boolean {
  const trimmed = kljuc.trim();
  if (trimmed.length < 8 || trimmed.length > 200) return false;
  if (/[\s\x00-\x1F\x7F]/.test(trimmed)) return false;
  return true;
}

export function stanjeBesedilo(stanje: { vklop: boolean; kljucShranjen: boolean } | null): "sonioxStanjeNalaga" | "sonioxStanjeIzklopljen" | "sonioxStanjeBrezKljuca" | "sonioxStanjeAktiven" {
  if (stanje === null) return "sonioxStanjeNalaga";
  if (!stanje.vklop) return "sonioxStanjeIzklopljen";
  if (stanje.vklop && !stanje.kljucShranjen) return "sonioxStanjeBrezKljuca";
  return "sonioxStanjeAktiven";
}