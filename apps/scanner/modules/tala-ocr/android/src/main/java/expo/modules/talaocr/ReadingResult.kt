package expo.modules.talaocr

import android.graphics.Rect
import com.google.mlkit.vision.text.Text
import java.util.Locale

internal data class ElementReading(val text: String, val box: Rect?)
internal data class LineReading(val text: String, val box: Rect?, val elements: List<ElementReading> = emptyList())
internal data class FieldReading(val text: String, val readingText: String, val elements: List<Map<String, Any>>) {
  fun bridge(): Map<String, Any> = mapOf("text" to text, "readingText" to readingText, "elements" to elements)
}

internal object ReadingResult {
  private fun compact(text: String) = text.replace(Regex("\\s+"), "").uppercase(Locale.ROOT)
  /** A mapped crop is one input row. ML Kit can return the same glyphs in nested lines. */
  fun distinct(lines: List<LineReading>): List<LineReading> {
    val kept = mutableListOf<LineReading>()
    for (line in lines.sortedByDescending { (it.box?.width() ?: 0) * (it.box?.height() ?: 0) }) {
      val box = line.box
      val duplicate = box != null && box.width() > 0 && box.height() > 0 && kept.any { other ->
        val outer = other.box
        if (outer == null || !compact(other.text).contains(compact(line.text)) || compact(line.text).isEmpty()) false
        else {
          val intersection = Rect(box)
          intersection.intersect(outer) && intersection.width().toDouble() * intersection.height() / (box.width().toDouble() * box.height()) >= 0.85
        }
      }
      if (!duplicate) kept.add(line)
    }
    return kept.sortedBy { it.box?.left ?: 0 }
  }

  fun from(result: Text, prepared: PreparedField): FieldReading {
    val lines = distinct(result.textBlocks.flatMap { it.lines }.map { line ->
      LineReading(line.text, line.boundingBox, line.elements.map { ElementReading(it.text, it.boundingBox) })
    })
    val sx = prepared.sourceWidth.toDouble() / prepared.contentWidth
    val sy = prepared.sourceHeight.toDouble() / prepared.contentHeight
    val elements = lines.flatMap { it.elements }.map { e ->
      mapOf<String, Any>("text" to e.text,
        "x" to (((e.box?.left ?: prepared.inset) - prepared.inset) * sx),
        "y" to (((e.box?.top ?: prepared.inset) - prepared.inset) * sy),
        "width" to ((e.box?.width() ?: 0) * sx), "height" to ((e.box?.height() ?: 0) * sy))
    }
    return FieldReading(result.text, lines.joinToString(" ") { it.text }, elements)
  }
}
