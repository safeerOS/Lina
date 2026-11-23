/**
 * Prvi zagon vodi do vaje klica (lastnik 10. 11. 2026): dokler linija ni bila odprta in ni klicev, program pred gumbom
 * »Odpri linijo« uporabnika opozori na vajo. Namig je samo opozorilo; gumba ne skrije (kdor Lino pozna, jo odpre takoj).
 */
export function kazatiNamigZaVajo(stanje: { odprta: boolean; steviloKlicev: number }): boolean {
  return !stanje.odprta && stanje.steviloKlicev === 0;
}
