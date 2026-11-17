package expo.modules.talaocr

import android.graphics.*
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.floor

@RunWith(AndroidJUnit4::class)
class SssTemplateTest {
  @Test fun actualOfflineMlKitReadsFixedSssFieldsWithoutUsingParentValues() {
    val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext;val assets=instrumentation.context.assets
    val mapping=JSONObject(assets.open("sss-mapping.json").bufferedReader().use { it.readText() });val fields=mapping.getJSONArray("fields")
    val report=JSONArray()
    val quick=InstrumentationRegistry.getArguments().getString("sssQuick")=="true"
    for(case in if(quick)listOf("clean")else listOf("clean","additional","beneficiaries","nws","invalid")) {
      val expected=JSONObject(assets.open("sss-$case.json").bufferedReader().use { it.readText() });val pages=expected.getJSONArray("pages")
      for(i in 0 until pages.length()) {
        val number=pages.getInt(i);val bitmap=assets.open("sss-$case-page-$number.png").use { BitmapFactory.decodeStream(it) }
        val file=DocumentImages.newFile(context,"png");file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        try {
          for(index in 0 until fields.length()) {
            val f=fields.getJSONObject(index);if(f.getInt("page")!=number || f.getString("mode")!="ocr")continue
            val r=f.getJSONObject("region");val x=floor(r.getDouble("x")*bitmap.width).toInt();val y=floor(r.getDouble("y")*bitmap.height).toInt()
            val w=floor(r.getDouble("width")*bitmap.width).toInt();val h=floor(r.getDouble("height")*bitmap.height).toInt()
            val diagnostic=case=="clean" && f.getString("id") in listOf("sss_birth_date","sss_tin","sss_mother_first_name","sss_spouse_birth_date")
            val request=RoiRequest(f.getString("id"),0,Rect(x,y,x+w,y+h),f.optInt("cells",1),diagnostic,mapping.getString("templateId"),f.getString("type"),f.optBoolean("grid",false))
            val result=FieldRoiOcr.read(context,Uri.fromFile(file).toString(),request)
            if(diagnostic) {
              val dir=File(context.getExternalFilesDir(null),"sss-inputs").apply {mkdirs()}
              @Suppress("UNCHECKED_CAST")
              (result["diagnostics"] as Map<String,String>).forEach { (kind,uri)->File(Uri.parse(uri).path!!).copyTo(File(dir,f.getString("id")+"-"+kind+".png"),true) }
            }
            assertEquals(w,result["sourceWidth"]);assertEquals(h,result["sourceHeight"])
            report.put(JSONObject().put("case",case).put("page",number).put("width",bitmap.width).put("height",bitmap.height).put("fieldId",f.getString("id"))
              .put("expected",expected.getJSONObject("values").getString(f.getString("id"))).put("result",JSONObject(result)))
            if(case=="clean" && f.getString("id") in listOf("sss_registrant_last_name","sss_registrant_first_name","sss_mother_last_name")) {
              @Suppress("UNCHECKED_CAST") val actual=(result["processed"] as Map<String,Any?>)["readingText"] as String
              assertEquals("Registrant and parent crops must remain separate",expected.getJSONObject("raw").getString(f.getString("id")),actual.trim().uppercase())
            }
          }
        } finally {bitmap.recycle();file.delete()}
      }
    }
    File(context.getExternalFilesDir(null),"sss-comparison.json").writeText(report.toString(2))
    println("SSS_FIELD_COMPARISONS="+report.length())
  }
}
