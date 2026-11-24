#!/usr/bin/env python3
"""Najmanjsi veljaven PDF z eno stranjo in besedilom (za preverbo paketa). Uporaba: preverba-paketa-pdf.py <izhod.pdf> [besedilo]"""
import sys

besedilo = sys.argv[2] if len(sys.argv) > 2 else "Pozdrav Lina PDF"
# Pisava Helvetica brez kodiranja: samo izpisljiv ASCII (sumniki bi dali napacne znake); sicer jasna zavrnitev, brez datoteke.
if not all(" " <= z <= "~" for z in besedilo):
    print("NAPAKA: besedilo za vzorec PDF mora biti izpisljiv ASCII (brez sumnikov in kontrolnih znakov).", file=sys.stderr)
    sys.exit(2)
# Niz PDF v oklepajih: \, ( in ) morajo biti ubezani, sicer je operator Tj neveljaven.
ubezano = besedilo.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
tok = f"BT /F1 18 Tf 50 700 Td ({ubezano}) Tj ET".encode("ascii")
predmeti = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    b"<< /Length %d >>\nstream\n" % len(tok) + tok + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
izhod = bytearray(b"%PDF-1.4\n")
odmiki = []
for i, p in enumerate(predmeti, 1):
    odmiki.append(len(izhod))
    izhod += b"%d 0 obj\n" % i + p + b"\nendobj\n"
xref = len(izhod)
izhod += b"xref\n0 %d\n0000000000 65535 f \n" % (len(predmeti) + 1)
for o in odmiki:
    izhod += b"%010d 00000 n \n" % o
izhod += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(predmeti) + 1, xref)
with open(sys.argv[1], "wb") as f:
    f.write(izhod)
