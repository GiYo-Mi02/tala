package expo.modules.talaocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import java.io.File
import java.util.UUID
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Source pixels have already been made upright by Expo ImageManipulator. */
internal object Perspective {
  const val WIDTH = 1600
  const val HEIGHT = 2263

  fun validate(points: List<Pair<Double, Double>>, width: Int, height: Int) {
    require(width > 0 && height > 0 && points.size == 4 && points.all {
      it.first.isFinite() && it.second.isFinite() && it.first in 0.0..1.0 && it.second in 0.0..1.0
    }) { "Select four corners inside the photo." }
    val p = points.map { Pair(it.first * width, it.second * height) }
    for (i in 0..3) {
      val a = p[i]; val b = p[(i + 1) % 4]; val c = p[(i + 2) % 4]
      require((b.first - a.first) * (c.second - b.second) - (b.second - a.second) * (c.first - b.first) > 1) {
        "Select corners clockwise: top left, top right, bottom right, bottom left."
      }
    }
    require(p[0].first + p[3].first < p[1].first + p[2].first && p[0].second + p[1].second < p[2].second + p[3].second) {
      "Rotate the photo upright, then select top left, top right, bottom right, bottom left."
    }
    fun edge(a: Int, b: Int) = hypot(p[a].first - p[b].first, p[a].second - p[b].second)
    require(min(edge(0, 1), edge(3, 2)) >= 700 && min(edge(0, 3), edge(1, 2)) >= 950) {
      "The paper is too small for reliable field reading. Retake closer."
    }
    val area = p.indices.sumOf { i -> p[i].first * p[(i + 1) % 4].second - p[i].second * p[(i + 1) % 4].first } / 2
    val bounds = (p.maxOf { it.first } - p.minOf { it.first }) * (p.maxOf { it.second } - p.minOf { it.second })
    require(area >= bounds * 0.1) { "This selection is too narrow. Retake facing the paper more directly." }
  }

  fun rectify(context: Context, uri: String, points: List<Pair<Double, Double>>): Map<String, Any> {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file" && parsed.authority.isNullOrEmpty()) { "Alignment requires a local image." }
    val source = File(requireNotNull(parsed.path)).canonicalFile
    require(listOf(context.cacheDir, context.filesDir).any { source.path.startsWith(it.canonicalPath + File.separator) }) {
      "Alignment requires an image in private app storage."
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    validate(points, bounds.outWidth, bounds.outHeight)
    val options = BitmapFactory.Options().apply {
      inSampleSize = 1
      while (max(bounds.outWidth, bounds.outHeight) / inSampleSize > 4096) inSampleSize *= 2
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val input = requireNotNull(BitmapFactory.decodeFile(source.path, options)) { "The saved image could not be opened." }
    var output: Bitmap? = null
    val target = File(context.cacheDir, "tala-aligned-${UUID.randomUUID()}.jpg")
    try {
      val src = points.flatMap { listOf((it.first * (input.width - 1)).toFloat(), (it.second * (input.height - 1)).toFloat()) }.toFloatArray()
      val dst = floatArrayOf(0f, 0f, (WIDTH - 1).toFloat(), 0f, (WIDTH - 1).toFloat(), (HEIGHT - 1).toFloat(), 0f, (HEIGHT - 1).toFloat())
      val matrix = Matrix()
      require(matrix.setPolyToPoly(src, 0, dst, 0, 4)) { "The paper corners could not be aligned." }
      val rendered = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
      output = rendered
      Canvas(rendered).apply {
        drawColor(Color.WHITE)
        drawBitmap(input, matrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
      }
      target.outputStream().use { check(rendered.compress(Bitmap.CompressFormat.JPEG, 95, it)) { "The aligned image could not be saved." } }
      return mapOf("uri" to Uri.fromFile(target).toString(), "width" to WIDTH, "height" to HEIGHT)
    } catch (e: Throwable) {
      target.delete()
      throw e
    } finally {
      input.recycle()
      output?.recycle()
    }
  }
}
