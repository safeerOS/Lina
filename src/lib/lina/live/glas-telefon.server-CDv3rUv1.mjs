import { o as __toESM } from "../_runtime.mjs";
import { A as klicTece, Cn as t, E as izvorIzGlav, Fn as resolveDataDir, Ht as soglasjeDano, J as odgovorLive, O as jeLokalnaZahteva, Wt as sprostiAktivniKlic, b as handleVoiceRequest, nn as uskladiSip, tn as uskladiAsistenta, tt as osveziAktivniKlic, v as handleNapakeRequest, wn as __exportAll, xt as pripraviGlasObZagonu, y as handleVoiceGet, z as loadLine } from "./sluzba-sip.server-CBDpSaxP.mjs";
import { _ as createFileRoute, b as require_jsx_runtime, d as Scripts, f as HeadContent, g as lazyRouteComponent, h as Outlet, m as createRouter, q as require_react, v as createRootRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, s as getRequestIP$1, t as createServerFn } from "./ssr.mjs";
import { timingSafeEqual } from "node:crypto";
//#region ../lina/node_modules/.nitro/vite/services/ssr/assets/router-w-MyPlal.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/** Razlog napake za cloveka; brez sporocila pove, kaj naj uporabnik naredi (slog besedil, razdelek 3). */
function errorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return t("uiNapakaStran");
}
/**
* Privzeta stran napake (UI-1): barve samo iz zetonov Line (svetla in temna tema), napis in razlog, gumb za ponovni poskus.
* Brez ikon knjiznice in brez barv zunaj palete.
*/
function AppErrorComponent({ error, reset }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		role: "alert",
		className: "flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-paper)] px-6 text-center text-[var(--color-ink)]",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				className: "inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-signal-fill)] text-2xl font-bold text-white",
				children: "!"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "display text-2xl",
				children: t("uiNapakaStranNaslov")
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-[var(--color-moss)]",
				children: errorMessage(error)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => {
					reset();
					if (typeof window !== "undefined") window.location.reload();
				},
				className: "mt-2 inline-flex min-h-11 items-center rounded-full bg-[var(--color-ink-fill)] px-5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]",
				children: t("uiOsvezi")
			})
		]
	});
}
var styles_default = "/assets/styles-CoGv07A1.css";
var lina2_default = "/assets/lina2-CVIpIgm5.css";
var KLJUC$1 = "lina-tema";
/** Skript v <head>: nastavi data-theme pred prvim izrisom (brez utripa). Brez shranjene izbire sledi sistemu. */
var SKRIPT_TEMA = "try{var t=localStorage.getItem(\"lina-tema\");if(t===\"temna\")document.documentElement.dataset.theme=\"dark\";else if(t===\"svetla\")document.documentElement.dataset.theme=\"light\";}catch(e){}";
function uporabi(tema) {
	const el = document.documentElement;
	if (tema === "temna") el.dataset.theme = "dark";
	else if (tema === "svetla") el.dataset.theme = "light";
	else delete el.dataset.theme;
}
function TemaPreklop() {
	const [tema, setTema] = (0, import_react.useState)("sistem");
	(0, import_react.useEffect)(() => {
		try {
			const s = localStorage.getItem(KLJUC$1);
			if (s === "temna" || s === "svetla") setTema(s);
		} catch {}
	}, []);
	const izberi = (nova) => {
		setTema(nova);
		uporabi(nova);
		try {
			if (nova === "sistem") localStorage.removeItem(KLJUC$1);
			else localStorage.setItem(KLJUC$1, nova);
		} catch {}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex items-center gap-2 text-sm text-[var(--color-moss)]",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("tema") }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
			value: tema,
			onChange: (e) => izberi(e.target.value),
			className: "rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-ink)]",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: "sistem",
					children: t("temaSistem")
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: "svetla",
					children: t("temaSvetla")
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: "temna",
					children: t("temaTemna")
				})
			]
		})]
	});
}
var Route$5 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "LINA · digitalna tajnica" },
			{
				name: "theme-color",
				content: "#1c1612"
			},
			{
				name: "description",
				content: "LINA sprejme klic, pozna katalog delavnice in zapiše naročilo."
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "stylesheet",
				href: lina2_default
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,680&family=Outfit:wght@380;500;640&display=swap"
			}
		]
	}),
	component: RootComponent
});
function RootComponent() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "sl",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("head", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("script", { dangerouslySetInnerHTML: { __html: SKRIPT_TEMA } }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})] })]
	});
}
var FOKUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]";
var OSNOVA_GUMBA = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50";
/** Glavno dejanje razdelka (eno na razdelek). */
var GUMB = `${OSNOVA_GUMBA} bg-[var(--color-ink-fill)] text-white hover:opacity-90 ${FOKUS}`;
/** Dejanje, ki nekaj zacne ali odpre navzven (sprejem klica, odprtje linije). */
var GUMB_SIGNAL = `${OSNOVA_GUMBA} bg-[var(--color-signal-fill)] text-white hover:opacity-90 ${FOKUS}`;
/** Drugotno dejanje. */
var GUMB_OBROBA = `${OSNOVA_GUMBA} border border-[var(--color-rule)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-ink)] ${FOKUS}`;
/** Vnosno polje (input, select, textarea). */
var POLJE = "mt-1.5 block w-full min-h-11 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-ink)] sm:text-sm hover:border-[var(--color-brass)] focus:border-[var(--color-ink)]";
var OZNAKA_POLJA = "block text-sm font-medium text-[var(--color-ink)]";
var NAMIG = "mt-1.5 block text-xs leading-relaxed text-[var(--color-moss)]";
/** Zunanji razdelek (edina »kartica« na zaslonu). */
var PLOSCA = "rounded-3xl border border-[var(--color-rule)] bg-[var(--color-sheet)]";
function Razdelek({ id, naslov, opis, children, className = "" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id,
		"aria-labelledby": `${id}-naslov`,
		className: `${PLOSCA} scroll-mt-6 p-5 sm:p-7 ${className}`,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				id: `${id}-naslov`,
				className: "display text-2xl leading-tight sm:text-3xl",
				children: naslov
			}),
			opis ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 max-w-prose text-sm leading-relaxed text-[var(--color-moss)]",
				children: opis
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-5",
				children
			})
		]
	});
}
/** Del razdelka: locen s crto, brez lastnega ozadja (ne kartica v kartici). */
function Podrazdelek({ naslov, opis, children, id }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-6 border-t border-[var(--color-rule)] pt-6 first:mt-0 first:border-t-0 first:pt-0",
		role: "group",
		"aria-labelledby": id,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				id,
				className: "text-base font-semibold text-[var(--color-ink)]",
				children: naslov
			}),
			opis ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 max-w-prose text-sm leading-relaxed text-[var(--color-moss)]",
				children: opis
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-3",
				children
			})
		]
	});
}
var BARVA_TONA = {
	signal: "text-[var(--color-signal)]",
	moss: "text-[var(--color-moss)]",
	brass: "text-[var(--color-brass)]",
	ink: "text-[var(--color-ink)]"
};
/** Oznaka stanja: vedno z napisom; barva je samo dodatek. */
function Znacka({ ton, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `inline-flex items-center rounded-full border border-current px-2.5 py-0.5 text-xs font-semibold ${BARVA_TONA[ton]}`,
		children
	});
}
function StanjeNalaganja({ besedilo = t("uiNalagam") }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		role: "status",
		"aria-live": "polite",
		"data-stanje": "nalaganje",
		className: "flex min-h-11 items-center gap-3 py-4 text-sm text-[var(--color-moss)]",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			"aria-hidden": "true",
			className: "inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-rule)] border-t-[var(--color-ink)] motion-reduce:animate-none"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: besedilo })]
	});
}
function StanjePrazno({ naslov, opis, dejanje }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		"data-stanje": "prazno",
		className: "rounded-3xl border border-dashed border-[var(--color-rule)] px-6 py-10 text-center",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "display text-xl",
				children: naslov
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--color-moss)]",
				children: opis
			}),
			dejanje ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: dejanje.onClick,
				className: `${GUMB} mt-5`,
				children: dejanje.oznaka
			}) : null
		]
	});
}
/** Napaka z razlogom: kaj se je zgodilo (naslov), zakaj (razlog) in kaj lahko uporabnik naredi (gumba). */
function StanjeNapaka({ naslov = t("uiNapakaNaslov"), razlog, onZapri, onPonovi }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		role: "alert",
		"data-stanje": "napaka",
		className: "flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-signal)] bg-[var(--color-surface)] px-4 py-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				className: "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-signal-fill)] text-sm font-bold text-white",
				children: "!"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "min-w-0 flex-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm font-semibold text-[var(--color-signal)]",
					children: naslov
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-0.5 text-sm break-words text-[var(--color-ink)]",
					children: razlog.trim() || t("uiNapakaBrezRazloga")
				})]
			}),
			onPonovi || onZapri ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex shrink-0 gap-2",
				children: [onPonovi ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: onPonovi,
					className: GUMB_OBROBA,
					children: t("uiPoskusiZnova")
				}) : null, onZapri ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: onZapri,
					className: GUMB_OBROBA,
					children: t("uiZapri")
				}) : null]
			}) : null
		]
	});
}
/** Vrstica s potrditvenim poljem ali izbirnim gumbom: cela vrstica je tarca dotika (najmanj 44 px). */
var IZBIRA = "izbira text-sm text-[var(--color-ink)]";
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
/** Zeton odprte seje (Lina brez gesla); ostane samo v pomnilniku streznika, brskalnik ga ne dobi. */
/**
* Seja lastnika: piskotek, ali - dokler gesla ni - zahteva z istega racunalnika (lastnik 12. 11. 2026).
* Prek javnega naslova (tunel, domena) seje brez gesla ni nikoli.
*/
/** Odstrani stari piškotek pogovora. Zgodovina je samo na strežniku. */
/** Naslov vticnice in glave; glave posrednika ali tunela same zadoscajo za zavrnitev. */
var authStatus = createServerFn({ method: "GET" }).handler(createSsrRpc("4828d841dab0ebc1baa68f9bc9cb486fb662029179d4a653c70d51c3bf4f2f13"));
var setupOwnerFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data.password !== "string") throw new Error("Geslo manjka.");
	return { password: data.password };
}).handler(createSsrRpc("70d7095f0346daa761b14c4c9512adb984133a0576644c40fd3132fd3ccd398e"));
var loginFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data.password !== "string") throw new Error("Geslo manjka.");
	return { password: data.password };
}).handler(createSsrRpc("71e4c6ed31dd339e08f249299b8be6dec5be49cc50fdf530b84359c0a3d406ff"));
var logoutFn = createServerFn({ method: "POST" }).handler(createSsrRpc("a640f06f932a31415d7a9ee0fa112eb4f16d9efd2da26b6e8a876ef1d2bf2383"));
var publishLine = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("bee4543149e73a96922c0b39328509f99cf1906920a20506e16fda892bb0ba6c"));
var readLine = createServerFn({ method: "GET" }).handler(createSsrRpc("eb14b03d8cc5fa7ca5325bca62fd90777df9d67c21b1cbde0765756dcb1132b1"));
var listCalls = createServerFn({ method: "GET" }).handler(createSsrRpc("ff7f07540e70a575049144c3a20b56a5fcd606bc2566319c84899c1e75ae91ea"));
createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("eca608b15155c1bb078dab01c5b6d61b3a771bc583bab713b98c1d1702ad2860"));
var phoneTurn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("3e6a7e7ed67bb25b6d2fa20e052f9f8838f2c0089324c3e1b1e8d0fc4b1b18ba"));
var speak = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f78d03f5aa27e06294388c5aa1f700dbdfed788a247503791ff99ac4fdc76799"));
var readBrainFn = createServerFn({ method: "GET" }).handler(createSsrRpc("1db18c3daed082824bd47a0edb1460c57272a072e7a4ab25ca802db9afac9a03"));
var saveBrainFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("25ecb6d33bc9bd3da74bb1b6489f28f9643b7e4f81b1e555c05a961df2e488d0"));
var checkBrainFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("843be7c99a771250f6df0cfefc9be158e3e479638d9c032f7198c9a779998bc7"));
var readStorageFn = createServerFn({ method: "GET" }).handler(createSsrRpc("d23be654dcb6eb9890a1b40fafac976db548e0f1211394beb0cc6dfa493cf95e"));
var chooseStorageFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("fa6bb5730c9bbbc76d51d55343c5161023330951ff768a2cd803cdf09e839fa5"));
var readPravilaFn = createServerFn({ method: "GET" }).handler(createSsrRpc("bf484a185a4aaec850be70410048df5204130ecd9d1b299fb092108d18383769"));
var savePravilaFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("9b86d421d666292b17adf20c44c7565a0bf13a4793b2bb6c7c7c7022287e2e9d"));
var listVrzeliFn = createServerFn({ method: "GET" }).handler(createSsrRpc("2adf085f4829b95feeb7beb82f9dd43115f67508f924acaa2d9ececdf69ea566"));
var dodajVrzelFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data.id !== "string" || typeof data.odgovor !== "string") throw new Error("Manjka vprasanje ali odgovor.");
	return {
		id: data.id,
		odgovor: data.odgovor
	};
}).handler(createSsrRpc("4e838578fd61a5bb180d39b8e9a2c745e75fd61e545ccc33d5b1011a9a7f597c"));
createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data.text !== "string") throw new Error("Vprasanje manjka.");
	return { text: data.text };
}).handler(createSsrRpc("c715bb644c9ae431ed11a8d5fff67b23f941459a9344bc487f78e81a9d4b7d63"));
/** Vaja klica: ista zascita kot ostale funkcije vmesnika (seja lastnika); javna pot /api/voice je ne pozna. */
var vajaKlicaFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || data.id !== void 0 && typeof data.id !== "string" || data.text !== void 0 && typeof data.text !== "string") throw new Error("Vaja ni veljavna.");
	return {
		id: data.id,
		text: data.text?.slice(0, 2e3),
		konec: data.konec === true
	};
}).handler(createSsrRpc("fc73b839991ea31270573c41dbce406255fe631c5cfd7c6c677515a4e848e82f"));
var preberiSpletFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data.naslov !== "string") throw new Error("Naslov manjka.");
	return { naslov: data.naslov };
}).handler(createSsrRpc("84bf58c0cdd87b91a0b292da72c444a9193924cd6f3b6e6432182cf614dbbd36"));
var preberiPredlogFn = createServerFn({ method: "GET" }).handler(createSsrRpc("4cd1a670a753be7c39ab61cd91aab0fde9e69c89d8461494e9a6dad4fb8b5d69"));
var potekSpletaFn = createServerFn({ method: "GET" }).handler(createSsrRpc("3b741fb5217f0d8e1c5777cf8307789aa114f2daab05bc7c125ddb681229c646"));
var potrdiPredlogFn = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || !Array.isArray(data.ids) || data.ids.some((id) => typeof id !== "string")) throw new Error("Izbira manjka.");
	return { ids: data.ids };
}).handler(createSsrRpc("b3f991597416da32502e92ed25b8ea50e26c7498a5deeae52b35efbfdc879267"));
var zavrziPredlogFn = createServerFn({ method: "POST" }).handler(createSsrRpc("e501933ff9a428a5b459f6d6ae73ad86649cfded33d12963a64158a66e2bc7c2"));
/** Zapiski pogovorov (G5): vse brez prijave zavrnjeno; odjemalec poslje samo ID z seznama ali vnos mape, nikoli poti do datoteke. */
var pogledMapeZapiskovFn = createServerFn({ method: "GET" }).handler(createSsrRpc("761d595a0ac58408f601d5e982837416fb63a9e834d5f98be9ca317ef6a7840d"));
var izberiMapoZapiskovFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("70257d344d943cac416b73e97e4e32ff100f1fd47004c9db377c5439a6fc5805"));
var odpriMapoZapiskovFn = createServerFn({ method: "POST" }).handler(createSsrRpc("04120efbf0b2d9a7def622c759a7c98d0a2fea449b92226438ebc194603105b3"));
var seznamZapiskovFn = createServerFn({ method: "GET" }).handler(createSsrRpc("96b1ad8e2e17a16fb75a09430bb0642e2cac85b3f157e005fd52c9125c7e6283"));
var preberiZapisekFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("818b7c887784832967f44ec3d8cacee942f8bed9c3af27b1b2c5d0f81f140936"));
var zdruziZapiskeFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("869e4a865db3e18012a48a55d32678fdb84a6789f392ef47e67c3233e198d646"));
/** Googlov racun Line (11. 11. 2026): stanje, namestitev gcloud po dovoljenju, prijava v privzetem brskalniku, projekti, pozabi. */
var stanjeGoogleFn = createServerFn({ method: "GET" }).handler(createSsrRpc("e99183c9ad5a62a749654cdcccd0c5c18eae7fc5a8144b35c105214206c64bbd"));
var namestiGcloudFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f3fa0209c85c9444d1c902714435694a01d340654a2762e5ddf0f560df2e0992"));
var zacniGoogleFn = createServerFn({ method: "POST" }).handler(createSsrRpc("8eb0e9bb2cdf532d36dbc1c153e393af06b8bf9a241d21c1e6feb5da9bb73410"));
var preklicGoogleFn = createServerFn({ method: "POST" }).handler(createSsrRpc("0ab6eb97705b13c7c2c4f4352a8123356d725c6c8eba7e75d58d5fd2a84af045"));
var projektiGoogleFn = createServerFn({ method: "GET" }).handler(createSsrRpc("0ffdb98686694045695eb9c4b8a9984caeb3b53a364ea190078d13ff162b94ee"));
var pozabiGoogleFn = createServerFn({ method: "POST" }).handler(createSsrRpc("242dff17bc20cdf8050d98702bcd203650582cdf4bb43999b267350997fd77f4"));
/** Racun Twilio (12. 11. 2026): SID + API kljuc, stevilke, naslov klicev, pozabi. Skrivnost nikoli ne gre nazaj odjemalcu. */
var stanjeTwilioFn = createServerFn({ method: "GET" }).handler(createSsrRpc("978d8bffa1a44de1d4b1f3eb440cbb39be735418aca3bbfc094d67091f23afae"));
var poveziTwilioFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f2765c3c94acbcdc5e3ed0b30df0a453d63c92907f4e1be923c82f515ffde3ca"));
var stevilkeTwilioFn = createServerFn({ method: "GET" }).handler(createSsrRpc("6ad7d61e3381ca076bc90e0fc21f77c61a2c6490560d0f82377f67b449e1fd2c"));
var naslovTwilioFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("582882e33d973268ba32b38ec4c96e8352f8674cda9cfbeea4b6c62b4438e02b"));
var pozabiTwilioFn = createServerFn({ method: "POST" }).handler(createSsrRpc("7adedd5e7964a4e3d38d3718d177740dc5fc75bfd2d1c98db97fd582927d265c"));
createServerFn({ method: "GET" }).handler(createSsrRpc("7d1453ded2114596748944ad7004065dd1d1db8386aba56877aef5a30fe8e2f6"));
createServerFn({ method: "GET" }).handler(createSsrRpc("2171bebfa665f13e052cc6f2e86e8f67eb8f30d605c29185cab96109429efd16"));
createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("d477334432b3e3d6283de319208b9d966814c9eb1f6f049ea95e948630f92292"));
createServerFn({ method: "POST" }).handler(createSsrRpc("511b64b390a0e31abfa1c44b781993f3fcec135b56a7a3330e42b9947ca90148"));
/** Podpis klicev s SharedKey (brez Auth Tokena). Stanje ne vrne skrivnosti, samo ali je kljuc shranjen. */
var stanjePodpisaFn = createServerFn({ method: "GET" }).handler(createSsrRpc("b904fe39c45972da59485bf1cf0f43f65e86d57d9bd368a7b45c1b3f0e673d74"));
var vklopiPodpisFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f6d52d35516989b8ff5e3bdcfa452f9f43c3ce40792cc595c018a7779ddd1e62"));
/** Testni klic (preizkusni racun Twilio): Twilio poklice uporabnikovo stevilko in klic pride k Lini. Brez terminala. */
var testniKlicFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("0b13523dede541be2f9f2e2e95508d04c3ea37d8d803e63b6095216d6aea7e39"));
/**
* Pot javnega naslova (lastnik 12. 11. 2026): neposredna (domena + javno potrdilo), hitri tunel kot rezerva, samodejna izbira.
* Vse zahteva lastnika (seja); naslov ne gre v dnevnik, samo v pravila in odgovor lastniku. Odjemalec ne poslje poti ali ukaza.
*/
var stanjePotiFn = createServerFn({ method: "GET" }).handler(createSsrRpc("008d9059237343ac19e90e76c677af51f4760e4b6ff9e0c798b9b193ec5eac8e"));
var nastaviPotFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("451e38cee2f66e167c025ec9e53f3bc24bb2b30d42ce9901ef8d768497f8736c"));
var vklopiPotFn = createServerFn({ method: "POST" }).handler(createSsrRpc("02dff2db313971e1d97fa14566c14f0664b1b118713f3774629b6e03823f4d3f"));
var izklopiPotFn = createServerFn({ method: "POST" }).handler(createSsrRpc("71ab816b5da6f064cb629898c9689406fc155709278da435c1841eadef49f0e3"));
var namestiPotFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("cf804cec9559b581fccf8081c8facd273b5cf4a3906b1233bbbe0d4fe2c1d9ee"));
/** Neobvezni bralnik strani prek TinyFish z uporabnikovim lastnim kljucem. Kljuc nikoli ne gre nazaj odjemalcu. */
var stanjeTinyFishFn = createServerFn({ method: "GET" }).handler(createSsrRpc("73526180db3c0867d19b7ec5a7d061aaf733ac3ff1eba1e79ae2f59bdbce908c"));
var poveziTinyFishFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("00575fb09f8bfc24427d56dae50c185cf444fb08836017a3b34a5e7305963269"));
var pozabiTinyFishFn = createServerFn({ method: "POST" }).handler(createSsrRpc("88dea2d245ea1e49c0a933c18f1289ce9a8a73ae3345441faed77890759ec38d"));
/** Nujni klici na osebni telefon (lastnik 10. 11. 2026): stikali in stevilka. Stevilka nikoli ne gre nazaj odjemalcu. */
var nujniNastavitveFn = createServerFn({ method: "GET" }).handler(createSsrRpc("a304336718820f9907a441e812c8db5c9bc249130b9bf9ae6d157f48e66cf684"));
var shraniNujneFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("9cd47481812f452dc955c2cbc34e93459a78dcb997f1b15d7d747edf4d1163d0"));
/** Brave Search (rezerva iskanja asistentke) z uporabnikovim lastnim kljucem. Kljuc nikoli ne gre nazaj odjemalcu. */
var stanjeBraveFn = createServerFn({ method: "GET" }).handler(createSsrRpc("3491e978876c36432e7d895621cc242dbb4dc8b53a9d7fa2990bcfc5e79528a5"));
var poveziBraveFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("2becfa9efa44927e2c9da000c17e42000846a5a4455467b54871039f629ad69c"));
var pozabiBraveFn = createServerFn({ method: "POST" }).handler(createSsrRpc("4aa52c87d88caece9cb128a204ccdae08ab3b89e67972c3261c90277ee5fc3db"));
var nastaviMejoBraveFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f7b370dcfb87aedea78c987e0c56381dc6235574cf8558a02a778f3887dfbfa9"));
/** Neobvezen prehod OmniRoute (privzeto izklopljen). Kljuc nikoli ne gre nazaj odjemalcu. */
var stanjeOmnirouteFn = createServerFn({ method: "GET" }).handler(createSsrRpc("fd7ab1d22d4ad861d22a55d2fc0bb445a7175ef90eea56b8ef88e9b8b89adee2"));
var shraniOmnirouteFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("c170453c1c4b61975b5dfac65e522306f134954cb23082ac8278ebfea768dc61"));
var pozabiOmnirouteFn = createServerFn({ method: "POST" }).handler(createSsrRpc("b19794def98dbb7ed093d944dc601dc396d664d18e32e9731475ba910822a753"));
/** Soglasje ob prvem zagonu: racunalnik postane lokalni streznik za Lino; brez soglasja uporaba ni mogoca. Dati ga je mogoce samo na tem racunalniku. */
var soglasjeFn = createServerFn({ method: "GET" }).handler(createSsrRpc("4acb63a5f5ee1220409fe6b1d03b4d2d4d17579130e391c018c11e83f6fe4f34"));
var daSoglasjeFn = createServerFn({ method: "POST" }).handler(createSsrRpc("d717b39243d694ccfa17e43cd26f7fcc49d8cd88fc18b655ec962458dfec4782"));
/** Telefon za asistentko (zaslon »Poveži telefon«): privzeto izklopljeno; QR in potrditev lastnika (asistent-telefon.server.ts). */
var stanjeAsistentaFn = createServerFn({ method: "GET" }).handler(createSsrRpc("485bb0caef6464327b09177a4c48f1bfa1dc0451b836a547a863a87d4c15c97f"));
var shraniAsistentaFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("01cfc612a60933feacf8a06215e9ed45a79fca98a022a2b7b79b2af0cb38b0d5"));
var zacniSeznanitevFn = createServerFn({ method: "POST" }).handler(createSsrRpc("43eaf9dda7e0fbfc552c12b246edb00761d22bb79784edaeda895195425aa957"));
/** »Povezi s kodo«: 6-mestna koda za telefon (SPAKE2 kot v Safeer Linku, koda-seznanitev.ts). */
var zacniSeznanitevSKodoFn = createServerFn({ method: "POST" }).handler(createSsrRpc("e294bd9e3d9301a32bc36b4d83512bad73c1a4457b4ede3737e04c6f73681e48"));
var vnesiKodoTelefonaFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("5ee14b73b43f0ff0f84b5fa1d179b5620e19e3583f3e477511617a47008ea261"));
var zapriSeznanitevSKodoFn = createServerFn({ method: "POST" }).handler(createSsrRpc("174c42156a8f77ea0ec175351dfd8c4527b8ec813dcc0d59c25b08fd6bb5be60"));
/** Lastnik koncna zaporo povezovanja s kodo (T1-N1): zaporo lahko sprozi neznanec iz omrezja. */
var odkleniPovezovanjeFn = createServerFn({ method: "POST" }).handler(createSsrRpc("2110270d13d7974f5533dc7ed864b625673bc70124f54336e1f6e3920e5e99f2"));
var odlociSeznanitevFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("1f43b8d2727fddd28efcb2bb0676a5d2d569b7520722bf4becb74e9a33810f05"));
var odstraniNapravoFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("1c0bc0598c25a23cbd1de7e16a2c34d1520922cc9e4b46be4c30efdb9baa963d"));
var shraniOpenLineFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("e5ece980b11f4c10ea6f9d05c434c16a474be7c69fe760ca2d15f8808f3df13b"));
/** Spomin lastnika, faza 1 (lastnik 15. 11. 2026): stikalo (privzeto izklopljeno) in dejstva, ki jih uporabnik napise sam. */
var spominFn = createServerFn({ method: "GET" }).handler(createSsrRpc("6934279a7896f540a33d288b3fa48c6f498884eb7f31524f5ae9a29b22255a2c"));
var nastaviSpominFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("3b322172c774a09baeb3b3b88150632222b9c4f4a8acbe65d318c387fb9ad73b"));
var dodajDejstvoFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("fc18e740a91ea230ae26958dd4ae0336c85ae9c14a9c7408dac4d5731ff0f4ef"));
var urediDejstvoFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("fd188a28d45a797d92ccd0d50a5a5b49f5e86c7e1ec08a1600027235ca05b624"));
var izbrisiDejstvoFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("f92e34e1faad293d4ebe87d4ff8ddb6033ec24b4bc99bbb26e7e1f4160775a3c"));
var izbrisiVsaDejstvaFn = createServerFn({ method: "POST" }).handler(createSsrRpc("de5a4577ecac91879c6a7170f41303b20738e7c378a72ea605f3fae1161af35e"));
var izvoziSpominFn = createServerFn({ method: "GET" }).handler(createSsrRpc("8da673d22487020f1d717c475b0b35462c69216c11bf7133711bf3d7622aa4ac"));
/** Napake naprav (nastavitve in vnos): podobno kot nujni klici, v isti komponenti. */
var napakeNastavitveFn = createServerFn({ method: "GET" }).handler(createSsrRpc("8ee542f1bc0096f71704a43a8ffac9ecfcf4d04d3d72bd87146c63d4407a46be"));
var zetonNapakeFn = createServerFn({ method: "GET" }).handler(createSsrRpc("d8b235c8cc968720d95eaa2af4cf4ff8bd5d36a957032dcce739e188b403e075"));
var shraniNapakeFn = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("b12fba3bbb5790bdb1c6f6f8f6694269ee339b6729180c12a22a460c88807008"));
var asistentZgodovinaFn = createServerFn({ method: "GET" }).handler(createSsrRpc("feb50b7a60749b9131c118094637f7ed729d7716687d5429ccbc611687f537f9"));
var asistentFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("d1da2a7c09d777a5fb4f43ddbf31e14522edd033d5c59d3ae65e8d22c8bea759"));
var koledarSeznamFn = createServerFn({ method: "GET" }).handler(createSsrRpc("81606f93a5f269b2359468eb44da21f1aeba0b4016b609f8ede28a09750ff3ba"));
var koledarDodajFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("a1be653b93013cbff1b0aabb57e4393d06d9da8950e947c13d4fdc5ea2205806"));
var koledarSpremeniFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("4a166a2aa7469bbb0024504c6f211ea0a182877af2e3d9288793c700f352ee4f"));
var koledarIzbrisiFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("3049bd174cb9512b7152c0518cdf8e3c94fbc6d0016c515d1277b269f10f00e9"));
var prepisFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("a4a1bcc4569d2b211670e7678310a283c6db6deff0ee25ac40d01182bdea7462"));
var govorFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("d30ca4edebef4f3063aa60f4eddba962f1e3621427a4efc57d161e4f871ff9f5"));
var imenikSeznamFn = createServerFn({ method: "GET" }).handler(createSsrRpc("28000bfa797d805f92320fc4349952ce9fa4d10947efb261c241cb9427d56c97"));
var imenikShraniFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("9209be3bb26b84e561ec0167c3700c14a8519edcea8f75956b71b2095f14dd7a"));
var imenikIzbrisiFn = createServerFn({ method: "POST" }).validator((data) => data ?? {}).handler(createSsrRpc("8bd37f016c544b4a2f3ef732967c5b7ef6f063ac7ef891a23cd3e104e9d22f0b"));
var $$splitErrorComponentImporter = () => import("./routes-CLtvATof.mjs");
var $$splitComponentImporter = () => import("./routes-ztKMs51u.mjs");
var Route$4 = createFileRoute("/")({
	loader: async () => {
		const auth = await authStatus();
		const soglasje = (await soglasjeFn()).dano;
		if (!soglasje || !auth.signedIn) return {
			soglasje,
			auth,
			line: null,
			calls: [],
			brain: {
				provider: null,
				model: "",
				nastavljen: false,
				namig: null
			},
			storage: null,
			pravila: null,
			vrzeli: []
		};
		const [line, calls, brain, storage, pravila, vrzeli] = await Promise.all([
			readLine(),
			listCalls(),
			readBrainFn(),
			readStorageFn(),
			readPravilaFn(),
			listVrzeliFn()
		]);
		return {
			soglasje,
			auth,
			line,
			calls,
			brain,
			storage,
			pravila,
			vrzeli
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component"),
	pendingComponent: Nalaganje,
	pendingMs: 500,
	errorComponent: lazyRouteComponent($$splitErrorComponentImporter, "errorComponent")
});
/** Soglasje ob prvem zagonu: brez njega se Lina ne more uporabljati (zaslon ni dosegljiv, sprejem klicev je zaprt). */
function Nalaganje() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "display text-4xl",
			children: "Lina"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StanjeNalaganja, {})]
	});
}
function veljavenZetonLupine(dan, pricakovan) {
	if (!pricakovan || pricakovan.length < 32 || !dan || dan.length !== pricakovan.length) return false;
	return timingSafeEqual(Buffer.from(dan), Buffer.from(pricakovan));
}
/** Linija, ki caka na odprtje, steje kot odprta: raje vprasati ob zaprtju kot tiho ustaviti sprejem klicev. */
function stanjeLupine(linija, klic) {
	return {
		linija: linija.open || linija.caka ? "odprta" : "zaprta",
		klicVTeku: klic
	};
}
async function handleLupinaRequest(request, naslov, dir, zeton = process.env.LINA_LUPINA_ZETON) {
	const glave = {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	};
	if (request.method !== "GET" || !jeLokalnaZahteva(izvorIzGlav(naslov, request.headers)) || !veljavenZetonLupine(request.headers.get("x-lina-lupina"), zeton)) return new Response("{\"napaka\":\"prepovedano\"}", {
		status: 403,
		headers: glave
	});
	const root = resolveDataDir(dir);
	const stanje = stanjeLupine(await loadLine(root), klicTece(root));
	return new Response(JSON.stringify(stanje), {
		status: 200,
		headers: glave
	});
}
/** Stanje linije in klica za lupino programa (okno, ikona). Brez zetona lupine ali z drugega racunalnika je 403. */
var Route$3 = createFileRoute("/api/lupina")({ server: { handlers: {
	GET: async ({ request }) => handleLupinaRequest(request, getRequestIP$1()),
	POST: async ({ request }) => handleLupinaRequest(request, getRequestIP$1())
} } });
var Route$2 = createFileRoute("/api/napake")({ server: { handlers: { POST: async ({ request }) => handleNapakeRequest(request, getRequestIP$1()) } } });
/**
* Priprava glasu ob zagonu programa. Vticnik streznika (server/plugins/lina-zagon.ts) tece v drugem svezenju kode
* kot obdelava zahtev in ima zato svoje kopije stanja v pomnilniku; ce bi glas pripravil sam, bi prvi klic pognal
* drugo pripravo. Vticnik zato poslje eno notranjo zahtevo sem, da priprava tece v ISTI kopiji kot klici.
*/
var KLJUC = Symbol.for("lina.zagon.zeton");
function porabiZeton(dan) {
	const shranjen = globalThis[KLJUC];
	if (!shranjen || dan.length !== shranjen.length) return false;
	if (!timingSafeEqual(Buffer.from(dan), Buffer.from(shranjen))) return false;
	delete globalThis[KLJUC];
	return true;
}
/**
* Notranja zahteva zagona. Brez veljavnega enkratnega zetona 403 - pot je sicer dosegljiva vsakomur, ki doseze
* streznik, zato brez zetona ne naredi nicesar. Odgovor pove samo stanje linije.
*/
async function handleZagonRequest(request, dir) {
	const glave = {
		"content-type": "text/plain; charset=utf-8",
		"cache-control": "no-store"
	};
	if (request.method !== "POST" || !porabiZeton(request.headers.get("x-lina-zagon") ?? "")) return new Response("Prepovedano", {
		status: 403,
		headers: glave
	});
	const stanje = await pripraviGlasObZagonu(dir);
	await uskladiAsistenta(dir).catch(() => void 0);
	uskladiSip(dir).catch(() => void 0);
	return new Response(stanje, {
		status: 200,
		headers: glave
	});
}
/** Notranja zahteva vticnika zagona: pripravi Linin glas. Brez enkratnega zetona iz pomnilnika procesa je 403. */
var Route$1 = createFileRoute("/api/zagon")({ server: { handlers: {
	POST: async ({ request }) => handleZagonRequest(request),
	GET: async ({ request }) => handleZagonRequest(request)
} } });
/** Telefonski vhod. Prijava ni potrebna; POST zahteva podpis Twilio, GET vrne samo posnetek z neuganljivim kljucem. */
var Route = createFileRoute("/api/voice/$")({ server: { handlers: {
	POST: async ({ request }) => {
		if (!await soglasjeDano()) return new Response("Lina se brez soglasja ne uporablja.", { status: 503 });
		return handleVoiceRequest(request);
	},
	GET: async ({ request }) => {
		if (!await soglasjeDano()) return new Response("Lina se brez soglasja ne uporablja.", { status: 503 });
		if (new URL(request.url).pathname === "/api/voice/live" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const root = resolveDataDir();
			return odgovorLive(request, {
				osvezi: (sid) => osveziAktivniKlic(root, sid),
				sprosti: (sid) => sprostiAktivniKlic(root, sid)
			}, root, (koda) => console.info(`[lina] live: ${koda}`));
		}
		return handleVoiceGet(request);
	}
} } });
var rootRouteChildren = {
	IndexRoute: Route$4.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$5
	}),
	ApiLupinaRoute: Route$3.update({
		id: "/api/lupina",
		path: "/api/lupina",
		getParentRoute: () => Route$5
	}),
	ApiNapakeRoute: Route$2.update({
		id: "/api/napake",
		path: "/api/napake",
		getParentRoute: () => Route$5
	}),
	ApiZagonRoute: Route$1.update({
		id: "/api/zagon",
		path: "/api/zagon",
		getParentRoute: () => Route$5
	}),
	ApiVoiceSplatRoute: Route.update({
		id: "/api/voice/$",
		path: "/api/voice/$",
		getParentRoute: () => Route$5
	})
};
var routeTree = Route$5._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent,
		scrollRestoration: true
	});
}
//#endregion
export { prepisFn as $, nastaviPotFn as A, zacniSeznanitevSKodoFn as At, potrdiPredlogFn as B, NAMIG as Bt, loginFn as C, urediDejstvoFn as Ct, napakeNastavitveFn as D, vnesiKodoTelefonaFn as Dt, namestiPotFn as E, vklopiPotFn as Et, odpriMapoZapiskovFn as F, FOKUS as Ft, pozabiGoogleFn as G, Razdelek as Gt, poveziTinyFishFn as H, PLOSCA as Ht, odstraniNapravoFn as I, GUMB as It, pozabiTwilioFn as J, StanjePrazno as Jt, pozabiOmnirouteFn as K, StanjeNalaganja as Kt, phoneTurn as L, GUMB_OBROBA as Lt, nujniNastavitveFn as M, zavrziPredlogFn as Mt, odkleniPovezovanjeFn as N, zdruziZapiskeFn as Nt, naslovTwilioFn as O, zacniGoogleFn as Ot, odlociSeznanitevFn as P, zetonNapakeFn as Pt, preklicGoogleFn as Q, pogledMapeZapiskovFn as R, GUMB_SIGNAL as Rt, koledarSpremeniFn as S, testniKlicFn as St, namestiGcloudFn as T, vklopiPodpisFn as Tt, poveziTwilioFn as U, POLJE as Ut, poveziBraveFn as V, OZNAKA_POLJA as Vt, pozabiBraveFn as W, Podrazdelek as Wt, preberiSpletFn as X, TemaPreklop as Xt, preberiPredlogFn as Y, Znacka as Yt, preberiZapisekFn as Z, izklopiPotFn as _, stanjePodpisaFn as _t, checkBrainFn as a, seznamZapiskovFn as at, koledarIzbrisiFn as b, stanjeTwilioFn as bt, dodajDejstvoFn as c, shraniNujneFn as ct, imenikIzbrisiFn as d, speak as dt, projektiGoogleFn as et, imenikSeznamFn as f, spominFn as ft, izbrisiVsaDejstvaFn as g, stanjeOmnirouteFn as gt, izbrisiDejstvoFn as h, stanjeGoogleFn as ht, asistentZgodovinaFn as i, setupOwnerFn as it, nastaviSpominFn as j, zapriSeznanitevSKodoFn as jt, nastaviMejoBraveFn as k, zacniSeznanitevFn as kt, dodajVrzelFn as l, shraniOmnirouteFn as lt, izberiMapoZapiskovFn as m, stanjeBraveFn as mt, Route$4 as n, saveBrainFn as nt, chooseStorageFn as o, shraniAsistentaFn as ot, imenikShraniFn as p, stanjeAsistentaFn as pt, pozabiTinyFishFn as q, StanjeNapaka as qt, asistentFn as r, savePravilaFn as rt, daSoglasjeFn as s, shraniNapakeFn as st, router_exports as t, publishLine as tt, govorFn as u, shraniOpenLineFn as ut, izvoziSpominFn as v, stanjePotiFn as vt, logoutFn as w, vajaKlicaFn as wt, koledarSeznamFn as x, stevilkeTwilioFn as xt, koledarDodajFn as y, stanjeTinyFishFn as yt, potekSpletaFn as z, IZBIRA as zt };
