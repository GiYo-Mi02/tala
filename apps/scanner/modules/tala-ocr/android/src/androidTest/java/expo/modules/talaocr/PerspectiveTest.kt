package expo.modules.talaocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

@RunWith(AndroidJUnit4::class)
class PerspectiveTest {
  private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
  private val context get() = instrumentation.targetContext
  private val assets get() = instrumentation.context.assets
  private val full = listOf(0.0 to 0.0, 1.0 to 0.0, 1.0 to 1.0, 0.0 to 1.0)

  private fun save(bitmap: Bitmap): File = File.createTempFile("tala-test-", ".jpg", context.cacheDir).also { file ->
    file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 100, it)) }
  }

  @Test fun perspectiveCorrectionPreservesKnownLandmarks() {
    val page = Bitmap.createBitmap(1600, 2263, Bitmap.Config.ARGB_8888)
    val locations = listOf(400 to 500, 1200 to 500, 400 to 1700, 1200 to 1700)
    val colors = listOf(Color.RED, Color.BLUE, Color.GREEN, Color.BLACK)
    Canvas(page).apply {
      drawColor(Color.WHITE)
      locations.forEachIndexed { i, p -> drawRect((p.first - 50).toFloat(), (p.second - 50).toFloat(), (p.first + 50).toFloat(), (p.second + 50).toFloat(), Paint().apply { color = colors[i] }) }
    }
    val photo = Bitmap.createBitmap(2400, 3000, Bitmap.Config.ARGB_8888)
    val src = floatArrayOf(0f, 0f, 1599f, 0f, 1599f, 2262f, 0f, 2262f)
    val dst = floatArrayOf(300f, 200f, 2100f, 350f, 2250f, 2750f, 150f, 2600f)
    val transform = Matrix().apply { assertTrue(setPolyToPoly(src, 0, dst, 0, 4)) }
    Canvas(photo).apply { drawColor(Color.GRAY); drawBitmap(page, transform, Paint(Paint.FILTER_BITMAP_FLAG)) }
    val file = save(photo)
    var aligned: File? = null
    try {
      val corners = (0..3).map { dst[it * 2] / 2399.0 to dst[it * 2 + 1] / 2999.0 }
      val result = Perspective.rectify(context, Uri.fromFile(file).toString(), corners)
      aligned = File(Uri.parse(result["uri"] as String).path!!)
      val actual = BitmapFactory.decodeFile(aligned.path)
      try {
        assertEquals(1600, actual.width); assertEquals(2263, actual.height)
        locations.forEachIndexed { i, p ->
          val color = actual.getPixel(p.first, p.second)
          assertTrue(abs(Color.red(color) - Color.red(colors[i])) < 40)
          assertTrue(abs(Color.green(color) - Color.green(colors[i])) < 40)
          assertTrue(abs(Color.blue(color) - Color.blue(colors[i])) < 40)
        }
      } finally { actual.recycle() }
    } finally { aligned?.delete(); file.delete(); page.recycle(); photo.recycle() }
  }

  @Test fun invalidCornersDoNotCreateAnAlignedFile() {
    val bitmap = Bitmap.createBitmap(1060, 1499, Bitmap.Config.ARGB_8888)
    val file = save(bitmap)
    val before = context.cacheDir.listFiles()!!.filter { it.name.startsWith("tala-aligned-") }.map { it.name }.toSet()
    try {
      for (corners in listOf(listOf(full[0], full[2], full[1], full[3]), listOf(full[0], full[1], full[1], full[3]),
        listOf(-0.1 to 0.0, full[1], full[2], full[3]), full.map { it.first * 0.2 to it.second * 0.2 })) {
        try { Perspective.rectify(context, Uri.fromFile(file).toString(), corners); fail("Invalid corners were accepted") }
        catch (_: IllegalArgumentException) { /* expected */ }
      }
      val after = context.cacheDir.listFiles()!!.filter { it.name.startsWith("tala-aligned-") }.map { it.name }.toSet()
      assertEquals(before, after)
    } finally { file.delete(); bitmap.recycle() }
  }

  @Test fun bundledMlKitReadsFictionalFixtureInputs() {
    // This is actual on-device recognition, not mocked output. Host tests separately verify name spacing and guards.
    val regions = JSONObject(assets.open("ocr-regions.json").bufferedReader().use { it.readText() })
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val failures = mutableListOf<String>()
    try {
      for (fixture in listOf("clean", "optional-blanks", "invalid-required")) {
        val expected = JSONObject(assets.open("$fixture.json").bufferedReader().use { it.readText() }).getJSONObject("raw")
        val image = assets.open("$fixture-page-1.png").use { BitmapFactory.decodeStream(it) }
        val source = save(image)
        var aligned: File? = null
        try {
          val result = Perspective.rectify(context, Uri.fromFile(source).toString(), full)
          aligned = File(Uri.parse(result["uri"] as String).path!!)
          val page = BitmapFactory.decodeFile(aligned.path)
          try {
            for (key in regions.keys()) {
              val parts = mutableListOf<String>()
              val details = mutableListOf<String>()
              val boxes = regions.getJSONArray(key)
              for (i in 0 until boxes.length()) {
                val r = boxes.getJSONObject(i)
                val x = floor(r.getDouble("x") * page.width).toInt()
                val y = floor(r.getDouble("y") * page.height).toInt()
                val width = floor(r.getDouble("width") * page.width).toInt()
                val height = floor(r.getDouble("height") * page.height).toInt()
                val crop = Bitmap.createBitmap(page, x, y, width, height)
                val enlarged = Bitmap.createScaledBitmap(crop, (width * 128.0 / height).roundToInt(), 128, true)
                val cropFile = save(enlarged)
                try {
                  val prepared = FieldImage.prepare(Uri.fromFile(cropFile).toString())
                  try {
                    val recognized = Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap, 0)), 30, TimeUnit.SECONDS)
                    parts.add(ReadingResult.from(recognized, prepared).readingText.trim())
                    details.add(recognized.textBlocks.flatMap { it.lines }.joinToString("; ") { "${it.text} @ ${it.boundingBox}" })
                  } finally { prepared.bitmap.recycle() }
                } finally { cropFile.delete(); if (enlarged !== crop) enlarged.recycle(); crop.recycle() }
              }
              val separator = if (key == "school_year") "-" else if (key == "birth_date") "/" else " "
              val actual = parts.joinToString(separator).replace(Regex("\\s+"), "").let { if (key.contains("_name")) it.uppercase(Locale.ROOT) else it }
              val wanted = expected.getString(key).replace(Regex("\\s+"), "")
              if (wanted != actual) failures.add("$fixture / $key expected <$wanted> but was <$actual> [${details.joinToString(" | ")}]")
            }
          } finally { page.recycle() }
        } finally { aligned?.delete(); source.delete(); image.recycle() }
      }
      assertTrue("Actual ML Kit mismatches (do not replace expected values):\n" + failures.joinToString("\n"), failures.isEmpty())
    } finally { recognizer.close() }
  }

  @Test fun duplicateGlyphLinesAreRemovedOnlyWithMatchingTextAndGeometry() {
    val full = LineReading("202 4", Rect(40, 39, 208, 80))
    val duplicate = LineReading("4", Rect(187, 43, 206, 74))
    val separate = LineReading("4", Rect(240, 43, 260, 74))
    val conflict = LineReading("9", Rect(187, 43, 206, 74))
    assertEquals(listOf(full, separate), ReadingResult.distinct(listOf(duplicate, full, separate)))
    assertEquals(2, ReadingResult.distinct(listOf(full, conflict)).size)
    assertEquals(1, ReadingResult.distinct(listOf(full, full)).size)
  }

  @Test fun preprocessingPreservesCharacterStrokesAndAddsEmptyMargins() {
    val input = Bitmap.createBitmap(500, 128, Bitmap.Config.ARGB_8888)
    Canvas(input).apply {
      drawColor(Color.WHITE)
      val paint = Paint().apply { color = Color.BLACK; strokeWidth = 4f }
      for (x in listOf(0f, 100f, 200f, 300f, 400f, 499f)) drawLine(x, 0f, x, 128f, paint)
      paint.textSize = 72f
      drawText("1", 35f, 95f, paint)
    }
    val file = save(input)
    val prepared = FieldImage.prepare(Uri.fromFile(file).toString())
    try {
      assertEquals(500, prepared.sourceWidth); assertEquals(128, prepared.sourceHeight)
      assertEquals(Color.WHITE, prepared.bitmap.getPixel(0, 0))
      val ruleX = prepared.inset + (100.0 * prepared.contentWidth / 500).roundToInt()
      val centerY = prepared.inset + prepared.contentHeight / 2
      val rule = prepared.bitmap.getPixel(ruleX, centerY)
      assertTrue(Color.red(rule) > 220)
      var dark = 0
      for (x in 30..80) for (y in 30..100) {
        val px = prepared.inset + (x.toDouble() * prepared.contentWidth / 500).roundToInt()
        val py = prepared.inset + (y.toDouble() * prepared.contentHeight / 128).roundToInt()
        if (Color.red(prepared.bitmap.getPixel(px, py)) < 128) dark++
      }
      assertTrue("The digit stroke must survive grid removal", dark > 0)
    } finally { prepared.bitmap.recycle(); file.delete(); input.recycle() }
  }
}
