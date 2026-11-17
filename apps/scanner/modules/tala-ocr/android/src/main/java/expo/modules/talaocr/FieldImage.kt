package expo.modules.talaocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Canvas
import android.net.Uri
import java.io.File
import kotlin.math.roundToInt

internal data class PreparedField(val bitmap: Bitmap, val sourceWidth: Int, val sourceHeight: Int, val contentWidth: Int, val contentHeight: Int, val inset: Int)

/** Remove long printed rules, preserving shorter typed character strokes. Never edit OCR characters. */
internal object FieldImage {
  fun prepare(uri: String): PreparedField {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "OCR requires a local image." }
    val path = File(requireNotNull(parsed.path)).path
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    require(bounds.outWidth in 1..12000 && bounds.outHeight in 1..512) { "The field image has invalid dimensions." }
    val input = requireNotNull(BitmapFactory.decodeFile(path)) { "The field image could not be opened." }
    try {
      val w = input.width; val h = input.height
      require(w > 0 && h > 0 && w <= 12000 && h <= 512) { "The field image has invalid dimensions." }
      val pixels = IntArray(w * h)
      input.getPixels(pixels, 0, w, 0, 0, w, h)
      fun dark(value: Int) = Color.red(value) * 299 + Color.green(value) * 587 + Color.blue(value) * 114 < 160000
      val horizontal = BooleanArray(h)
      val vertical = BooleanArray(w)
      // Only outside character-height rows may be removed as horizontal borders.
      for (y in 0 until h) if (y < h * 0.15 || y >= h * 0.85) {
        var count = 0
        for (x in 0 until w) if (dark(pixels[y * w + x])) count++
        if (count >= w * 0.6) for (dy in -1..1) if (y + dy in 0 until h) horizontal[y + dy] = true
      }
      for (x in 0 until w) {
        var count = 0
        for (y in 0 until h) if (dark(pixels[y * w + x])) count++
        if (count >= h * 0.65) for (dx in -1..1) if (x + dx in 0 until w) vertical[x + dx] = true
      }
      for (y in 0 until h) for (x in 0 until w) if (horizontal[y] || vertical[x]) pixels[y * w + x] = Color.WHITE
      val cleaned = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
      try {
        val scaled = Bitmap.createScaledBitmap(cleaned, (w * 52.0 / h).roundToInt().coerceAtLeast(1), 52, true)
        try {
          // A white margin keeps the detector from treating this narrow strip as overlapping text blocks.
          val inset = 32
          val padded = Bitmap.createBitmap(scaled.width + inset * 2, scaled.height + inset * 2, Bitmap.Config.ARGB_8888)
          Canvas(padded).apply { drawColor(Color.WHITE); drawBitmap(scaled, inset.toFloat(), inset.toFloat(), null) }
          return PreparedField(padded, w, h, scaled.width, scaled.height, inset)
        } finally { if (scaled !== cleaned) scaled.recycle() }
      } finally { cleaned.recycle() }
    } finally { input.recycle() }
  }
}
