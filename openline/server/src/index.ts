import { bindHost } from "./lan.js";
import { stripSecretQuery, isAllowedLanUrl } from "./lan-url.js";
import { linaStreamConfig } from "./lina.js";
import { createGatewayServer } from "./server.js";
import { parseAllowlist, parseAllowlistMode } from "./allowlist.js";
import { apiKeyProblem, tlsEnvProblem } from "./startup-check.js";
import { loadOrCreateTls } from "./tls.js";

const tlsProblem = tlsEnvProblem();
if (tlsProblem) {
  console.error(tlsProblem);
  process.exit(1);
}

const apiKey = process.env.HTTP_GATEWAY_API_KEY;
const keyProblem = apiKeyProblem(apiKey);
if (keyProblem || !apiKey) {
  console.error(keyProblem ?? "HTTP_GATEWAY_API_KEY is required");
  process.exit(1);
}

const port = parsePort(process.env.PORT ?? "8787");
// Privzeto samo 127.0.0.1. 0.0.0.0 ni dovoljen. Izrecni HOST sme biti samo zasebni naslov.
let host: string;
try {
  host = bindHost(process.env.HOST);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? "data";
const tls = loadOrCreateTls(dataDir, host);
const lina = linaStreamConfig();
const allowlist = parseAllowlist(process.env.LINA_ALLOWLIST);
const allowlistMode = parseAllowlistMode(process.env.LINA_ALLOWLIST_MODE);
const publicUrl = (process.env.PUBLIC_URL?.trim() || `https://${host}:${port}`).replace(/\/+$/, "");
const incomingOverride = process.env.INCOMING_STREAM_URL?.trim();
const incomingStreamUrl = incomingOverride
  ? stripSecretQuery(incomingOverride)
  : lina?.url;
if (incomingStreamUrl && !isAllowedLanUrl(incomingStreamUrl, ["wss:"])) {
  console.error("INCOMING_STREAM_URL mora biti wss na zasebnem naslovu ali localhost");
  process.exit(1);
}
const webhook = process.env.WEBHOOK_URL?.trim();
if (webhook && !isAllowedLanUrl(webhook, ["https:"])) {
  console.error("WEBHOOK_URL mora biti https na zasebnem naslovu ali localhost");
  process.exit(1);
}

const gateway = createGatewayServer({
  apiKey,
  webhookSecret: process.env.WEBHOOK_SECRET,
  defaultWebhookUrl: webhook,
  geminiApiKey: process.env.GEMINI_API_KEY,
  agentModel: process.env.GEMINI_LIVE_MODEL,
  agentOwnerName: process.env.AGENT_OWNER_NAME,
  dataDir,
  publicUrl,
  docsUrl: process.env.DOCS_URL,
  incomingStreamUrl,
  linaStreamToken: lina?.token,
  linaOrigin: lina ? new URL(lina.url).origin : undefined,
  linaCertSha256: process.env.LINA_CERT_SHA256?.trim(),
  allowlist,
  allowlistMode,
  tls: { cert: tls.cert, key: tls.key },
  certFingerprint: tls.fingerprint256,
});

gateway.listen(port, host).then(() => {
  console.log(`OpenLine slusa na ${publicUrl}`);
  console.log(`Odtis certifikata SHA-256: ${tls.fingerprintColon}`);
  if (!lina) {
    console.log("LINA_STREAM_TOKEN ni nastavljen: dohodni klici se ne posredujejo Lini.");
  } else if (!process.env.LINA_CERT_SHA256?.trim()) {
    console.log("LINA_CERT_SHA256 manjka: povezava na Lino se ne odpre brez odtisa.");
  } else if (!process.env.INCOMING_STREAM_URL?.trim()) {
    console.log("Dohodni zvok gre na Lino (wss://127.0.0.1:8080/api/voice/stream). Zeton je v glavi, ne v naslovu.");
  }
  if (allowlistMode === "off") {
    console.log("LINA_ALLOWLIST_MODE=off: Lina prevzame vse dohodne, tudi neznane. Stevilke v sili ne.");
  } else if (allowlist.length === 0) {
    console.log("Seznam dovoljenih je prazen: noben dohodni klic se ne prevzame.");
  } else {
    console.log(`Seznam dovoljenih: ${allowlist.length} stevilk.`);
  }
  console.log("Gemini je izklopljen.");
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`invalid PORT: ${value}`);
  }
  return parsed;
}
