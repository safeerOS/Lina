"""Skeniranje QR je samo v Pripravi (lastnik 19. 11. 2026: »imamo pri Pripravi skeniraj kodo, zakaj je pri Racunalniku«).
Oba gumba sta klicala isto funkcijo scanPairingQr(); v Racunalniku je zdaj samo pot v Pripravo."""
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[1] / "app/src/main"
KOT = SRC / "kotlin/si/safeer/lina/DialerActivity.kt"
JEZIKI = ["values", "values-sl", "values-de", "values-es", "values-fr", "values-it"]


def test_gumb_skeniraj_qr_je_v_layoutu_samo_enkrat():
    s = (SRC / "res/layout/activity_dialer.xml").read_text(encoding="utf-8")
    assert s.count("@string/scan_qr") == 0, "gumb v Racunalniku ne sme skenirati"
    assert "assistantPairButton" not in s
    assert "@+id/assistantOpenSetupButton" in s


def test_scanPairingQr_ima_en_klic_iz_koraka_priprave():
    k = KOT.read_text(encoding="utf-8")
    klici = re.findall(r"\bscanPairingQr\(\)", k)
    # definicija + en klic (korak Priprave); Racunalnik ne sme klicati
    assert len(klici) == 2, klici
    assert "stepServer.action.setOnClickListener { scanPairingQr() }" in k
    assert "assistantOpenSetupButton.setOnClickListener { showTab(Zavihek.TELEFON) }" in k


def test_vsi_jeziki_imajo_pot_v_pripravo():
    for j in JEZIKI:
        s = (SRC / "res" / j / "strings.xml").read_text(encoding="utf-8")
        assert 'name="assistant_open_setup"' in s, j
        assert "2" in re.search(r'name="assistant_no_link">([^<]*)<', s).group(1), j


def test_racunalnik_se_pokaze_samo_ko_ima_opravilo():
    """Zavihek Racunalnik brez opravila ni potreben (lastnik 19. 11. 2026): samo seznanjanje, seznanjen, izid seznanitve."""
    k = KOT.read_text(encoding="utf-8")
    pravilo = k.split("private fun racunalnikPotreben()")[1].split("private fun osveziNavRacunalnik")[0]
    for pogoj in ("st.seznanjen", "st.cakaPotrditev", "iscemLino", "asistent.korakKode != null", "asistent.izidSeznanitve != null"):
        assert pogoj in pravilo, pogoj
    assert "zavihekZdaj == Zavihek.RACUNALNIK" in k.split("private fun osveziNavRacunalnik")[1].split("private fun showTab")[0]
    show = k.split("private fun showTab(")[1].split("private fun renderAssistant")[0]
    assert "osveziNavRacunalnik()" in show
    assert "osveziNavRacunalnik()" in k.split("private fun renderAssistant")[1]


def test_povezava_s_kodo_je_v_pripravi_korak_2():
    lay = (SRC / "res/layout/activity_dialer.xml").read_text(encoding="utf-8")
    i, j, k = lay.index("@+id/stepServer"), lay.index("@+id/setupCodeButton"), lay.index("@+id/stepAudio")
    assert i < j < k
    s = KOT.read_text(encoding="utf-8")
    assert "R.id.setupCodeButton).setOnClickListener { izberiNacinKode() }" in s
    # napredek seznanjanja se vidi v Racunalniku
    assert "showTab(Zavihek.RACUNALNIK); poisciLino(" in s
