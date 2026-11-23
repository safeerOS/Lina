"""Stalni proces RSDO za Lino (lastnik 23. 11. 2026): model se nalozi ENKRAT, nato prepisuje posnetke.

Protokol samo prek stdin/stdout, brez omreznih vrat; vsaka vrstica je en JSON:
  izhod ob nalozenem modelu: {"pripravljen": true}
  vhod:  {"id": "...", "wav": "/pot/do/16k-mono.wav"}
  izhod: {"id": "...", "besedilo": "..."} ali {"id": "...", "napaka": "<vrsta napake>"}
Konec vhoda (Lina je koncala ali padla) = konec procesa, da ne ostane siroce.
Zagon: <python iz venv RSDO> rsdo-streznik.py <pot do .nemo>
"""

import os

# Stars se prebere kot PRVO (pred ostalimi uvozi): Lina, ki umre med zagonom interpreterja, je zaznana (pregled 029b, najdba 5).
_STARS = os.getppid()

import json  # noqa: E402
import signal  # noqa: E402
import sys  # noqa: E402


def _ob_smrti_starsa(stars: int) -> None:
    # Linux: ce Lina umre (tudi SIGKILL), jedro poslje SIGTERM; drugje ostane zaznava konca vhoda.
    try:
        import ctypes

        ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG
    except Exception:
        pass
    # Stars je umrl pred prctl: primerjava s starsem ob zagonu (pod subreaperjem, npr. systemd --user, getppid() ni 1).
    if os.getppid() != stars:
        sys.exit(0)


def main() -> int:
    if len(sys.argv) != 2:
        print("uporaba: rsdo-streznik.py <model.nemo>", file=sys.stderr)
        return 2
    _ob_smrti_starsa(_STARS)
    # Protokol dobi svojo kopijo stdout; knjiznice (NeMo, PyTorch) pisejo na stdout, zato ta gre v stderr.
    protokol = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def poslji(sporocilo: dict) -> None:
        protokol.write(json.dumps(sporocilo, ensure_ascii=False) + "\n")
        protokol.flush()

    import nemo.collections.asr as nemo_asr

    model = nemo_asr.models.ASRModel.restore_from(sys.argv[1], map_location="cpu")
    model.eval()
    poslji({"pripravljen": True})

    for vrstica in sys.stdin:
        ident = None
        try:
            zahteva = json.loads(vrstica)
            ident = zahteva.get("id")
            wav = zahteva["wav"]
            if not isinstance(ident, str) or not isinstance(wav, str):
                raise ValueError("oblika")
            izid = model.transcribe([wav], batch_size=1, verbose=False)
            # razlicice NeMo: seznam nizov, seznam Hypothesis ali par (najboljsi, vsi)
            if isinstance(izid, tuple):
                izid = izid[0]
            prvi = izid[0]
            besedilo = prvi if isinstance(prvi, str) else getattr(prvi, "text", "")
            poslji({"id": ident, "besedilo": str(besedilo)})
        except Exception as e:  # noqa: BLE001 - napaka ene zahteve ne konca procesa
            poslji({"id": ident, "napaka": type(e).__name__})
    return 0


if __name__ == "__main__":
    sys.exit(main())
