import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as crypto from "node:crypto";
import * as tls from "node:tls";
import { registerUpgrade } from "./upgrade-router.js";
import { MEDIA_FORMAT, MEDIA_FRAME_BYTES, DEVICE_MEDIA_MAX_PAYLOAD } from "./media-relay.js";

export interface LinaSprejemnikOpcije {
  /** Skrivnost povezave, najmanj 32 bajtov (pregled 15, N5: prazen zeton je sprejel vsak "Bearer "). */
  zeton: string;
  /** Samo za preizkuse na 127.0.0.1: dovoli streznik brez TLS. V izdelku zvok klica in zeton nikoli nesifrirano (N4). */
  nesifriranoSamoZaPreizkus?: boolean;
  /** Samo za preizkuse: ura v ms (ena prebrana vrednost na sporocilo). */
  ura?: () => number;
}

export const NAJKRAJSI_ZETON_BAJTOV = 32;
const NAJVEC_CAKAJOCIH_BAJTOV = 64 * 1024;
/**
 * Pregled 16 (N2): po zastoju Wi-Fi telefon poslje zaostale okvirje naenkrat (izmerjeno lokalno: 150 okvirjev = 3 s zvoka
 * je zaprlo povezavo pri zalogi 100). Zaloga je zato 10 s zvoka (50 okvirjev/s), polni se s 60/s; odvec okvirji se
 * zavrzejo in stejejo, povezava se zapre sele, ko prekoracitev traja TRAJNA_PREKORACITEV_MS.
 */
export const ZALOGA_OKVIRJEV = 500;
const POLNJENJE_NA_SEKUNDO = 60;
export const TRAJNA_PREKORACITEV_MS = 10_000;

export interface StatistikaSprejemnika {
  sprejetiOkvirji: number;
  zavrnjeniOkvirji: number;
  /** Okvirji, zavrzeni zaradi hitrosti (povezava ostane odprta). */
  zavrzeniOkvirji: number;
  povezave: number;
}

export function ustvariLinaSprejemnik(opcije: LinaSprejemnikOpcije) {
  if (typeof opcije.zeton !== "string" || Buffer.byteLength(opcije.zeton, "utf8") < NAJKRAJSI_ZETON_BAJTOV) {
    throw new Error(`Zeton sprejemnika mora imeti vsaj ${NAJKRAJSI_ZETON_BAJTOV} bajtov`);
  }
  const server = new WebSocketServer({ noServer: true, maxPayload: DEVICE_MEDIA_MAX_PAYLOAD });
  let aktivnaPovezava: WebSocket | undefined = undefined;

  let sprejetiOkvirji = 0;
  let zavrnjeniOkvirji = 0;
  let zavrzeniOkvirji = 0;
  let povezave = 0;
  const ura = opcije.ura ?? Date.now;

  function zavrni(socket: Duplex, koda: number, razlog: string) {
    if (socket.writable) {
      socket.write(`HTTP/1.1 ${koda} ${razlog}\r\nConnection: close\r\n\r\n`);
    }
    socket.destroy();
  }

  function preveriZeton(zahteva: IncomingMessage, url: URL): boolean {
    if (url.searchParams.has("token")) {
      return false;
    }
    const auth = zahteva.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return false;
    }
    const poslanZeton = auth.substring(7);
    const hashPoslan = crypto.createHash("sha256").update(poslanZeton).digest();
    const hashPravi = crypto.createHash("sha256").update(opcije.zeton).digest();
    
    if (hashPoslan.length !== hashPravi.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashPoslan, hashPravi);
  }

  function attach(httpServer: HttpServer) {
    if (!(httpServer instanceof tls.Server) && !opcije.nesifriranoSamoZaPreizkus) {
      throw new Error("Sprejemnik zvoka klica zahteva streznik TLS (https/wss)");
    }
    // Skupni usmerjevalnik (N8): pot doloci usmerjevalnik s fiksno osnovo (N7), tuja pot dobi 404 tam.
    registerUpgrade(httpServer, (pathname) => pathname === "/api/voice/stream", (request, socket, head, url) => {
      try {
        if (url.searchParams.has("token")) {
          zavrni(socket, 401, "Unauthorized");
          return;
        }

        if (!preveriZeton(request, url)) {
          zavrni(socket, 401, "Unauthorized");
          return;
        }

        server.handleUpgrade(request, socket, head, (ws) => {
          // Nova overjena povezava zamenja staro (N6): po prekinitvi Wi-Fi je stara se "odprta" in bi telefon
          // zavrnili (429) do 10 s - del zvoka klica bi se izgubil. En klic = ena povezava ostane.
          const prejsnja = aktivnaPovezava;
          aktivnaPovezava = ws;
          if (prejsnja && prejsnja.readyState === WebSocket.OPEN) prejsnja.close(1012, "Nadomescena");
          povezave++;

          let zaloga = ZALOGA_OKVIRJEV;
          let zadnjaOsvezitev = ura();
          let prekoracitevOd: number | undefined;
          let casovnikMirovanja: NodeJS.Timeout;
          let casovnikTrajanja: NodeJS.Timeout;

          function pocistiCasovnike() {
            clearTimeout(casovnikMirovanja);
            clearTimeout(casovnikTrajanja);
          }

          function osveziMirovanje() {
            clearTimeout(casovnikMirovanja);
            casovnikMirovanja = setTimeout(() => {
              ws.close(1001, "Mirovanje");
            }, 10000);
          }

          /** "sprejmi", "zavrzi" (odvec, povezava ostane) ali "zapri" (prekoracitev traja). */
          function preveriHitrost(): "sprejmi" | "zavrzi" | "zapri" {
            const zdaj = ura();
            const preteklo = Math.max(0, (zdaj - zadnjaOsvezitev) / 1000);
            zaloga = Math.min(ZALOGA_OKVIRJEV, zaloga + preteklo * POLNJENJE_NA_SEKUNDO);
            zadnjaOsvezitev = zdaj;
            // Posiljatelj je spet pod mejo (zaloga se je napolnila do polovice): prekoracitev je koncana.
            if (zaloga >= ZALOGA_OKVIRJEV / 2) prekoracitevOd = undefined;
            if (zaloga >= 1) {
              zaloga -= 1;
              return "sprejmi";
            }
            prekoracitevOd ??= zdaj;
            return zdaj - prekoracitevOd >= TRAJNA_PREKORACITEV_MS ? "zapri" : "zavrzi";
          }

          ws.send(JSON.stringify({ type: "start", format: MEDIA_FORMAT }));

          casovnikTrajanja = setTimeout(() => {
            ws.close(1000, "Konec casa");
          }, 15 * 60 * 1000);

          osveziMirovanje();

          ws.on("message", (data: RawData, isBinary: boolean) => {
            // Po zacetku zapiranja ne obdelujemo vec: sporocila na poti ne stejejo in ne sprozijo drugega zapiranja.
            if (ws.readyState !== WebSocket.OPEN) return;

            const hitrost = preveriHitrost();
            if (hitrost === "zapri") {
              zavrnjeniOkvirji++;
              ws.close(1008, "Prehitro");
              return;
            }
            if (hitrost === "zavrzi") {
              zavrzeniOkvirji++;
              return;
            }

            if (isBinary) {
              const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
              if (buf.length !== MEDIA_FRAME_BYTES) {
                zavrnjeniOkvirji++;
                ws.close(1008, "Napacna velikost");
                return;
              }
              sprejetiOkvirji++;
              // Mirovanje osvezi samo zvok (N6): besedilni "clear" ne drzi linije zasedene.
              osveziMirovanje();
            } else {
              try {
                const text = data.toString();
                const obj = JSON.parse(text);
                if (obj && obj.type === "clear") {
                  // Odjemalec, ki ne bere, ne sme polniti pomnilnika streznika (N9).
                  if (ws.bufferedAmount > NAJVEC_CAKAJOCIH_BAJTOV) { ws.close(1008, "Odjemalec ne bere"); return; }
                  ws.send(JSON.stringify({ type: "cleared" }));
                } else {
                  ws.close(1008, "Neveljavno besedilno sporocilo");
                }
              } catch {
                ws.close(1008, "Neveljaven JSON");
              }
            }
          });

          ws.on("close", () => {
            pocistiCasovnike();
            if (aktivnaPovezava === ws) {
              aktivnaPovezava = undefined;
            }
          });

          ws.on("error", () => {
            pocistiCasovnike();
          });
        });
      } catch (err) {
        zavrni(socket, 500, "Internal Server Error");
      }
    });
  }

  return {
    attach,
    statistika: (): StatistikaSprejemnika => ({ sprejetiOkvirji, zavrnjeniOkvirji, zavrzeniOkvirji, povezave }),
  };
}
