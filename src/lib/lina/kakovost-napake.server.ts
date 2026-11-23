import { sprejmiNotranjo, cistiOsebnePodatke, vVrsti } from "./napake.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { KAKOVOST_VKLOPLJENA } from "./kakovost.ts";

export async function zabeleziKakovostnoNapako(vnos: string, dir?: string): Promise<boolean> {
    if (!KAKOVOST_VKLOPLJENA) return false;
    try {
        const body = {
            naprava: "Lina Kakovost",
            cas: new Date().toISOString(),
            vrsta: "kakovost",
            proces: "kakovost",
            izjema: vnos
        };
        return await sprejmiNotranjo(body, dir);
    } catch {
        return false;
    }
}

function cistiObject(obj: any, seen = new Map()): any {
    if (typeof obj === 'string') return cistiOsebnePodatke(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (obj && obj.buffer && obj.buffer instanceof ArrayBuffer) return Array.from(obj as any);
    if (Array.isArray(obj)) {
        if (seen.has(obj)) return [];
        seen.set(obj, true);
        const res = obj.map(x => cistiObject(x, seen));
        seen.delete(obj);
        return res;
    }
    if (typeof obj === 'object' && obj !== null) {
        if (seen.has(obj)) return {};
        seen.set(obj, true);
        const res: any = {};
        for (const [k, v] of Object.entries(obj)) {
            res[k] = cistiObject(v, seen);
        }
        seen.delete(obj);
        return res;
    }
    return obj;
}

export function objaviPredloge(predlogi: any[], dir?: string): Promise<void> {
    if (!KAKOVOST_VKLOPLJENA) return Promise.resolve();
    return vVrsti(async () => {
        const root = resolveDataDir(dir);
        const cleaned = cistiObject(predlogi);
        
        let current = await readJsonFile<any[]>(root, "kakovost-predlogi.json", { premakniPokvarjen: true });
        if (!current || !Array.isArray(current)) {
            current = [];
        }
        
        for (const p of cleaned) {
            if (p && typeof p === 'object' && p.ime) {
                const pIme = String(p.ime);
                const idx = current.findIndex(x => x && typeof x === 'object' && String(x.ime) === pIme);
                if (idx >= 0) {
                    current[idx] = p;
                    continue;
                }
            }
            current.push(p);
        }
        
        if (current.length > 50) {
            current = current.slice(current.length - 50);
        }
        
        await writeJson(root, "kakovost-predlogi.json", current);
    });
}
