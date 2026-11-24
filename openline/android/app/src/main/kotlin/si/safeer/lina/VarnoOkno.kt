package si.safeer.lina

import android.app.AlertDialog

/**
 * Potrditveno okno, ki zavrne dotike skozi prekrivno plast druge aplikacije (najdba N5, kraja dotikov). Zascita je na korenskem
 * pogledu okna, zato velja za vse gumbe in kljukico; nastavi se takoj po show() (prej okno se nima pogleda).
 */
fun AlertDialog.Builder.pokaziVarno(): AlertDialog =
    show().also { it.window?.decorView?.filterTouchesWhenObscured = true }
