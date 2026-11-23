// Kanal Line za Claude Code (MCP prek stdio). Zazene ga Claude Code iz .mcp.json, ne uporabnik:
//   claude --dangerously-load-development-channels server:lina
// Mapa podatkov Line: LINA_DATA (nastavi jo vnos v .mcp.json, ki ga pripravi Lina).
import { zazeniKanal } from "../src/lib/lina/kanal-claude.server.ts";

await zazeniKanal();
