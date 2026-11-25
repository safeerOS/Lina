# ucenje-lh: učenje postopkov za Lino (AGPL-3.0)

Ta mapa je ločen modul Line pod licenco **GNU Affero General Public License v3.0** (datoteka `LICENSE` v tej mapi).
Odločitev lastnika 25. 11. 2026: ta del kode je pod AGPL (koda tretjih ne gre pod komercialno licenco, odločitev 24. 11. 2026).

## Izvor
- LearnHarness, https://github.com/amosblomqvist/learnharness, commit 069a6a1 (različica 0.7.0)
- Copyright (C) Amos Blomqvist (avtor LearnHarness), licenca AGPL-3.0-only
- Prevzeto in prirejeno: besedila metode iz `src/agent/system-prompt.md`, `src/agent/prompts/prober/10-probe-doctrine.md`,
  `src/agent/prompts/teacher/10-planning.md`, `src/agent/prompts/teacher/20-teaching.md`,
  `src/agent/prompts/teacher/30-question-principles.md` (zamisel »najšibkejše najprej« iz `src/agent/prompts/practice/10-doctrine.md`).

## Spremenil Safeer (team@safeer.si), 25. 11. 2026
- `pozivi.ts`: prevod v slovenščino, skrajšano, prirejeno za postopke (veriga korakov namesto grafa mermaid in orodij
  `plan_init`/`quiz`/`probe_done`), izhod JSON, ki ga preveri koda.
- `enota.ts`, `shramba.server.ts`, `vstop.server.ts`: nova koda Safeer okoli teh navodil (dvojiško merjenje meje nad koraki,
  preverba po koraku, ponavljanje po škatlah 1/3/7/14/30 dni - slednje jedro LearnHarness nima).
- Ni prevzeto (B9): spletno iskanje (Tavily, Brave, Exa, Firecrawl, Ollama), Jina, narekovanje (Deepgram), samodejne posodobitve,
  najave ob zagonu, branje datotek, izvajanje kode (coding-questions), graf propozicij, Electron in vmesnik.
- Modul nima omrežja: model kliče samo funkcija, ki jo poda Lina (`../ucenje-lh-vrata.server.ts`, Linin ponudnik prek `providers.ts`).

## Izpust pri gradnji
`LINA_BREZ_UCENJA_LH=1 npm run build` preslika `./ucenje-lh/vstop.server.ts` v `../ucenje-lh-prazno.server.ts`
(`scripts/ucenje-lh-zastavica.mjs`, `vite.config.ts`); Lina deluje brez modula. Izvorna koda tega modula je na voljo pod AGPL-3.0
vsakomur, ki dobi program z vgrajenim modulom (vključno z uporabo prek omrežja, AGPL razdelek 13).
