/**
 * Krajsanje tisin ob pripravi posnetka (lastnik 14. 11. 2026, klic K7): zacetek ~30 ms, konec ~100 ms, notranji premor > 350 ms na ~250 ms,
 * krajsi premori ostanejo, prelivi brez klikov, idempotentno; tudi ze pripravljen stalni posnetek dobi krajsanje brez nove sinteze. Brez omrezja.
 */
import assert from "node:assert/strict";
