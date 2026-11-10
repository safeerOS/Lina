/* Jezik konzole: sistem, anglescina ali slovenscina. Anglescina ostane vir. */
(function () {
  const KEY = "openline.lang";
  const SL = {
    "System": "Sistem",
    "Language": "Jezik",
    "Sign in": "Prijava",
    "OpenLine console": "Konzola OpenLine",
    "Email": "E-pošta",
    "Password": "Geslo",
    "Repeat password": "Ponovite geslo",
    "At least 8 characters.": "Najmanj 8 znakov.",
    "Setup key": "Ključ za nastavitev",
    "Continue": "Naprej",
    "Create your account": "Ustvarite račun",
    "The first account owns this gateway.": "Prvi račun je lastnik tega prehoda.",
    "Choose a password": "Izberite geslo",
    "Use at least 8 characters for the password.": "Geslo naj ima najmanj 8 znakov.",
    "The passwords don't match.": "Gesli se ne ujemata.",
    "Signed out": "Odjavljeni ste",
    "Main": "Glavno",
    "Home": "Domov",
    "Playground": "Igrišče",
    "Connection": "Povezava",
    "Docs": "Dokumentacija",
    "Docs ↗": "Dokumentacija ↗",
    "Settings": "Nastavitve",
    "Checking phone…": "Preverjam telefon…",
    "No phone": "Ni telefona",
    "Your phone's SIM, as a voice API.": "SIM vašega telefona kot glasovni API.",
    "A self-hosted alternative to Twilio Voice. An Android phone places and answers real calls on its SIM, and your apps and AI agents control them over HTTP and stream the audio over WebSockets.": "Samostojna alternativa Twilio Voice. Telefon Android kliče in sprejema prave klice na svojem SIM-u, vaše aplikacije in glasovni agenti pa jih vodijo prek HTTP in zvok prenašajo po WebSocketu.",
    "Phone": "Telefon",
    "Runs the OpenLine app. Dials, answers and routes call audio. It stays silent: the conversation happens on the server.": "Poganja aplikacijo OpenLine. Kliče, sprejema in usmerja zvok klica. Sam molči: pogovor teče na strežniku.",
    "Server": "Strežnik",
    "This machine. Exposes the REST API, relays audio, sends webhooks and keeps every call in a local SQLite database.": "Ta računalnik. Ponuja REST API, posreduje zvok, pošilja webhooke in vsak klic hrani v lokalni bazi SQLite.",
    "Your agent": "Vaš agent",
    "Any app or voice AI. Start calls with a POST, get status by webhook, and talk through 16 kHz PCM on a WebSocket.": "Katera koli aplikacija ali glasovna umetna inteligenca. Klic začne s POST, stanje dobi po webhooku in govori z 16 kHz PCM po WebSocketu.",
    "Make a call from code": "Pokličite iz kode",
    "Create an API key in Settings, then place a call that talks to your agent:": "V nastavitvah ustvarite ključ API, nato opravite klic, ki govori z vašim agentom:",
    "API": "API",
    "Full docs": "Vsa dokumentacija",
    "Getting started": "Začetek",
    "Try the API by hand: place a call, talk from this laptop, listen in, or hand the call to the built-in AI assistant.": "API preizkusite ročno: opravite klic, govorite s tega prenosnika, prisluhnite ali klic predajte vgrajenemu pomočniku.",
    "No call": "Ni klica",
    "Number to call": "Številka za klic",
    "Call": "Pokliči",
    "Incoming calls appear here.": "Dohodni klici se pokažejo tukaj.",
    "Same thing over the API": "Isto prek API-ja",
    "Answer": "Sprejmi",
    "Decline": "Zavrni",
    "Hold": "Zadrži",
    "Resume": "Nadaljuj",
    "Keypad": "Tipkovnica",
    "End call": "Končaj klic",
    "Assistant": "Pomočnik",
    "Not on this call.": "Ni v tem klicu.",
    "Hand to assistant": "Predaj pomočniku",
    "Laptop audio": "Zvok prenosnika",
    "Off. Use headphones to avoid echo.": "Izklopljeno. Uporabite slušalke, da ni odmeva.",
    "Caller": "Klicatelj",
    "You": "Vi",
    "Listen in": "Prisluhni",
    "Talk from laptop": "Govori s prenosnika",
    "Mute": "Utišaj",
    "Unmute": "Vklopi mikrofon",
    "Call events": "Dogodki klica",
    "Recent calls": "Nedavni klici",
    "Checking…": "Preverjam…",
    "Answer incoming calls for me": "Dohodne klice sprejmi namesto mene",
    "Answers on behalf of": "Odgovarja v imenu",
    "Your name": "Vaše ime",
    "Voice": "Glas",
    "About you": "O vas",
    "The assistant uses this on calls and shares only what's written here. Applies from the next call.": "Pomočnik to uporabi v klicu in pove samo to, kar je zapisano tukaj. Velja od naslednjega klica.",
    "Save": "Shrani",
    "Messages": "Sporočila",
    "Link an Android phone to this server and keep an eye on it. The phone connects out to the server, so it works on Wi-Fi or mobile data from anywhere.": "Povežite telefon Android s tem strežnikom in ga imejte na očeh. Telefon se sam poveže na strežnik, zato deluje po Wi-Fi ali mobilnih podatkih od koder koli.",
    "Pairing QR code": "Koda QR za seznanitev",
    "Creating code…": "Ustvarjam kodo…",
    "Connect a phone": "Povežite telefon",
    "Install the OpenLine app on the Android phone and make it the default phone app.": "Namestite aplikacijo OpenLine na telefon Android in jo nastavite kot privzeto telefonsko aplikacijo.",
    "Finish the setup steps in the app. The phone shows up below when it connects.": "Dokončajte korake v aplikaciji. Telefon se spodaj pokaže, ko se poveže.",
    "Address the phone uses to reach this server": "Naslov, na katerem telefon doseže ta strežnik",
    "New code": "Nova koda",
    "Phones can't reach localhost. Use your Tailscale Funnel or Cloudflare Tunnel address (save it in Settings).": "Telefoni ne dosežejo localhost. Uporabite naslov Tailscale Funnel ali Cloudflare Tunnel (shranite ga v nastavitvah).",
    "Phones": "Telefoni",
    "Endpoints": "Končne točke",
    "The documentation site isn't published yet. Once it is, set its address in Settings and this link opens it.": "Spletna dokumentacija še ni objavljena. Ko bo, njen naslov vpišite v nastavitvah in ta povezava jo odpre.",
    "Set docs address": "Nastavi naslov dokumentacije",
    "AI assistant": "Pomočnik UI",
    "Gemini API key": "Ključ Gemini API",
    "AIza…": "AIza…",
    "Live model": "Model v živo",
    "Get a key at aistudio.google.com. It never leaves this server.": "Ključ dobite na aistudio.google.com. S tega strežnika ne odide.",
    "Remove key": "Odstrani ključ",
    "Incoming calls": "Dohodni klici",
    "Stream to your agent": "Tok do vašega agenta",
    "Audio format": "Oblika zvoka",
    "Raw: 16 kHz PCM, binary frames": "Surovo: 16 kHz PCM, dvojiški okvirji",
    "Twilio Media Streams: 8 kHz mu-law JSON (Pipecat and others)": "Twilio Media Streams: 8 kHz mu-law JSON (Pipecat in drugi)",
    "When set, every incoming call is answered and connected to this WebSocket. Your agent ends the call by closing the socket. Leave empty to handle calls yourself or with the built-in assistant.": "Ko je nastavljeno, je vsak dohodni klic sprejet in povezan na ta WebSocket. Agent klic konča tako, da vtičnico zapre. Pustite prazno, če klice vodite sami ali z vgrajenim pomočnikom.",
    "Public address": "Javni naslov",
    "Your Tailscale Funnel or Cloudflare Tunnel URL. Phones and webhooks use it.": "Naslov Tailscale Funnel ali Cloudflare Tunnel. Uporabljajo ga telefoni in webhooki.",
    "Default webhook": "Privzeti webhook",
    "Docs address": "Naslov dokumentacije",
    "API keys": "Ključi API",
    "Name, e.g. sales agent": "Ime, npr. prodajni agent",
    "Create": "Ustvari",
    "Copy": "Kopiraj",
    "Copied": "Kopirano",
    "Select and copy": "Izberite in kopirajte",
    "Select the key and copy it": "Izberite ključ in ga kopirajte",
    "Account": "Račun",
    "Current password": "Trenutno geslo",
    "New password": "Novo geslo",
    "Changing it signs you out in every other browser.": "Sprememba vas odjavi v vseh drugih brskalnikih.",
    "Sign out": "Odjava",
    "Change password": "Spremeni geslo",
    "Password changed.": "Geslo je spremenjeno.",
    "People with access": "Ljudje z dostopom",
    "Add someone": "Dodajte osebo",
    "Add": "Dodaj",
    "They sign in with this email and password. Share the password privately.": "Prijavijo se s tem e-poštnim naslovom in geslom. Geslo delite zasebno.",
    "Calling…": "Kličem…",
    "Ringing": "Zvonjenje",
    "On call": "V klicu",
    "On hold": "Na čakanju",
    "Call ended": "Klic končan",
    "Declined": "Zavrnjeno",
    "Call failed": "Klic ni uspel",
    "Ready": "Pripravljeno",
    "Phone offline": "Telefon ni na liniji",
    "Connect a phone to place and receive calls.": "Povežite telefon, da kličete in sprejemate.",
    "No events yet.": "Še ni dogodkov.",
    "No phone online. Check the Connection page.": "Noben telefon ni na liniji. Preverite stran Povezava.",
    "No calls yet. Dial a number above, or wait for one to come in.": "Še ni klicev. Zgoraj vpišite številko ali počakajte na dohodni klic.",
    "Open": "Odpri",
    "Signed in as": "Prijavljeni ste kot",
    "Public address": "Javni naslov",
    "So the phone can reach this server from anywhere.": "Da telefon doseže ta strežnik od koder koli.",
    "Scan the QR code with the OpenLine app.": "Kodo QR preberite z aplikacijo OpenLine.",
    "Create an API key": "Ustvarite ključ API",
    "For your apps and agents.": "Za vaše aplikacije in agente.",
    "Add a Gemini key": "Dodajte ključ Gemini",
    "Optional. Turns on the built-in AI assistant.": "Neobvezno. Vklopi vgrajenega pomočnika.",
    "Answers calls, asks who is calling and why, and leaves you a message.": "Sprejema klice, vpraša, kdo kliče in zakaj, ter vam pusti sporočilo.",
    "Off until you add a Gemini API key in ": "Izklopljeno, dokler ne dodate ključa Gemini API v ",
    "Wasn't used on this call.": "V tem klicu ni bil uporabljen.",
    "Joining when the call connects…": "Pridruži se, ko se klic poveže…",
    "Joining…": "Pridružujem…",
    "Talking with the caller.": "Govori s klicateljem.",
    "Finished.": "Končano.",
    "Take over from assistant": "Prevzemi od pomočnika",
    "Messages the assistant takes for you show up here.": "Sporočila, ki jih pomočnik sprejme za vas, se pokažejo tukaj.",
    "Urgent. ": "Nujno. ",
    "Unknown caller": "Neznan klicatelj",
    "Didn't say why they called.": "Ni povedal, zakaj kliče.",
    "Code expired. Get a new one.": "Koda je potekla. Pridobite novo.",
    "Wi-Fi": "Wi-Fi",
    "Mobile data": "Mobilni podatki",
    "Ethernet": "Ethernet",
    "None": "Brez",
    "Stopped": "Ustavljeno",
    "Not set up": "Ni nastavljeno",
    "Unsupported": "Ni podprto",
    "Unknown": "Neznano",
    "No phones yet. Scan the code above with the OpenLine app.": "Še ni telefonov. Kodo zgoraj preberite z aplikacijo OpenLine.",
    "Remove this phone? It will need to scan a new code to reconnect.": "Odstranim ta telefon? Za novo povezavo bo moral prebrati novo kodo.",
    "Remove": "Odstrani",
    "Response time": "Odzivni čas",
    "Network": "Omrežje",
    "Signal": "Signal",
    "Battery": "Baterija",
    "Call audio": "Zvok klica",
    "Last report": "Zadnje poročilo",
    "Call audio needs the phone on Wi-Fi once to start. Open the OpenLine app on the phone.": "Zvok klica se zažene, ko je telefon enkrat na Wi-Fi. Odprite aplikacijo OpenLine na telefonu.",
    "Shown values are from the last report before it went offline.": "Prikazane vrednosti so iz zadnjega poročila, preden je šel z linije.",
    "REST API": "REST API",
    "Phone channel": "Kanal telefona",
    "Call audio": "Zvok klica",
    "(you)": "(vi)",
    "Remove this person's access? They're signed out at once.": "Odstranim dostop tej osebi? Takoj bo odjavljena.",
    "Not set. The AI assistant is off.": "Ni nastavljeno. Pomočnik UI je izklopljen.",
    "Saved. New calls use these settings.": "Shranjeno. Novi klici uporabljajo te nastavitve.",
    "Remove the saved Gemini key?": "Odstranim shranjeni ključ Gemini?",
    "Gemini key removed.": "Ključ Gemini je odstranjen.",
    "Replace the incoming stream URL? This redirects call audio.": "Zamenjam naslov dohodnega toka? To preusmeri zvok klica.",
    "Saved. Incoming calls go to your agent.": "Shranjeno. Dohodni klici gredo vašemu agentu.",
    "Saved. Incoming calls aren't streamed.": "Shranjeno. Dohodni klici se ne pretakajo.",
    "Saved.": "Shranjeno.",
    "Revoke": "Prekliči",
    "Revoke this key? Apps using it stop working at once.": "Prekličem ta ključ? Aplikacije, ki ga uporabljajo, takoj nehajo delovati.",
    "No API keys yet. The key in server\\.env also works.": "Še ni ključev API. Deluje tudi ključ v server\\.env.",
    "never used": "nikoli uporabljen",
    "Connecting…": "Povezujem…",
    "Waiting for the phone…": "Čakam na telefon…",
    "Live. You're talking from this laptop.": "V živo. Govorite s tega prenosnika.",
    "The phone stopped sending audio.": "Telefon je nehal pošiljati zvok.",
    "Off.": "Izklopljeno.",
    "Stop laptop audio": "Ustavi zvok prenosnika",
    "Listening. Nobody on the call can hear you.": "Poslušate. Nihče v klicu vas ne sliši.",
    "Stop listening": "Nehaj poslušati",
    "Unknown number": "Neznana številka",
    "just now": "pravkar",
    "Saved. The assistant won't answer calls.": "Shranjeno. Pomočnik ne bo sprejemal klicev.",
    "Place a call from a phone": "Opravi klic s telefona",
    "List calls, newest first (filter, page with ?before=)": "Seznam klicev, najnovejši prvi (filter, stran z ?before=)",
    "One call and its media stream info": "En klic in podatki o medijskem toku",
    "Answer, also reject, hangup, hold, unhold, dtmf": "Sprejmi, tudi zavrni, odloži, zadrži, nadaljuj, dtmf",
    "Connect a live call to your agent's WebSocket": "Poveži živi klic na WebSocket vašega agenta",
    "Or join the call audio yourself, 16 kHz PCM": "Ali se sami pridružite zvoku klica, 16 kHz PCM",
    "Event timeline of a call": "Časovnica dogodkov klica",
    "What the assistant and caller said": "Kaj sta povedala pomočnik in klicatelj",
    "Hand a call to the AI assistant": "Predaj klic pomočniku UI",
    "Phones with live health": "Telefoni z živim stanjem",
    "Webhook attempts and failures": "Poskusi in napake webhookov",
    "https://your-machine.ts.net": "https://vas-racunalnik.ts.net",
    "https://example.com/gateway/events": "https://example.com/gateway/events",
    "https://docs.example.com": "https://docs.example.com",
    "wss://192.168.1.20:8080/api/voice/stream": "wss://192.168.1.20:8080/api/voice/stream",
    "gemini-3.8-live": "gemini-3.8-live",
    "Alex is a software developer. If someone calls about the bike service, he'll pick it up on Saturday. Family can text him if it's urgent. Don't book meetings for him.": "Alex je razvijalec. Če kdo kliče zaradi servisa kolesa, ga prevzame v soboto. Družina mu lahko piše, če je nujno. Sestankov mu ne dogovarjaj.",
    "· Online": "· Na liniji",
    "Set. The assistant is available.": "Nastavljeno. Pomočnik je na voljo.",
    "Set in server\\.env. The assistant is available.": "Nastavljeno v server\\.env. Pomočnik je na voljo.",
  };

  const HTML_SL = {
    setupHint: "Strežnik odpirate prek javnega naslova, zato dokažite, da je vaš: prilepite <code>HTTP_GATEWAY_API_KEY</code> iz <code>server\\.env</code>. Na računalniku strežnika to ni potrebno.",
    clearHint: "Pošljite <code>clear</code>, da prekinete čakajoči govor, ko klicatelj vskoči. Tudi dohodni klici lahko gredo vašemu agentu: naslov nastavite v nastavitvah.",
    settingsLede: "Shranjeno v bazi strežnika. Vrednosti tukaj preglasijo <code>server\\.env</code>.",
    webhookHint: "Dobiva vsak dogodek klica, podpisan z HMAC-SHA256. Lastni <code>webhookUrl</code> klica ima prednost.",
    apiKeyIntro: "Vsaki aplikaciji ali agentu dajte svoj ključ, da enega prekličete, ne da bi se dotaknili ostalih. Pošljite ga kot <code>Authorization: Bearer <key></code>.",
    copyKeyNow: "<b>Ta ključ kopirajte zdaj.</b> Ne bo več prikazan.",
    scanStep: "Odprite aplikacijo in tapnite <b>Skeniraj QR</b> ali to kodo preberite s kamero telefona.",
  };

  const PATTERNS = [
    [/^(.*) online$/, (m) => `${m[1]} je na liniji`],
    [/^(.*) offline$/, (m) => `${m[1]} ni na liniji`],
    [/^Code works for (\d+:\d{2})$/, (m) => `Koda velja še ${m[1]}`],
    [/^(\d+) of (\d+) online$/, (m) => `${m[1]} od ${m[2]} na liniji`],
    [/^(\d+) min ago$/, (m) => `pred ${m[1]} min`],
    [/^(\d+) h ago$/, (m) => `pred ${m[1]} h`],
    [/^Signed in as (.+)\.$/, (m) => `Prijavljeni ste kot ${m[1]}.`],
    [/^(\d+) paired$/, (m) => `Seznanjenih: ${m[1]}`],
    [/^Stopped: (.+)$/, (m) => `Ustavljeno: ${m[1]}`],
    [/^Couldn't start: (.+)$/, (m) => `Zagon ni uspel: ${m[1]}`],
    [/^Saved\. The assistant answers calls for (.+)\.$/, (m) => `Shranjeno. Pomočnik dviguje klice za ${m[1]}.`],
    [/^(.+) connected$/, (m) => `${m[1]} je povezan`],
    [/^(.+) can now sign in\.$/, (m) => `${m[1]} se zdaj lahko prijavi.`],
    [/^(.*), incoming$/, (m) => `${translateString(m[1])}, dohodni`],
    [/^· Offline, last seen (.+)$/, (m) => `· Ni na liniji, nazadnje ${translateString(m[1])}`],
    [/^Created (.+) · used (.+)$/, (m) => `Ustvarjen ${translateString(m[1])} · uporabljen ${translateString(m[2])}`],
    [/^Created (.+) · never used$/, (m) => `Ustvarjen ${translateString(m[1])} · nikoli uporabljen`],
    [/^Added (.+)$/, (m) => `Dodan ${translateString(m[1])}`],
    [/^Call back on (.+)\. $/, (m) => `Pokličite nazaj na ${m[1]}. `],
    [/^From (.+), (.+)$/, (m) => `Od ${m[1]}, ${translateString(m[2])}`],
    [/^Not set \(using (.+)\)$/, (m) => `Ni nastavljeno (uporabljam ${m[1]})`],
    [/^Saved key (.+)\. Paste a new one to replace it\.$/, (m) => `Shranjen ključ ${m[1]}. Prilepite novega, da ga zamenjate.`],
    [/^Request failed \((\d+)\)$/, (m) => `Zahteva ni uspela (${m[1]})`],
    [/^(\d+)%, charging$/, (m) => `${m[1]} %, polnjenje`],
    [/^Off until you add a Gemini API key in Settings\.$/, () => "Izklopljeno, dokler v nastavitvah ne dodate ključa Gemini API."],
  ];

  function mode() {
    const stored = localStorage.getItem(KEY) || "system";
    if (stored === "en" || stored === "sl" || stored === "system") return stored;
    return "system";
  }

  function resolved() {
    const chosen = mode();
    if (chosen === "en" || chosen === "sl") return chosen;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
    return String(nav).toLowerCase().startsWith("sl") ? "sl" : "en";
  }

  function translateString(input) {
    if (input == null) return input;
    const text = String(input);
    if (resolved() !== "sl") return text;
    if (Object.prototype.hasOwnProperty.call(SL, text)) return SL[text];
    const trimmed = text.trim();
    if (trimmed !== text && Object.prototype.hasOwnProperty.call(SL, trimmed)) {
      return text.replace(trimmed, SL[trimmed]);
    }
    for (const [re, fn] of PATTERNS) {
      const match = trimmed.match(re);
      if (match) return text.replace(trimmed, fn(match));
    }
    return text;
  }

  const attrEn = new WeakMap();

  function translateAttr(el, name) {
    const current = el.getAttribute(name);
    if (current == null) return;
    let bag = attrEn.get(el);
    if (!bag) {
      bag = {};
      attrEn.set(el, bag);
    }
    const prev = bag[name];
    if (prev === undefined) bag[name] = current;
    else if (current !== prev && current !== translateString(prev)) bag[name] = current;
    const next = translateString(bag[name]);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }

  function skipNode(node) {
    const el = node.parentElement;
    if (!el) return true;
    if (el.closest("button")) return false;
    if (el.closest("script, style, pre, .code-block, [data-i18n]")) return true;
    if (el.closest("#qr, #pairCode, #lineNumber, #timer, #newKeyValue, #accountEmail, #aboutCount, #msgCount, #callEvents")) return true;
    return false;
  }

  function translateTextNode(node) {
    if (skipNode(node)) return;
    if (node.__olEn === undefined) node.__olEn = node.nodeValue;
    else {
      const current = node.nodeValue;
      const prev = node.__olEn;
      if (current !== prev && current !== translateString(prev)) node.__olEn = current;
    }
    const next = translateString(node.__olEn);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateHtmlBlocks() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.__olHtml === undefined) el.__olHtml = el.innerHTML;
      const key = el.getAttribute("data-i18n");
      const next = resolved() === "sl" && HTML_SL[key] ? HTML_SL[key] : el.__olHtml;
      if (el.innerHTML !== next) el.innerHTML = next;
    });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      translateAttr(root, "placeholder");
      translateAttr(root, "aria-label");
      translateAttr(root, "title");
    }
    const kids = root.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  }

  let applying = false;
  function applyAll() {
    if (applying) return;
    applying = true;
    try {
      document.documentElement.lang = resolved() === "sl" ? "sl" : "en";
      const stored = mode();
      document.querySelectorAll("select.ol-lang").forEach((sel) => {
        if (sel.value !== stored) sel.value = stored;
      });
      translateHtmlBlocks();
      walk(document.body);
    } finally {
      applying = false;
    }
  }

  const observer = new MutationObserver((records) => {
    if (applying) return;
    applying = true;
    try {
      for (const record of records) {
        if (record.type === "characterData" && record.target.nodeType === Node.TEXT_NODE) {
          translateTextNode(record.target);
        } else if (record.type === "childList") {
          record.addedNodes.forEach((node) => walk(node));
        } else if (record.type === "attributes" && record.target.nodeType === Node.ELEMENT_NODE) {
          translateAttr(record.target, record.attributeName);
        }
      }
    } finally {
      applying = false;
    }
  });

  window.t = translateString;
  window.openlineLang = resolved;

  function boot() {
    applyAll();
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title"],
    });
    document.addEventListener("change", (event) => {
      const el = event.target;
      if (!el || !el.classList || !el.classList.contains("ol-lang")) return;
      const value = el.value === "en" || el.value === "sl" ? el.value : "system";
      localStorage.setItem(KEY, value);
      applyAll();
    });
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
