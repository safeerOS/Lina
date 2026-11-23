/**
 * Lina M2 popravki (slepi pregled 2, 15. 11. 2026): F10 - jeSkrivnost je zgresila obhode (PIN z besedo, razmaknjene stevke, p1n, geslo brez
 * veznika, kartica, locena z besedo, zetoni 24-31 znakov, nemsko geslo, EMSO, crkovano geslo) in ni smela zavrniti naravnih dejstev.
 * Vsi vzorci so izmisljeni (EMSO je z izracunano kontrolno stevko, ne prava).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jeSkrivnost, preveriDejstvo } from "./spomin.ts";

function emsoZ(prvih12: string): string {
  const teze = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const vsota = teze.reduce((a, t, i) => a + t * Number(prvih12[i]), 0);
  let k = 11 - (vsota % 11);
  if (k === 11) k = 0;
  return prvih12 + String(k);
}

const NARAVNA = `Direktor ob ponedeljkih dopoldne nima sestankov.
Kodo za vhod v delavnico dobi vsak obiskovalec pri recepciji.
Ob petkih popoldne sem na terenu pri strankah.
Moja hči ima rojstni dan 12. decembra, takrat sem prost.
Telefonska številka tajnice je na vizitki.
Pokličite me po 17. uri na mobilni telefon.
Sestanki so vsak torek ob 9.00 v sejni sobi 3.
Parkirišče za goste je za stavbo, vhod z desne strani.
Račune plačujemo do 15. v mesecu.
Letni dopust imam od 1. do 15. avgusta.
Stranke z imenom Kovač vedno povabim na kavo.
Podjetje ima 14 zaposlenih in dve poslovalnici.
Naša številka TRR je napisana na vsakem računu.
Za nujne primere pokličite sodelavca Petra.
Pošiljke prevzemamo do 14.00.
Kosilo imam vedno med 12.00 in 12.30.
Za stranke iz Maribora imam prosto sredo.
Geslo za wifi je napisano na hladilniku v kuhinji.
Vsako prvo sredo v mesecu sem na izobraževanju.
Pri nakupu nad 10 kosov odobrim popust po dogovoru.
V delavnici imamo 5 strojev za rezanje in 2 za brušenje.
Pinceta za les je v predalu pri vhodu.
Za ogled delavnice se najavite en dan prej.
Leta 2019 smo prejeli nagrado za najboljši izdelek.
Pošta pride vsak dan ob 10.15.
Tajnica Ana dela od 7.00 do 15.00.
Alarm vklopimo ob 18.00, zato obiski po tej uri niso mogoči.
Za reklamacije pišite na naslov, ki je na naši strani.
Telefonska linija 080 12 34 je brezplačna.
Direktor govori slovensko, angleško in nemško.
Pišite mi raje po elektronski pošti kot po telefonu.
Ob nedeljah ne delamo.
Ključ od skladišča je pri vratarju.
Prodajalna je na Cesti 4. maja 12 v Celju.
Pošiljamo tudi v Avstrijo in Italijo.
Naročnik pogosto pokliče ob 8.00, takrat sem vedno dosegljiv.
Stranka Novak ima naročilo številka 4471 v izdelavi.
Rok za oddajo ponudb je 30. novembra.
Moj telefon je pogosto izklopljen med 13.00 in 14.00.
Ponudbe pošiljam v PDF obliki.
Šola, ki jo obiskuje sin, je v Ljubljani.
Skladišče je odprto od 6.00 do 14.00.
Za sestanek rezerviram sejno sobo 2.
Kava je v kuhinji ob vhodu.
Za plačilo s kartico imamo terminal pri blagajni.
Šifra artikla za hrastovo mizo je HM-2201.
Dostavni rok za omare je običajno šest tednov.
Vsak mesec prvi petek imamo ekipni zajtrk.
Davčna številka podjetja je napisana v nogi vsakega računa.
Pri dostavi nad 50 kilometrov zaračunamo kilometrino.
Moj prednik je ustanovil podjetje leta 1987.
Spletna stran je www.mizarstvo-les-ljubljana-2019.si/izdelki/hrastove-mize.
Pokličite 041 555 666 ali 031 222 333, če sem zunaj.
Pin za zaščito prsta je v predalu.
Koda artikla je napisana na embalaži, pišite nam, če je ne najdete.`.split("\n");

describe("M2 popravki F10: obhodi jeSkrivnost so ujeti", () => {
  const SKRIVNOSTI: [string, string][] = [
    ["pin z besedo", "PIN kartice 4821"],
    ["pin crkovan s stevkami", "PIN je 4 8 2 1"],
    ["pin leet z dvema crkama", "p1n je 4821"],
    ["geslo brez veznika s stevilko", "wifi geslo mojamacka123"],
    ["geslo za wifi doma", "Doma je wifi geslo Zima2026"],
    ["kartica locena z besedo", "Kartica 4111 1111 pa 1111 1111"],
    ["zeton 24 znakov", "token abcd1234efgh5678ijkl9012"],
    ["niz 31 znakov", "Koda: " + "ab1".repeat(10) + "x"],
    ["nemsko geslo", "Passwort ist hunter22"],
    ["crkovano geslo", "geslo je a b c 1 2 3"],
    ["EMSO z veljavno kontrolno stevko", "EMSO " + emsoZ("010199050012")],
    ["EMSO brez besede", "Moja enotna maticna je " + emsoZ("150685500123")],
    ["EMSO z besedo, kontrolna stevka napacna", "EMSO 0101990500123"],
  ];
  for (const [ime, f] of SKRIVNOSTI) {
    it(`ujeto: ${ime}`, () => {
      assert.equal(jeSkrivnost(f), true, f);
      assert.deepEqual(preveriDejstvo(f), { ok: false, razlog: "skrivnost" });
    });
  }
  it(`${NARAVNA.length} naravnih dejstev ni zavrnjenih kot skrivnost`, () => {
    const lazno = NARAVNA.filter((f) => jeSkrivnost(f));
    assert.deepEqual(lazno, []);
  });
});
