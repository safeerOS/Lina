package si.safeer.lina

import android.os.Build
import android.view.WindowInsets

/** Odmiki sistemskih vrstic (levo, zgoraj, desno, spodaj). WindowInsets.Type je od Androida 11; minSdk je 29 (pregled 17, B1). */
object SistemskeVrstice {
    fun odmiki(insets: WindowInsets): IntArray =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = insets.getInsets(WindowInsets.Type.systemBars())
            intArrayOf(b.left, b.top, b.right, b.bottom)
        } else {
            @Suppress("DEPRECATION")
            intArrayOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
        }

    /** Visina vidne tipkovnice (0, ce je skrita); do Androida 14 zaslon zmanjsa adjustResize (od 15 naprej ga ne), zato tam 0. */
    fun visinaTipkovnice(insets: WindowInsets): Int =
        if (Build.VERSION.SDK_INT >= 35 && insets.isVisible(WindowInsets.Type.ime())) {
            insets.getInsets(WindowInsets.Type.ime()).bottom
        } else 0
}
