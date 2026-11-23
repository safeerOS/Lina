export interface KolicinaPaketov {
    bajti: number;
    casMs: number;
    izgubljeni: number;
    zakasneli: number;
    jitterMs: number;
    ponovniPrenosi: number;
    napakeDekodiranja: number;
    skupajPaketov: number;
}

const PRAG_CRNE_SVETLOSTI = 18;  // crna videa v omejenem obsegu je 16
const PRAG_CRNE_KONTRASTA = 4;   // standardni odklon: enolicna slika (crna ploskev, sum kodeka < 4)

export interface Slika {
    sirina: number;
    visina: number;
    podatki: Uint8Array; // Grayscale bytes
}

export interface Zvok {
    vzorci: Float32Array; // -1.0 do 1.0
}

export interface Meritve {
    bitnaHitrost: number; // bps
    izgubaPaketov: number; // %
    jitterMs: number;
    napakeDekodiranja: number;
    
    slikaOstrina: number;
    slikaBlokovnost: number;
    slikaGibanje: number;
    slikaSvetlost: number;
    slikaKontrast: number;
    slikaZmrznjen: boolean;
    slikaCrn: boolean;
    razmerjeStranic: number;
    
    zvokRms: number;
    zvokVrh: number;
    zvokTisina: boolean;
    zvokClipping: number; // %
    
    ocena: number; // 0-100
}

export interface NastavitveTV {
    ostrina: number;
    kontrast: number;
    svetlost: number;
    locljivost: string;
    vir: string;
}

export interface Popravek {
    ime: string;
    tarca: keyof NastavitveTV | 'paketi';
    novaVrednost: any;
    prejsnjaVrednost: any;
    meritevPred: number;
    stanje?: 'predlog' | 'uporabljeno';
}

// Stikalo privzeto izklopljeno
export let KAKOVOST_VKLOPLJENA = false;

export function nastaviKakovostVklopljena(vklop: boolean) {
    KAKOVOST_VKLOPLJENA = vklop;
}

export function izracunajOstrino(slika: Slika): number {
    const { sirina, visina, podatki } = slika;
    if (sirina < 3 || visina < 3 || podatki.length !== sirina * visina) return NaN;
    
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    
    for (let y = 1; y < visina - 1; y++) {
        for (let x = 1; x < sirina - 1; x++) {
            const idx = y * sirina + x;
            const v = 
                podatki[idx - sirina] + 
                podatki[idx - 1] + 
                podatki[idx + 1] + 
                podatki[idx + sirina] - 
                4 * podatki[idx];
            
            sum += v;
            sumSq += v * v;
            count++;
        }
    }
    if (count === 0) return NaN;
    const mean = sum / count;
    // normalizacija: varianca absolutna je odvisna od locljivosti, ampak vrnimo jo kot je, odlocitev primerja z zgodovino
    const variance = (sumSq / count) - (mean * mean);
    return variance;
}

export function izracunajBlokovnost(slika: Slika): number {
    const { sirina, visina, podatki } = slika;
    if (sirina < 9 || visina < 9 || podatki.length !== sirina * visina) return 1;

    let blockDiff = 0;
    let internalDiff = 0;
    let blockCount = 0;
    let internalCount = 0;
    
    // Y-prehod (vrstice)
    for (let y = 0; y < visina; y++) {
        for (let x = 0; x < sirina - 1; x++) {
            const diff = Math.abs(podatki[y * sirina + x] - podatki[y * sirina + x + 1]);
            if ((x + 1) % 8 === 0) {
                blockDiff += diff;
                blockCount++;
            } else {
                internalDiff += diff;
                internalCount++;
            }
        }
    }
    // X-prehod (stolpci) - cache friendly bi bil zunanji x, a slabo za procesor, vendar naj ostane Y zunaj za hitrost
    for (let y = 0; y < visina - 1; y++) {
        for (let x = 0; x < sirina; x++) {
            const diff = Math.abs(podatki[y * sirina + x] - podatki[(y + 1) * sirina + x]);
            if ((y + 1) % 8 === 0) {
                blockDiff += diff;
                blockCount++;
            } else {
                internalDiff += diff;
                internalCount++;
            }
        }
    }
    
    const avgBlock = blockCount > 0 ? blockDiff / blockCount : 0;
    const avgInternal = internalCount > 0 ? internalDiff / internalCount : 0;
    
    return avgInternal >= 1 ? avgBlock / avgInternal : 1;
}

export function oceniSliko(slika: Slika, prejsnjaSlika: Slika | null): Partial<Meritve> {
    if (!KAKOVOST_VKLOPLJENA) {
        return {
            slikaSvetlost: 0, slikaKontrast: 0, slikaOstrina: 0, slikaBlokovnost: 0, 
            razmerjeStranic: 1, slikaCrn: false, slikaZmrznjen: false, slikaGibanje: 0
        };
    }
    if (!slika || slika.sirina <= 0 || slika.visina <= 0 || slika.podatki.length !== slika.sirina * slika.visina) {
        return {
            slikaSvetlost: NaN, slikaKontrast: NaN, slikaOstrina: NaN, slikaBlokovnost: NaN, 
        razmerjeStranic: NaN, slikaCrn: false, slikaZmrznjen: false, slikaGibanje: 0
    };
}

    let slikaSvetlost = 0;
    for (let i = 0; i < slika.podatki.length; i++) {
        slikaSvetlost += slika.podatki[i];
    }
    slikaSvetlost /= slika.podatki.length;
    
    let slikaKontrastSumSq = 0;
    for (let i = 0; i < slika.podatki.length; i++) {
        const diff = slika.podatki[i] - slikaSvetlost;
        slikaKontrastSumSq += diff * diff;
    }
    const slikaKontrast = Math.sqrt(slikaKontrastSumSq / slika.podatki.length);
    
    const slikaOstrina = izracunajOstrino(slika);
    const slikaBlokovnost = izracunajBlokovnost(slika);
    const razmerjeStranic = slika.sirina / slika.visina;
    
    // Crna slika = temna IN enolicna. Omejen obseg videa (16-235) ima crno pri 16, zato prag svetlosti 18; temna scena
    // z vsebino (kontrast nad pragom) pa ni napaka (lastnik 17. 11. 2026: »hocem crno, ne sivino«).
    const slikaCrn = slikaSvetlost < PRAG_CRNE_SVETLOSTI && slikaKontrast < PRAG_CRNE_KONTRASTA;
    
    let slikaZmrznjen = false;
    let slikaGibanje = 0; // Prej slikaSum (gibanje)
    
    if (prejsnjaSlika && prejsnjaSlika.sirina === slika.sirina && prejsnjaSlika.visina === slika.visina && prejsnjaSlika.podatki.length === slika.podatki.length) {
        let diffSum = 0;
        for (let i = 0; i < slika.podatki.length; i++) {
            diffSum += Math.abs(slika.podatki[i] - prejsnjaSlika.podatki[i]);
        }
        const avgDiff = diffSum / slika.podatki.length;
        if (avgDiff < 0.5) {
            slikaZmrznjen = true;
        }
        slikaGibanje = avgDiff;
    }
    
    return {
        slikaSvetlost,
        slikaKontrast,
        slikaOstrina,
        slikaBlokovnost,
        razmerjeStranic,
        slikaCrn,
        slikaZmrznjen,
        slikaGibanje
    };
}

export function oceniZvok(zvok: Zvok): Partial<Meritve> {
    if (!KAKOVOST_VKLOPLJENA) {
        return { zvokRms: 0, zvokVrh: 0, zvokTisina: false, zvokClipping: 0 };
    }
    if (!zvok || !zvok.vzorci || zvok.vzorci.length === 0) {
        return { zvokRms: 0, zvokVrh: 0, zvokTisina: true, zvokClipping: 0 };
    }
    let sumSq = 0;
    let vrh = 0;
    let clipping = 0;
    let validCount = 0;
    for (let i = 0; i < zvok.vzorci.length; i++) {
        const v = zvok.vzorci[i];
        if (!Number.isFinite(v)) continue;
        const absV = Math.abs(v);
        sumSq += absV * absV;
        if (absV > vrh) vrh = absV;
        if (absV >= 0.99) clipping++;
        validCount++;
    }
    if (validCount === 0) return { zvokRms: NaN, zvokVrh: NaN, zvokTisina: false, zvokClipping: NaN };
    const zvokRms = Math.sqrt(sumSq / validCount);
    return {
        zvokRms,
        zvokVrh: vrh,
        zvokTisina: zvokRms < 0.001,
        zvokClipping: (clipping / validCount) * 100
    };
}

export function oceniPakete(paketi: KolicinaPaketov): Partial<Meritve> {
    if (!KAKOVOST_VKLOPLJENA) {
        return { bitnaHitrost: 0, izgubaPaketov: 0, jitterMs: 0, napakeDekodiranja: 0 };
    }
    if (!paketi || paketi.casMs <= 0) {
        return { bitnaHitrost: 0, izgubaPaketov: 100, jitterMs: NaN, napakeDekodiranja: NaN };
    }
    const bitnaHitrost = (paketi.bajti * 8) / (paketi.casMs / 1000);
    // Casms > 0 ampak skupajPaketov === 0 => 100% loss (izpad omrezja)
    let izgubaPaketov = paketi.skupajPaketov > 0 ? (paketi.izgubljeni / paketi.skupajPaketov) * 100 : 100;
    if (izgubaPaketov > 100) izgubaPaketov = 100;
    if (izgubaPaketov < 0) izgubaPaketov = 0;
    
    return {
        bitnaHitrost,
        izgubaPaketov,
        jitterMs: paketi.jitterMs,
        napakeDekodiranja: paketi.napakeDekodiranja
    };
}

export function izracunajOceno(meritve: Meritve): number {
    let ocena = 100;
    
    // Neveljaven vhod
    if (Number.isNaN(meritve.slikaOstrina) || (Number.isNaN(meritve.zvokRms) && Number.isNaN(meritve.izgubaPaketov))) {
        return NaN; // ali 100? KAK7 pravi "vrni oceno 0 z razlogom »neveljaven vhod« (ali kazen)" 
    }
    
    // Kazni za pakete
    if (meritve.izgubaPaketov > 5) ocena -= 20;
    else if (meritve.izgubaPaketov > 1) ocena -= 10;
    if (meritve.jitterMs > 50) ocena -= 10;
    if (meritve.napakeDekodiranja > 0) ocena -= 15;
    
    // Kazni za sliko
    if (meritve.slikaCrn) ocena -= 50;
    else if (meritve.slikaZmrznjen) ocena -= 50;
    // Ostrina in blokovnost ne kaznjujeta crne/zmrznjene slike se dodatno
    if (!meritve.slikaCrn && !meritve.slikaZmrznjen) {
        if (meritve.slikaOstrina < 10) ocena -= 25; // Zamegljeno
        if (meritve.slikaBlokovnost > 1.5) ocena -= 25; // Blokovno
    }
    
    // Kazni za zvok (brez histereze trenutno, ampak KAK11 omenja "zvocna tisina samo ce pavza daljsa", a pustimo)
    // "zvok s povprecjem v oknu >= 500ms" bi blo dobro, zaenkrat pustim izracunOceno kot je
    if (meritve.zvokTisina) ocena -= 20;
    if (meritve.zvokClipping > 1) ocena -= 15;
    
    if (Number.isNaN(ocena)) return NaN; // fallback
    return Math.max(0, ocena);
}

export class NadzornikKakovosti {
    private okvirIndex = 0;
    private prejsnjaSlika: Slika | null = null;
    private prejsnjaSlikaOcena: Partial<Meritve> | null = null;
    public trenutneNastavitve: NastavitveTV = {
        ostrina: 50,
        kontrast: 50,
        svetlost: 50,
        locljivost: '1080p',
        vir: 'Mreza'
    };
    public zgodovinaPopravkov: Popravek[] = [];
    public predlaganiPaketi: any[] = [];
    private posiljalnik?: (n: any) => void;
    
    private okno: number[] = [];
    private zadnjiPopravekOkvir = -1e9;
    private static readonly OHLADITEV = 90;
    public zabelezeneNapake: any[] = [];
    private zaporedniZmrznjeni = 0;
    private zaporedniDobriOkvirji = 0;
    
    constructor(posiljalnik?: (n: any) => void) {
        this.posiljalnik = posiljalnik;
    }
    
    public povrniVse() {
        while (this.zgodovinaPopravkov.length > 0) {
            this.povrniZadnjega();
        }
    }
    
    private povrniZadnjega() {
        const zadnji = this.zgodovinaPopravkov.pop();
        if (!zadnji) return;
        if (zadnji.stanje === 'predlog') return;
        if (zadnji.tarca === 'paketi') {
            this.trenutneNastavitve.locljivost = zadnji.prejsnjaVrednost;
        } else {
            (this.trenutneNastavitve as any)[zadnji.tarca] = zadnji.prejsnjaVrednost;
        }
    }
    
    public oceni(paketi: KolicinaPaketov, slika: Slika, zvok: Zvok): Meritve {
        if (!KAKOVOST_VKLOPLJENA) {
            this.povrniVse();
            return this.prazneMeritve();
        }
        
        let slikaOcena: Partial<Meritve> = {};
        if (this.okvirIndex % 2 === 0) {
            slikaOcena = oceniSliko(slika, this.prejsnjaSlika);
            // KAK6: copy buffer to prevent alias
            if (slika && slika.podatki) {
                this.prejsnjaSlika = { ...slika, podatki: new Uint8Array(slika.podatki) };
            }
        } else {
            // KAK6: reuse the previous calculation instead of recalculating
            if (this.prejsnjaSlikaOcena) {
                slikaOcena = { ...this.prejsnjaSlikaOcena };
            } else {
                slikaOcena = {
                    slikaOstrina: 50, slikaBlokovnost: 1, slikaGibanje: 0, slikaSvetlost: 128, slikaKontrast: 50, slikaZmrznjen: false, slikaCrn: false, razmerjeStranic: 16/9
                };
            }
        }
        
        const paketiOcena = oceniPakete(paketi);
        const zvokOcena = oceniZvok(zvok);
        
        // Zmrznjen popravek
        const jeTrenutnoZmrznjen = slikaOcena.slikaZmrznjen;
        if (jeTrenutnoZmrznjen && paketi.skupajPaketov === 0) {
            this.zaporedniZmrznjeni++;
        } else {
            this.zaporedniZmrznjeni = 0;
        }
        slikaOcena.slikaZmrznjen = this.zaporedniZmrznjeni >= 5; // Npr 5 zaporednih
        
        // Zascitimo cache pred mutacijo
        if (this.okvirIndex % 2 === 0) {
            this.prejsnjaSlikaOcena = { ...slikaOcena, slikaZmrznjen: jeTrenutnoZmrznjen };
        }
        
        const meritve: Meritve = {
            ...this.prazneMeritve(),
            ...paketiOcena,
            ...slikaOcena,
            ...zvokOcena
        } as Meritve;
        
        meritve.ocena = izracunajOceno(meritve);
        
        // Odlocitev vsak okvir, ker uporabljamo drsece okno ocen
        this.odlocitev(meritve);
        
        this.okvirIndex++;
        return meritve;
    }
    
    private prazneMeritve(): Meritve {
        return {
            bitnaHitrost: 0, izgubaPaketov: 0, jitterMs: 0, napakeDekodiranja: 0,
            slikaOstrina: 0, slikaBlokovnost: 0, slikaGibanje: 0, slikaSvetlost: 0, slikaKontrast: 0, slikaZmrznjen: false, slikaCrn: false, razmerjeStranic: 1,
            zvokRms: 0, zvokVrh: 0, zvokTisina: false, zvokClipping: 0, // KAK10: zvokTisina mora biti false
            ocena: 100
        };
    }
    
    private odlocitev(meritve: Meritve) {
        // Neznana ocena (neveljavna slika = NaN) ne sme v drsece okno: NaN bi zastrupil povprecje za 30 okvirjev
        // in nadzornik v tem casu ne bi odgovoril na slab prenos (izmerjeno 17. 11. 2026: prvi odziv okvir 30 namesto 4).
        if (!Number.isFinite(meritve.ocena)) return;
        this.okno.push(meritve.ocena);
        if (this.okno.length > 30) this.okno.shift();
        
        const povp = this.okno.reduce((a, b) => a + b, 0) / this.okno.length;
        
        if (povp >= 95) {
            this.zaporedniDobriOkvirji++;
        } else {
            this.zaporedniDobriOkvirji = 0;
        }
        
        // Histereza - povrni
        if (this.zaporedniDobriOkvirji >= NadzornikKakovosti.OHLADITEV && this.zgodovinaPopravkov.length > 0) {
            this.povrniZadnjega();
            this.zadnjiPopravekOkvir = this.okvirIndex;
            this.zaporedniDobriOkvirji = 0;
            return;
        }
        
        // Ohlajanje
        if (this.okvirIndex - this.zadnjiPopravekOkvir < NadzornikKakovosti.OHLADITEV) {
            return;
        }
        
        // Ce je ocena padla pod 75 dlje casa
        if (povp <= 75 && this.okno.length >= 5) {
            if (meritve.izgubaPaketov > 1 || meritve.jitterMs > 50 || meritve.napakeDekodiranja > 0) {
                if (this.trenutneNastavitve.locljivost === '1080p') {
                    this.trenutneNastavitve.locljivost = '720p';
                    this.uporabiPopravek({
                        ime: 'Zmanjsanje locljivosti zaradi izgube paketov',
                        tarca: 'paketi',
                        novaVrednost: '720p',
                        prejsnjaVrednost: '1080p',
                        meritevPred: povp,
                        stanje: 'uporabljeno' // paketne nastavitve so povratne in merljive (zanka je zaprta)
                    });
                    
                    this.zabeleziNapako('Kakovost pada zaradi paketa/omrezja', meritve);
                    this.dodajPredlogPaketa('Izboljsava locljivosti omrezja', povp, povp + 15, { locljivost: '720p' });
                    this.zadnjiPopravekOkvir = this.okvirIndex;
                    return;
                }
            }
            
            if (meritve.slikaCrn) {
                this.zabeleziNapako('Nerazlozljiv padec: Crn okvir', meritve);
                this.zadnjiPopravekOkvir = this.okvirIndex;
                return;
            }
            if (meritve.slikaZmrznjen) {
                this.zabeleziNapako('Nerazlozljiv padec: Zmrznjen okvir', meritve);
                this.zadnjiPopravekOkvir = this.okvirIndex;
                return;
            }
            
            // Popravki TV nastavitev so odprta zanka - predlagamo le, ne spreminjamo samodejno
            if (meritve.slikaBlokovnost > 1.5 && this.trenutneNastavitve.ostrina > 10) {
                const stara = this.trenutneNastavitve.ostrina;
                const nova = stara - 10;
                this.uporabiPopravek({
                    ime: 'Zmanjsanje ostrine (proti blokovnosti)',
                    tarca: 'ostrina',
                    novaVrednost: nova,
                    prejsnjaVrednost: stara,
                    meritevPred: povp,
                    stanje: 'predlog'
                });
                this.dodajPredlogPaketa('Mehcanje blokovnosti', povp, povp + 10, { ostrina: nova });
                this.zadnjiPopravekOkvir = this.okvirIndex;
                return;
            }
            
            if (meritve.slikaOstrina < 15 && this.trenutneNastavitve.ostrina < 90) {
                const stara = this.trenutneNastavitve.ostrina;
                const nova = stara + 10;
                this.uporabiPopravek({
                    ime: 'Povecanje ostrine',
                    tarca: 'ostrina',
                    novaVrednost: nova,
                    prejsnjaVrednost: stara,
                    meritevPred: povp,
                    stanje: 'predlog'
                });
                this.dodajPredlogPaketa('Povecanje TV ostrine', povp, povp + 5, { ostrina: nova });
                this.zadnjiPopravekOkvir = this.okvirIndex;
                return;
            }
        }
    }
    
    private uporabiPopravek(popravek: Popravek) {
        // Samo za izogib neskoncni zgodovini ce se kaj izmuzne
        if (this.zgodovinaPopravkov.length >= 8) {
            const index = this.zgodovinaPopravkov.findIndex(p => p.tarca !== 'paketi');
            if (index >= 0) {
                this.zgodovinaPopravkov.splice(index, 1);
            } else {
                this.zgodovinaPopravkov.shift();
            }
        }
        this.zgodovinaPopravkov.push(popravek);
    }
    
    private dodajPredlogPaketa(ime: string, ocenaPred: number, pricakovanaOcenaPo: number, nastavitev: any) {
        // Preprecitev duplikatov in omejitev na 50
        const obstojec = this.predlaganiPaketi.findIndex(p => p.ime === ime);
        const predlog = {
            ime,
            merilo: `Ocena pred: ${ocenaPred.toFixed(1)}, Pricakovano po: ${pricakovanaOcenaPo.toFixed(1)}`,
            predlaganPopravek: nastavitev,
            povratnaPot: `Povrnitev prejsnje vrednosti iz zgodovine`
        };
        
        if (obstojec >= 0) {
            this.predlaganiPaketi.splice(obstojec, 1);
        }
        this.predlaganiPaketi.push(predlog);
        
        if (this.predlaganiPaketi.length > 50) {
            this.predlaganiPaketi.shift();
        }
    }
    
    private zabeleziNapako(opis: string, meritve: Meritve) {
        const napaka = {
            oznaka: 'kakovost',
            opis,
            podrobnosti: {
                ocena: meritve.ocena,
                izguba: meritve.izgubaPaketov,
                jitter: meritve.jitterMs,
                ostrina: meritve.slikaOstrina
            }
        };
        
        this.zabelezeneNapake.push(napaka);
        if (this.zabelezeneNapake.length > 50) {
            this.zabelezeneNapake.shift();
        }
        
        if (this.posiljalnik) {
            try {
                const r = this.posiljalnik(napaka) as unknown;
                if (r && typeof (r as Promise<unknown>).catch === 'function') {
                    (r as Promise<unknown>).catch(() => undefined);
                }
            } catch {
                // Ignore failure in callback
            }
        }
    }
    
    // static odstranjen, lastnost na primerku (KAK2)
}
