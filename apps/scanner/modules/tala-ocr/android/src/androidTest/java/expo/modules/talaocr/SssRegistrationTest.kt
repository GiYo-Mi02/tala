package expo.modules.talaocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SssRegistrationTest {
  @Test fun registersPrintedFieldsOnLetterAndA4WithExtraMargins() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val assets = instrumentation.context.assets
    for (page in listOf(1, 3)) {
      val reference = assets.open("sss-e1-page-$page.png").use { BitmapFactory.decodeStream(it) }
      val fixture = assets.open("sss-additional-page-$page.png").use { BitmapFactory.decodeStream(it) }
      try {
        // Insets and mild perspective like a fit-to-page print photographed on a phone.
        val capture = Bitmap.createBitmap(900, if (page == 1) 1273 else 1165, Bitmap.Config.ARGB_8888)
        val corners = floatArrayOf(29f, 70f, 865f, 88f, 850f, 1180f, 40f, 1193f)
        if (page == 3) { corners[5] = 1125f; corners[7] = 1138f }
        val matrix = Matrix().apply {
          assertTrue(setPolyToPoly(floatArrayOf(0f, 0f, (fixture.width - 1).toFloat(), 0f,
            (fixture.width - 1).toFloat(), (fixture.height - 1).toFloat(), 0f, (fixture.height - 1).toFloat()), 0, corners, 0, 4))
        }
        Canvas(capture).apply {
          drawColor(Color.rgb(207, 207, 207))
          drawBitmap(fixture, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
          drawColor(0x26000000)
        }
        val captureFile = DocumentImages.save(context, capture)
        val uri = captureFile["uri"] as String
        try {
          val registered = SssRegistration.register(context, uri, reference, page)
          assertNotNull("Page $page must align using printed features, despite extra margins", registered)
          val alignedFile = File(Uri.parse(registered!!["uri"] as String).path!!)
          try {
            val result = BitmapFactory.decodeFile(alignedFile.path)
            try {
              val width = result.width
              val height = result.height
              assertEquals(612.0 / 792.0, width.toDouble() / height, .002)
              val region = if (page == 1) doubleArrayOf(18.0, 132.0, 158.0, 11.0) else doubleArrayOf(45.0, 106.0, 157.0, 11.0)
              val crop = Bitmap.createBitmap(result, (region[0] / 612 * width).toInt(), (region[1] / 792 * height).toInt(),
                (region[2] / 612 * width).toInt(), (region[3] / 792 * height).toInt())
              val input = FieldRoiOcr.prepare(crop, "sss_registrant_last_name")
              val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
              try {
                val text = Tasks.await(recognizer.process(InputImage.fromBitmap(input.bitmap, 0)), 30, TimeUnit.SECONDS)
                assertEquals("Mapped surname for page $page", "ALVAREZ", text.text.trim().uppercase())
              } finally { recognizer.close(); crop.recycle(); input.bitmap.recycle() }
            } finally { result.recycle() }
          } finally { alignedFile.delete() }
          val frame = SssRegistration.printedFrame(page).flatMap { p ->
            listOf((p.x * (fixture.width - 1)).toFloat(), (p.y * (fixture.height - 1)).toFloat())
          }.toFloatArray()
          matrix.mapPoints(frame)
          val marked = frame.toList().chunked(2).map { ScanPoint(it[0].toDouble() / (capture.width - 1), it[1].toDouble() / (capture.height - 1)) }
          val manual = SssRegistration.manual(context, uri, page, marked)
          File(Uri.parse(manual["uri"] as String).path!!).delete()
          val wrongReference = assets.open("sss-e1-page-${if (page == 1) 3 else 1}.png").use { BitmapFactory.decodeStream(it) }
          try { assertNull(SssRegistration.register(context, uri, wrongReference, if (page == 1) 3 else 1)) }
          finally { wrongReference.recycle() }
        } finally { File(Uri.parse(uri).path!!).delete(); capture.recycle() }
      } finally { reference.recycle(); fixture.recycle() }
    }
  }

  @Test fun blankPageCannotRegister() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val reference = instrumentation.context.assets.open("sss-e1-page-1.png").use { BitmapFactory.decodeStream(it) }
    val blank = Bitmap.createBitmap(900, 1165, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    val uri = DocumentImages.save(context, blank)["uri"] as String
    try { assertNull(SssRegistration.register(context, uri, reference, 1)) }
    finally { blank.recycle(); reference.recycle(); File(Uri.parse(uri).path!!).delete() }
  }
}
