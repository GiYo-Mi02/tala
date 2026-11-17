package expo.modules.talaocr

import android.graphics.*
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.floor
import kotlin.math.roundToInt

@RunWith(AndroidJUnit4::class)
class FieldRoiTest {
  private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
  private val context get() = instrumentation.targetContext
  private val assets get() = instrumentation.context.assets

  @Test fun compareSameEnrollmentDocumentsWithoutChangingGroundTruth() {
    val regions=JSONObject(assets.open("ocr-regions.json").bufferedReader().use { it.readText() })
    val expected=JSONObject(assets.open("clean.json").bufferedReader().use { it.readText() }).getJSONObject("raw")
    val report=JSONArray()
    val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    try {
      for(asset in listOf("ocr-baseline-clean-page-1.png","roi-user-clean-page-1.png")) {
        val decoded=assets.open(asset).use { BitmapFactory.decodeStream(it) }
        val upright=if(decoded.width>decoded.height)Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,Matrix().apply { postRotate(90f) },false)else decoded
        val file=DocumentImages.newFile(context,"png")
        file.outputStream().use { upright.compress(Bitmap.CompressFormat.PNG,100,it) }
        try {
          for(key in regions.keys()) {
            val boxes=regions.getJSONArray(key); val parts=JSONArray(); val old=mutableListOf<String>()
            for(part in 0 until boxes.length()) {
              val r=boxes.getJSONObject(part)
              val x=floor(r.getDouble("x")*upright.width).toInt(); val y=floor(r.getDouble("y")*upright.height).toInt()
              val w=floor(r.getDouble("width")*upright.width).toInt(); val h=floor(r.getDouble("height")*upright.height).toInt()
              val cells=when(key) { "school_year"->4; "grade_level"->1; "lrn"->12; "birth_date"->if(part==2)4 else 2; else->20 }
              val request=RoiRequest(key,part,Rect(x,y,x+w,y+h),cells,true)
              val result=FieldRoiOcr.read(context,Uri.fromFile(file).toString(),request)
              val images=File(context.getExternalFilesDir(null),"roi-images").apply { mkdirs() }
              @Suppress("UNCHECKED_CAST")
              (result["diagnostics"] as Map<String,String>).forEach { (kind,uri) ->
                File(Uri.parse(uri).path!!).copyTo(File(images,"${asset.removeSuffix(".png")}-$key-$part-$kind.png"),true)
              }
              assertEquals(w,result["sourceWidth"]); assertEquals(h,result["sourceHeight"])
              parts.put(JSONObject(result))
              val crop=FieldRoiOcr.crop(context,Uri.fromFile(file).toString(),request)
              val enlarged=Bitmap.createScaledBitmap(crop,(w*128.0/h).roundToInt(),128,true)
              val oldFile=DocumentImages.newFile(context,"jpg")
              oldFile.outputStream().use { enlarged.compress(Bitmap.CompressFormat.JPEG,100,it) }
              val prepared=FieldImage.prepare(Uri.fromFile(oldFile).toString(),key=="birth_date")
              try {
                old.add(ReadingResult.from(Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap,0)),30,TimeUnit.SECONDS),prepared).readingText)
              } finally { prepared.bitmap.recycle(); crop.recycle(); enlarged.recycle(); oldFile.delete() }
            }
            report.put(JSONObject().put("asset",asset).put("fieldId",key).put("expected",expected.getString(key)).put("oldParts",JSONArray(old)).put("parts",parts))
          }
        } finally { file.delete(); upright.recycle(); if(upright!==decoded)decoded.recycle() }
      }
    } finally { recognizer.close() }
    println("TALA_ROI_COMPARISON="+report.toString())
    File(context.getExternalFilesDir(null),"roi-comparison.json").writeText(report.toString(2))
  }

  @Test fun doesNotEraseTallGlyphsAwayFromRegisteredRules() {
    val bitmap=Bitmap.createBitmap(400,80,Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply { drawColor(Color.WHITE); val pen=Paint().apply { color=Color.BLACK; strokeWidth=3f }
      for(x in listOf(0f,100f,200f,300f,399f)) drawLine(x,0f,x,80f,pen)
      drawLine(50f,3f,50f,77f,pen)
    }
    val cleaned=FieldRoiOcr.clean(bitmap,4)
    try { assertTrue(Color.red(cleaned.bitmap.getPixel(50,40))<100); assertTrue(Color.red(cleaned.bitmap.getPixel(100,40))>240) }
    finally { bitmap.recycle(); cleaned.bitmap.recycle() }
  }
}
