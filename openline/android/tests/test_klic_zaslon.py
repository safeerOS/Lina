"""Zaslon dohodnega klica (lastnik 19. 11. 2026): ime iz imenika in samo en gumb za konec klica."""
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[1] / "app/src/main"
KOT = SRC / "kotlin/si/safeer/lina"


def test_koncaj_klic_ni_viden_med_zvonjenjem():
    """Med zvonjenjem sta bila hkrati Zavrni in Koncaj klic (isti ukaz dvakrat)."""
    s = (KOT / "InCallActivity.kt").read_text(encoding="utf-8")
    assert re.search(r"endButton\.visibility = if \(state == Call\.STATE_RINGING\) View\.GONE else View\.VISIBLE", s)
    assert 'findViewById<Button>(R.id.endButton).setOnClickListener' not in s


def test_ime_iz_imenika_na_zaslonu_in_v_obvestilih():
    c = (KOT / "ContactSearch.kt").read_text(encoding="utf-8")
    assert "fun nameOf(" in c and "PhoneLookup.DISPLAY_NAME" in c and "READ_CONTACTS" in c.split("fun nameOf(")[1].split("fun isKnown")[0]
    a = (KOT / "InCallActivity.kt").read_text(encoding="utf-8")
    assert "contactLookup.nameOf(" in a and "nameText.text" in a
    assert "@+id/nameText" in (SRC / "res/layout/activity_in_call.xml").read_text(encoding="utf-8")
    for n in ("IncomingCallNotice.kt", "MissedCallNotice.kt"):
        assert "ContactSearch(context).nameOf(number)" in (KOT / "telecom" / n).read_text(encoding="utf-8"), n
