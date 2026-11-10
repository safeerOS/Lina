/**
 * Preverjanja ob zagonu procesa. Testi kličejo createGatewayServer neposredno
 * in teh omejitev ne zadenejo; index.ts pa jih mora.
 */

const PLACEHOLDER = "change-me";
const MIN_API_KEY = 32;

export function apiKeyProblem(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  if (!key) return "HTTP_GATEWAY_API_KEY is required";
  if (key === PLACEHOLDER) return 'HTTP_GATEWAY_API_KEY must not be "change-me"';
  if (key.length < MIN_API_KEY) return `HTTP_GATEWAY_API_KEY must be at least ${MIN_API_KEY} characters`;
  return null;
}

/** Nikoli ne izklopimo preverjanja TLS za cel proces. */
export function tlsEnvProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return "NODE_TLS_REJECT_UNAUTHORIZED=0 ni dovoljen";
  }
  return null;
}
