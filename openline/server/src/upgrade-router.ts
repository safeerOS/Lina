import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * En poslusalec "upgrade" na streznik (pregled 15, N8). Prej je vsak modul (kanal naprave, zvok, sprejemnik
 * Line) dodal svojega in za tujo pot samo "return": zahteva za neznano pot ni dobila odgovora, vticnica je
 * visela odprta (napadalec jih lahko odpre poljubno mnogo). Zdaj pot, ki je noben modul ne prijavi, dobi 404,
 * napacen zapis poti 400, napaka v obdelavi 500 - vticnica se vedno zapre.
 */
export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer, url: URL) => void;

interface Route {
  readonly matches: (pathname: string) => boolean;
  readonly handle: UpgradeHandler;
}

const routesByServer = new WeakMap<HttpServer, Route[]>();

export function rejectUpgrade(socket: Duplex, code: number, reason: string): void {
  if (socket.writable) socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Pot zahteve s fiksno osnovo (N7): glava Host je odjemalceva in ne vpliva na pot. Zapis "//gostitelj/pot"
 * bi URL razbral kot drug gostitelj, zato velja samo pot, ki se zacne z eno posevnico.
 */
export function upgradeUrl(request: IncomingMessage): URL | undefined {
  const raw = request.url ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  try {
    return new URL(raw, "http://localhost");
  } catch {
    return undefined;
  }
}

export function registerUpgrade(
  httpServer: HttpServer,
  matches: (pathname: string) => boolean,
  handle: UpgradeHandler,
): void {
  let routes = routesByServer.get(httpServer);
  if (!routes) {
    const list: Route[] = [];
    routes = list;
    routesByServer.set(httpServer, list);
    httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = upgradeUrl(request);
      if (!url) {
        rejectUpgrade(socket, 400, "Bad Request");
        return;
      }
      const route = list.find((r) => r.matches(url.pathname));
      if (!route) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      try {
        route.handle(request, socket, head, url);
      } catch {
        rejectUpgrade(socket, 500, "Internal Server Error");
      }
    });
  }
  routes.push({ matches, handle });
}
