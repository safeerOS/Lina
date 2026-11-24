"""R6 (NAJDBE 24. 11. 2026): _razred_po_kosih deli po tockah, ne po vrsticah - zelo siroka slika ne potrebuje GB.
Zagon iz korena projekta: python3 scripts/kontrola_tiska_r6_test.py"""
import os
import sys
import tracemalloc
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kontrola_tiska as kt  # noqa: E402

LAB_PAL = kt.rgb2lab((np.array([[0, 0, 255], [0, 255, 0], [255, 0, 0], [0, 0, 0], [255, 255, 255],
                                [0, 255, 255], [255, 0, 255], [255, 255, 0], [128, 128, 128]], np.float64)[:, ::-1] / 255.0)[None])[0]


class R6(unittest.TestCase):
    def test_siroka_slika_brez_velikega_pomnilnika(self):
        bgr = np.random.default_rng(1).integers(0, 256, (1, 1_000_000, 3)).astype(np.float64)
        tracemalloc.start()
        kt._razred_po_kosih(bgr, LAB_PAL)
        _, vrh = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        self.assertLess(vrh, 100 * 1024 * 1024, f"vrh {vrh / 1e6:.0f} MB")

    def test_enak_izid_kot_neposredno(self):
        bgr = np.random.default_rng(2).integers(0, 256, (37, 53, 3)).astype(np.float64)
        prej = np.linalg.norm(kt._lab(bgr)[..., None, :] - LAB_PAL, axis=-1).argmin(axis=-1)
        np.testing.assert_array_equal(kt._razred_po_kosih(bgr, LAB_PAL), prej)


if __name__ == "__main__":
    unittest.main()
