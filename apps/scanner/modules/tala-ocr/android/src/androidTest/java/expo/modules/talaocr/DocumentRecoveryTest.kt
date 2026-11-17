package expo.modules.talaocr

import android.graphics.*
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DocumentRecoveryTest {
  private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
  private fun save(bitmap:Bitmap)=DocumentImages.newFile(context).also { file ->
    file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,98,it)) }
  }
  private fun clean(result:JSONObject?) {
    for(key in listOf("source","processed"))result?.optJSONObject(key)?.optString("uri")?.let { File(Uri.parse(it).path!!).delete() }
  }
  @Test fun coveredCameraCannotProduceAnAcceptableScan() {
    val bitmap=Bitmap.createBitmap(960,1920,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
    val file=save(bitmap); var result:JSONObject?=null
    try {
      result=DocumentImages.process(context,Uri.fromFile(file).toString())
      assertFalse(result.has("processed"))
      assertFalse("A covered camera must not offer crop/accept",result.optBoolean("allowManual",true))
      assertEquals("CAPTURE_DARK",result.getJSONObject("diagnostic").getString("code"))
    } finally { clean(result); file.delete(); bitmap.recycle() }
  }
  @Test fun uniformAndDarkRectangularFramesCannotMasqueradeAsReadableDocuments() {
    for(kind in listOf("white","gray","dark-rectangle")) {
      val bitmap=Bitmap.createBitmap(960,1920,Bitmap.Config.ARGB_8888)
      Canvas(bitmap).apply {
        drawColor(when(kind) { "white" -> Color.WHITE; "gray" -> Color.GRAY; else -> Color.BLACK })
        if(kind=="dark-rectangle")drawRect(100f,300f,860f,1600f,Paint().apply { color=Color.rgb(70,70,70) })
      }
      val file=save(bitmap); var result:JSONObject?=null
      try {
        result=DocumentImages.process(context,Uri.fromFile(file).toString())
        assertFalse("$kind must not produce a usable scan",result.has("processed"))
        assertFalse("$kind must not offer manual acceptance",result.optBoolean("allowManual",true))
      } finally { clean(result); file.delete(); bitmap.recycle() }
    }
  }
  @Test fun smallDetectedPaperReturnsTheOriginalForRecoveryInsteadOfThrowing() {
    val bitmap=Bitmap.createBitmap(960,1920,Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply {
      drawColor(Color.rgb(45,55,60))
      drawRect(200f,450f,760f,1250f,Paint().apply { color=Color.WHITE })
      val ink=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=Color.BLACK; textSize=25f }
      for(row in 0..15)drawText("FICTIONAL FORM ROW $row",220f,510f+row*40,ink)
    }
    val file=save(bitmap); var result:JSONObject?=null
    try {
      result=DocumentImages.process(context,Uri.fromFile(file).toString())
      assertFalse(result.has("processed"))
      assertTrue(result.getBoolean("allowManual"))
      assertEquals("CROP_RESOLUTION",result.getJSONObject("diagnostic").getString("code"))
      assertTrue(DocumentImages.privateFile(context,result.getJSONObject("source").getString("uri")).isFile)
      assertTrue(file.isFile)
    } finally { clean(result); file.delete(); bitmap.recycle() }
  }
  @Test fun fullResolutionPhotoUsesBoundedWorkingPixelsAndKeepsTheOriginal() {
    val bitmap=Bitmap.createBitmap(3024,4032,Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply {
      drawColor(Color.rgb(45,55,60))
      drawRect(350f,350f,2674f,3650f,Paint().apply { color=Color.WHITE })
      val ink=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=Color.BLACK; textSize=65f }
      for(row in 0..35)drawText("FICTIONAL DOCUMENT 0123456789",440f,540f+row*80,ink)
    }
    val file=save(bitmap); bitmap.recycle(); var result:JSONObject?=null
    try {
      val bytes=file.length()
      result=DocumentImages.process(context,Uri.fromFile(file).toString())
      val source=result.getJSONObject("source")
      assertTrue("Work image must be bounded",maxOf(source.getInt("width"),source.getInt("height"))<=3200)
      assertTrue("A readable full-resolution page must still crop",result.has("processed"))
      assertEquals(bytes,file.length())
      val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
      BitmapFactory.decodeFile(file.path,bounds)
      assertEquals(3024,bounds.outWidth); assertEquals(4032,bounds.outHeight)
    } finally { clean(result); file.delete() }
  }
}
