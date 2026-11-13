package expo.modules.talaocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class TalaOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TalaOcr")
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
      try {
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        recognizer.process(image)
          .addOnSuccessListener { result ->
            val elements = result.textBlocks.flatMap { it.lines }.flatMap { it.elements }.map { element ->
              val rect = element.boundingBox
              mapOf("text" to element.text, "x" to (rect?.left ?: 0), "y" to (rect?.top ?: 0),
                "width" to (rect?.width() ?: 0), "height" to (rect?.height() ?: 0))
            }
            promise.resolve(mapOf("text" to result.text, "elements" to elements))
          }
          .addOnFailureListener { promise.reject("E_OCR", "Text could not be read. Retake a clear photo or enter the fields manually.", null) }
          .addOnCompleteListener { recognizer.close() }
      } catch (_: Exception) {
        recognizer.close()
        promise.reject("E_IMAGE", "The saved image could not be opened for OCR. Retake this page.", null)
      }
    }
  }
}
