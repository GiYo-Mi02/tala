package expo.modules.talaocr

import android.net.Uri
import android.app.Activity
import android.content.Intent
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import org.json.JSONObject
import java.io.File

class TalaOcrModule : Module() {
  private var pendingScan:Promise?=null
  private val scanRequest=49371
  override fun definition() = ModuleDefinition {
    Name("TalaOcr")
    Constants("diagnosticsEnabled" to BuildConfig.DEBUG)
    AsyncFunction("registerSssPage") { uri: String, page: Int ->
      SssRegistration.automatic(requireNotNull(appContext.reactContext), uri, page)
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("rectifySssFrame") { uri: String, page: Int, corners: List<Map<String, Double>> ->
      SssRegistration.manual(requireNotNull(appContext.reactContext), uri, page, DocumentImages.points(corners))
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("recognizeField") { uri:String,json:String,promise:Promise ->
      try {
        val r=JSONObject(json); val x=r.getInt("x"); val y=r.getInt("y")
        val request=RoiRequest(r.getString("fieldId"),r.getInt("part"),
          android.graphics.Rect(x,y,x+r.getInt("width"),y+r.getInt("height")),r.getInt("cells"),r.optBoolean("diagnostics",false),
          r.optString("templateId","beef-sy-2024-2025"),r.optString("kind",""),r.optBoolean("grid",true))
        promise.resolve(FieldRoiOcr.read(requireNotNull(appContext.reactContext),uri,request))
      } catch(_:Exception) { promise.reject("E_FIELD_OCR","This field could not be read from the corrected image. Review it manually or retake.",null) }
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("scanDocument") { config:String,promise:Promise ->
      if(pendingScan!=null) { promise.reject("E_BUSY","A document scan is already open.",null); return@AsyncFunction }
      val activity=appContext.currentActivity
      if(activity==null) { promise.reject("E_ACTIVITY","Reopen the app to scan a document.",null); return@AsyncFunction }
      try {
        JSONObject(config)
        pendingScan=promise
        activity.startActivityForResult(Intent(activity,DocumentScannerActivity::class.java).putExtra("config",config),scanRequest)
      } catch(_:Exception) { pendingScan=null; promise.reject("E_SCAN","The scanner could not open. Try again.",null) }
    }.runOnQueue(Queues.MAIN)
    OnActivityResult { activity,result ->
      if(result.requestCode==scanRequest) {
        val promise=pendingScan; pendingScan=null
        if(result.resultCode!=Activity.RESULT_OK)promise?.resolve(null)
        else {
          var file:File?=null
          try {
            file=File(requireNotNull(result.data?.getStringExtra("resultPath"))).canonicalFile
            require(file.path.startsWith(activity.cacheDir.canonicalPath+File.separator) && file.length()<65536)
            promise?.resolve(file.readText())
          } catch(_:Exception) { promise?.reject("E_SCAN","The captured scan could not be opened. Retake it.",null) }
          finally { file?.takeIf { it.path.startsWith(activity.cacheDir.canonicalPath+File.separator) }?.delete() }
        }
      }
    }
    OnDestroy { pendingScan?.reject("E_CLOSED","The scanner session closed. Reopen the draft.",null); pendingScan=null }
    AsyncFunction("rectifyDocument") { uri:String,corners:List<Map<String,Double>>,promise:Promise ->
      try {
        val context=requireNotNull(appContext.reactContext)
        promise.resolve(DocumentImages.warp(context,uri,DocumentImages.points(corners)))
      } catch(e:Exception) { promise.reject("E_ALIGNMENT",e.message ?: "This image could not be aligned. Retake it.",null) }
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("recognizeDocument") { uri:String,promise:Promise ->
      val context=appContext.reactContext
      if(context==null) { promise.reject("E_CONTEXT","Reopen the app to read this image.",null); return@AsyncFunction }
      val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        DocumentImages.privateFile(context,uri)
        val image=InputImage.fromFilePath(context,Uri.parse(uri))
        val width=image.width.toDouble(); val height=image.height.toDouble()
        recognizer.process(image).addOnSuccessListener { text ->
          fun box(rect:android.graphics.Rect?)=mapOf("x" to ((rect?.left ?: 0)/width),"y" to ((rect?.top ?: 0)/height),
            "width" to ((rect?.width() ?: 0)/width),"height" to ((rect?.height() ?: 0)/height))
          promise.resolve(mapOf("text" to text.text,"blocks" to text.textBlocks.map { block ->
            mapOf("text" to block.text,"region" to box(block.boundingBox),"lines" to block.lines.map { line ->
              mapOf("text" to line.text,"region" to box(line.boundingBox))
            })
          }))
        }.addOnFailureListener { promise.reject("E_OCR","Text could not be read. Retake or continue with manual verification.",null) }
          .addOnCompleteListener { recognizer.close() }
      } catch(_:Exception) { recognizer.close(); promise.reject("E_IMAGE","The scanned image could not be opened for reading.",null) }
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("rectify") { uri: String, corners: List<Map<String, Double>>, promise: Promise ->
      try {
        val context = requireNotNull(appContext.reactContext) { "Reopen the app to align this page." }
        val points = corners.map { Pair(requireNotNull(it["x"]), requireNotNull(it["y"])) }
        promise.resolve(Perspective.rectify(context, uri, points))
      } catch (e: Exception) {
        promise.reject("E_ALIGNMENT", e.message ?: "This photo could not be aligned. Adjust the corners or retake it.", null)
      }
    }.runOnQueue(Queues.DEFAULT)
    AsyncFunction("recognize") { uri: String, dateCell: Boolean, promise: Promise ->
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
        val prepared = FieldImage.prepare(uri, dateCell)
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
