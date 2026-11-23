// @ts-nocheck
// Rekonstruirano iz prevoda nameščene Line (20. 11. 2026): izvirni .ts je bil izbrisan; tipi niso ohranjeni.
/** Najvecje sporocilo Twilio v bajtih (v prevedeni gradnji vstavljeno kot 16384). */
var MEJA_SPOROCILA_TWILIO = 16384;
var SID = /^[A-Za-z0-9_-]{3,64}$/;
function jeNiz(v, najvec) {
	return typeof v === "string" && v.length <= najvec;
}
/** Razbere eno sporocilo Twilio. Napaka vrne samo razlog (koda), nikoli vsebine. */
function razberiTwilio(surovo) {
	if ((typeof surovo === "string" ? Buffer.byteLength(surovo, "utf8") : surovo.length) > MEJA_SPOROCILA_TWILIO) return {
		ok: false,
		razlog: "prevelik"
	};
	let obj;
	try {
		obj = JSON.parse(typeof surovo === "string" ? surovo : Buffer.from(surovo).toString("utf8"));
	} catch {
		return {
			ok: false,
			razlog: "oblika"
		};
	}
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {
		ok: false,
		razlog: "oblika"
	};
	const o = obj;
	switch (o.event) {
		case "connected": return {
			ok: true,
			dogodek: { event: "connected" }
		};
		case "stop": return {
			ok: true,
			dogodek: { event: "stop" }
		};
		case "dtmf": return {
			ok: true,
			dogodek: { event: "dtmf" }
		};
		case "mark": {
			const mark = o.mark;
			if (!mark || !jeNiz(mark.name, 80)) return {
				ok: false,
				razlog: "oblika"
			};
			return {
				ok: true,
				dogodek: {
					event: "mark",
					ime: mark.name
				}
			};
		}
		case "start": {
			const start = o.start;
			if (!start || typeof start !== "object") return {
				ok: false,
				razlog: "oblika"
			};
			const streamSid = start.streamSid ?? o.streamSid;
			if (!jeNiz(streamSid, 64) || !SID.test(streamSid)) return {
				ok: false,
				razlog: "oblika"
			};
			if (!jeNiz(start.callSid, 64) || !SID.test(start.callSid)) return {
				ok: false,
				razlog: "oblika"
			};
			const format = start.mediaFormat;
			if (!format || format.encoding !== "audio/x-mulaw" || Number(format.sampleRate) !== 8e3) return {
				ok: false,
				razlog: "format"
			};
			const parametri = start.customParameters;
			const zeton = parametri && typeof parametri === "object" ? parametri.zeton : void 0;
			return {
				ok: true,
				dogodek: {
					event: "start",
					start: {
						streamSid,
						callSid: start.callSid,
						zeton: jeNiz(zeton, 200) ? zeton : ""
					}
				}
			};
		}
		case "media": {
			const media = o.media;
			if (!media || typeof media !== "object") return {
				ok: false,
				razlog: "oblika"
			};
			if (media.track !== void 0 && media.track !== "inbound") return {
				ok: false,
				razlog: "dogodek"
			};
			const nosilnost = media.payload;
			if (!jeNiz(nosilnost, Math.ceil(16384 / 3) + 4) || !/^[A-Za-z0-9+/]*={0,2}$/.test(nosilnost)) return {
				ok: false,
				razlog: "oblika"
			};
			const zvok = new Uint8Array(Buffer.from(nosilnost, "base64"));
			if (zvok.length === 0 || zvok.length > 4096) return {
				ok: false,
				razlog: "oblika"
			};
			return {
				ok: true,
				dogodek: {
					event: "media",
					zvok,
					sled: String(media.chunk ?? "")
				}
			};
		}
		default: return {
			ok: false,
			razlog: "dogodek"
		};
	}
}
function twilioMedia(streamSid, okvir) {
	return JSON.stringify({
		event: "media",
		streamSid,
		media: { payload: Buffer.from(okvir).toString("base64") }
	});
}
function twilioMark(streamSid, ime) {
	return JSON.stringify({
		event: "mark",
		streamSid,
		mark: { name: ime }
	});
}
function twilioClear(streamSid) {
	return JSON.stringify({
		event: "clear",
		streamSid
	});
}
export { MEJA_SPOROCILA_TWILIO, SID, jeNiz, razberiTwilio, twilioMedia, twilioMark, twilioClear };
