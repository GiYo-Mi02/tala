package expo.modules.talaocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues

class TalaOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TalaOcr")
    AsyncFunction("rectify") { uri: String, corners: List<Map<String, Double>>, promise: Promise ->
      try {
        val context = requireNotNull(appContext.reactContext) { "Reopen the app to align this page." }
        val points = corners.map { Pair(requireNotNull(it["x"]), requireNotNull(it["y"])) }
        promise.resolve(Perspective.rectify(context, uri, points))
      } catch (e: Exception) {
        promise.reject("E_ALIGNMENT", e.message ?: "This photo could not be aligned. Adjust the corners or retake it.", null)
      }
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_CONTEXT", "OCR is not available. Reopen the app.", null)
        return@AsyncFunction
      }
      if (!uri.startsWith("file://")) {
        promise.reject("E_IMAGE", "OCR requires a local image.", null)
        return@AsyncFunction
      }
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      var field: PreparedField? = null
      try {
        val prepared = FieldImage.prepare(uri)
        field = prepared
        val image = InputImage.fromBitmap(prepared.bitmap, 0)
        recognizer.process(image)
          .addOnSuccessListener { result ->
            promise.resolve(ReadingResult.from(result, prepared).bridge())
          }
          .addOnFailureListener { promise.reject("E_OCR", "Text could not be read. Retake a clear photo or enter the fields manually.", null) }
          .addOnCompleteListener { recognizer.close(); prepared.bitmap.recycle() }
      } catch (_: Exception) {
        field?.bitmap?.recycle()
        recognizer.close()
        promise.reject("E_IMAGE", "The saved image could not be opened for OCR. Retake this page.", null)
      }
    }
  }
}
