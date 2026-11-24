import { useEffect, useState } from "react";
import { Razdelek } from "@/components/ui-lina.tsx";
import { t } from "@/lib/lina/besedila.ts";
import { nastaviNacrtDiagramFn, stanjeAgentPomociFn } from "@/lib/lina/functions.ts";

/**
 * Nastavitve > Agenti (lastnik 24. 11. 2026, »Lina nacrtuje z diagramom«): stikalo, privzeto VKLOPLJENO. Do odgovora streznika kaze
 * privzeto vrednost in je onemogoceno, da lastnik ne preklopi stanja, ki ga se ne vidi.
 */
export function NacrtStikalo({ id }: { id: string }) {
  const [vklop, setVklop] = useState(true);
  const [nalozeno, setNalozeno] = useState(false);
  useEffect(() => {
    let zivo = true;
    stanjeAgentPomociFn()
      .then((s) => {
        if (!zivo) return;
        setVklop(s.nacrtDiagram);
        setNalozeno(true);
      })
      .catch(() => undefined);
    return () => {
      zivo = false;
    };
  }, []);
  return (
    <Razdelek id={id} naslov={t("nacrtNaslov")}>
      <label className="flex cursor-pointer items-start gap-2 text-sm" htmlFor="nacrt-diagram-vklop">
        <input
          id="nacrt-diagram-vklop"
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={vklop}
          disabled={!nalozeno}
          onChange={(e) => {
            const v = e.target.checked;
            setVklop(v);
            void nastaviNacrtDiagramFn({ data: { vklop: v } }).then((r) => setVklop(r.vklopljen)).catch(() => setVklop(!v));
          }}
        />
        <span>{t("nacrtStikalo")}</span>
      </label>
    </Razdelek>
  );
}
