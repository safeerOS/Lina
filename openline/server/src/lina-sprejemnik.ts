import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as crypto from "node:crypto";
import { MEDIA_FORMAT, MEDIA_FRAME_BYTES, DEVICE_MEDIA_MAX_PAYLOAD } from "./media-relay.js";

export interface LinaSprejemnikOpcije {
  zeton: string;
}

export interface StatistikaSprejemnika {
  sprejetiOkvirji: number;
  zavrnjeniOkvirji: number;
  povezave: number;
}

export function ustvariLinaSprejemnik(opcije: LinaSprejemnikOpcije) {
  const server = new WebSocketServer({ noServer: true, maxPayload: DEVICE_MEDIA_MAX_PAYLOAD });
  let aktivnaPovezava: WebSocket | undefined = undefined;

  let sprejetiOkvirji = 0;
  let zavrnjeniOkvirji = 0;
  let povezave = 0;

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
    httpServer.on("upgrade", (request, socket, head) => {
      try {
        const host = request.headers.host || "localhost";
        const url = new URL(request.url || "/", `http://${host}`);

        if (url.pathname !== "/api/voice/stream") {
          return;
        }

        if (url.searchParams.has("token")) {
          zavrni(socket, 401, "Unauthorized");
          return;
        }

        if (!preveriZeton(request, url)) {
          zavrni(socket, 401, "Unauthorized");
          return;
        }

        if (aktivnaPovezava && aktivnaPovezava.readyState === WebSocket.OPEN) {
          zavrni(socket, 429, "Too Many Requests");
          return;
        }

        server.handleUpgrade(request, socket, head, (ws) => {
          aktivnaPovezava = ws;
          povezave++;

          let zaloga = 100;
          let zadnjaOsvezitev = Date.now();
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

          function preveriHitrost(): boolean {
            const zdaj = Date.now();
            const preteklo = (zdaj - zadnjaOsvezitev) / 1000;
            zaloga = Math.min(100, zaloga + preteklo * 60);
            zadnjaOsvezitev = zdaj;

            if (zaloga >= 1) {
              zaloga -= 1;
              return true;
            }
            return false;
          }

          ws.send(JSON.stringify({ type: "start", format: MEDIA_FORMAT }));

          casovnikTrajanja = setTimeout(() => {
            ws.close(1000, "Konec casa");
          }, 15 * 60 * 1000);

          osveziMirovanje();

          ws.on("message", (data: RawData, isBinary: boolean) => {
            osveziMirovanje();

            if (!preveriHitrost()) {
              zavrnjeniOkvirji++;
              ws.close(1008, "Prehitro");
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
            } else {
              try {
                const text = data.toString();
                const obj = JSON.parse(text);
                if (obj && obj.type === "clear") {
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
    statistika: (): StatistikaSprejemnika => ({ sprejetiOkvirji, zavrnjeniOkvirji, povezave }),
  };
}
