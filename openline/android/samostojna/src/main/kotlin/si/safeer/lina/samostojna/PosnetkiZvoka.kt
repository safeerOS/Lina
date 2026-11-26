package si.safeer.lina.samostojna

import java.io.File
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/**
 * Lastnikovo pravilo »nikoli posnetek zvoka« (slepi pregled 0214 A4): razlicice do 0.2.13 so zapisovale Linin izhodni zvok v
 * <files>/lina_zvok/zajem (zadnjih 5 klicev). Ob zagonu aplikacije se mapa izbrise; povezavam se ne sledi (izbrise se samo povezava).
 * true = mapa je obstajala in je izbrisana.
 */
fun izbrisiStarePosnetkeZvoka(files: File): Boolean {
    // Povezavi se ne sledi niti na ravni lina_zvok (slepi pregled 21t, #6).
    if (Files.isSymbolicLink(File(files, "lina_zvok").toPath())) return false
    val mapa = File(files, "lina_zvok/zajem").toPath()
    if (!Files.exists(mapa, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return false
    if (!Files.isDirectory(mapa, java.nio.file.LinkOption.NOFOLLOW_LINKS)) { Files.delete(mapa); return true }
    Files.walkFileTree(mapa, object : SimpleFileVisitor<Path>() {
        override fun visitFile(f: Path, a: BasicFileAttributes): FileVisitResult { Files.delete(f); return FileVisitResult.CONTINUE }
        override fun postVisitDirectory(d: Path, e: IOException?): FileVisitResult { if (e != null) throw e; Files.delete(d); return FileVisitResult.CONTINUE }
    })
    return true
}
