/** Zadnji dve stevki. Cela stevilka ne sme v dnevnik. */
export function redactPhone(number: string | null | undefined): string {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 2) return "neznana";
  return `**${digits.slice(-2)}`;
}

export function takeoverDenied(number: string | null | undefined, why: "seznamu" | "dovoljena"): string {
  const tail = redactPhone(number);
  return why === "seznamu"
    ? `prevzem zavrnjen, ${tail} ni na seznamu`
    : `prevzem zavrnjen, ${tail} ni dovoljena`;
}
