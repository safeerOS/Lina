/** Omejevanje hitrosti po viru (vedro zetonov). Stevilo sledenih virov je omejeno, da napadalec ne napolni pomnilnika. */

export type MoznostiOmejevalnika = {
  /** Najvec zetonov (izbruh). */
  kapaciteta: number;
  /** Zetoni na sekundo. */
  napolnitev: number;
  /** Najvec virov v tabeli; najstarejsi se izpodrine. */
  najvecVirov: number;
  zdaj?: () => number;
};

export class OmejevalnikHitrosti {
  private vedra = new Map<string, { zetoni: number; cas: number }>();
  private readonly m: Required<MoznostiOmejevalnika>;

  constructor(m: MoznostiOmejevalnika) {
    this.m = { zdaj: () => performance.now(), ...m };
  }

  /** true = dovoljeno (porabi zeton), false = zavrzi. */
  dovoli(vir: string): boolean {
    const zdaj = this.m.zdaj();
    let vedro = this.vedra.get(vir);
    if (vedro) {
      this.vedra.delete(vir);
      vedro.zetoni = Math.min(this.m.kapaciteta, vedro.zetoni + ((zdaj - vedro.cas) / 1000) * this.m.napolnitev);
      vedro.cas = zdaj;
    } else {
      vedro = { zetoni: this.m.kapaciteta, cas: zdaj };
      while (this.vedra.size >= this.m.najvecVirov) {
        const najstarejsi = this.vedra.keys().next().value;
        if (najstarejsi === undefined) break;
        this.vedra.delete(najstarejsi);
      }
    }
    this.vedra.set(vir, vedro);
    if (vedro.zetoni < 1) return false;
    vedro.zetoni -= 1;
    return true;
  }

  get steviloVirov(): number {
    return this.vedra.size;
  }
}
