package si.safeer.lina.samostojna

private val DEBELO = Regex("""\*\*(.+?)\*\*""")
private val DEBELO2 = Regex("""__(.+?)__""")
private val NASLOV = Regex("""(?m)^\s{0,3}#{1,6}\s+""")
private val ALINEJA = Regex("""(?m)^(\s*)[*\-]\s+""")
private val PRAZNE = Regex("""\n{3,}""")
private val KODA = Regex("""```[\s\S]*?```|`[^`\n]*`""")

/**
 * Odgovor modela je pogosto v Markdownu, pogled pa je navadno besedilo: »**debelo**« bi se prikazalo z zvezdicami (lastnik 23. 11. 2026,
 * posnetek povzetka klicev). Odstrani oznake **, __ in # naslovov, alineje »* « in »- « pretvori v »• «. Vsebina ostane nespremenjena.
 */
fun besediloBrezMarkdowna(s: String): String {
    // Koda (vrstična in ograjena) je dobesedno besedilo: __init__ ostane __init__ (CodeRabbit 23. 11. 2026).
    val koda = ArrayList<String>()
    val zavarovano = s.replace(KODA) { koda.add(it.value); "\u0000${koda.size - 1}\u0000" }
    val urejeno = zavarovano.replace(ALINEJA, "$1• ")
        .replace(DEBELO, "$1")
        .replace(DEBELO2, "$1")
        .replace(NASLOV, "")
        .replace(PRAZNE, "\n\n")
        .trim()
    return Regex("\u0000(\\d+)\u0000").replace(urejeno) { koda[it.groupValues[1].toInt()] }
}
