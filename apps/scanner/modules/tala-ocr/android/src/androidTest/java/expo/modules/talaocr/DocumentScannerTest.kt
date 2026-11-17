package expo.modules.talaocr

import android.graphics.*
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.android.Utils
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.*

@RunWith(AndroidJUnit4::class)
class DocumentScannerTest {
  private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
  private val assets get()=InstrumentationRegistry.getInstrumentation().context.assets
  private val flat=listOf(ScanPoint(350.0,250.0),ScanPoint(1450.0,250.0),ScanPoint(1450.0,1850.0),ScanPoint(350.0,1850.0))
  private fun page():Bitmap=Bitmap.createBitmap(1100,1600,Bitmap.Config.ARGB_8888).also { bitmap ->
    Canvas(bitmap).apply {
      drawColor(Color.WHITE)
      val ink=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=Color.BLACK; textSize=30f }
      drawText("FICTIONAL DOCUMENT TEST",60f,80f,ink)
      for(row in 0..25) {
        val y=140f+row*50
        drawText("Sample text 0123456789 row $row",75f,y,ink)
        ink.strokeWidth=2f; drawLine(50f,y+12,1040f,y+12,ink)
      }
    }
  }
  private fun photo(corners:List<ScanPoint> = flat,clutter:Boolean=false,shadow:Boolean=false,uneven:Boolean=false,source:Bitmap?=null):Bitmap {
    val document=source ?: page()
    val photo=Bitmap.createBitmap(1800,2200,Bitmap.Config.ARGB_8888)
    val src=floatArrayOf(0f,0f,(document.width-1).toFloat(),0f,(document.width-1).toFloat(),(document.height-1).toFloat(),0f,(document.height-1).toFloat())
    val dst=corners.flatMap { listOf(it.x.toFloat(),it.y.toFloat()) }.toFloatArray()
    val transform=Matrix().apply { assertTrue(setPolyToPoly(src,0,dst,0,4)) }
    Canvas(photo).apply {
      drawColor(Color.rgb(52,62,65))
      if(clutter)for(i in 0..12)drawRect(25f,30f+i*155,170f,110f+i*155,Paint().apply { color=if(i%2==0)Color.LTGRAY else Color.rgb(120,90,60) })
      drawBitmap(document,transform,Paint(Paint.FILTER_BITMAP_FLAG))
      if(shadow || uneven)drawRect(0f,0f,1800f,2200f,Paint().apply {
        shader=LinearGradient(0f,0f,if(shadow)1800f else 0f,if(shadow)0f else 2200f,
          if(shadow)0x60000000 else 0x90000000.toInt(),Color.TRANSPARENT,Shader.TileMode.CLAMP)
      })
    }
    if(source==null)document.recycle()
    return photo
  }
  private fun detect(bitmap:Bitmap):DocumentDetection? {
    OpenCvRuntime.ensure(); val rgba=Mat(); val gray=Mat()
    try { Utils.bitmapToMat(bitmap,rgba); Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY); return DocumentDetector().detect(gray) }
    finally { rgba.release(); gray.release() }
  }
  private fun save(bitmap:Bitmap):File=DocumentImages.newFile(context).also { file -> file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG,100,it) } }
  private fun rotate(corners:List<ScanPoint>,degrees:Double)=corners.map {
    val x=it.x-900; val y=it.y-1100; val a=Math.toRadians(degrees)
    ScanPoint(900+x*cos(a)-y*sin(a),1100+x*sin(a)+y*cos(a))
  }
  @Test fun cameraOpensManualCaptureRemainsAvailableAndTheScannerCanReopen() {
    val instrumentation=InstrumentationRegistry.getInstrumentation()
    android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.CAMERA")).use { it.readBytes() }
    fun find(view:android.view.View,label:String):android.widget.Button? {
      if(view is android.widget.Button && view.text.toString()==label)return view
      if(view is android.view.ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i),label)?.let { return it }
      return null
    }
    repeat(2) {
      val previous=context.cacheDir.listFiles()!!.map { it.name }.toSet()
      val scenario=ActivityScenario.launch<DocumentScannerActivity>(android.content.Intent(context,DocumentScannerActivity::class.java))
      try {
        scenario.onActivity { activity -> find(activity.window.decorView,"Auto: On")?.performClick() }
        var ready=false
        val deadline=android.os.SystemClock.elapsedRealtime()+15000
        while(!ready && android.os.SystemClock.elapsedRealtime()<deadline) {
          scenario.onActivity { activity -> ready=find(activity.window.decorView,"Capture")?.isEnabled==true }
          if(!ready)android.os.SystemClock.sleep(100)
        }
        assertTrue("CameraX must open and expose manual capture (cycle $it)",ready)
        if(it==1) {
          scenario.onActivity { activity -> find(activity.window.decorView,"Capture")!!.performClick() }
          var metadata:File?=null
          val captureDeadline=android.os.SystemClock.elapsedRealtime()+20000
          while(metadata==null && android.os.SystemClock.elapsedRealtime()<captureDeadline) {
            metadata=context.cacheDir.listFiles()!!.firstOrNull { file -> file.name.startsWith("tala-scan-") && file.extension=="json" && file.name !in previous }
            if(metadata==null)android.os.SystemClock.sleep(100)
          }
          assertNotNull("Manual CameraX capture must return a staged scan",metadata)
          val result=JSONObject(metadata!!.readText()); val source=result.getJSONObject("source")
          assertTrue(source.getInt("width")>0 && source.getInt("height")>0)
          assertTrue(DocumentImages.privateFile(context,source.getString("uri")).isFile)
        }
      } finally {
        scenario.close()
        context.cacheDir.listFiles()!!.filter { file -> file.name.startsWith("tala-scan-") && file.name !in previous }.forEach { file -> file.delete() }
      }
    }
  }

  @Test fun detectsExteriorPaperAcrossRepresentativeScenarios() {
    val angled=listOf(ScanPoint(350.0,200.0),ScanPoint(1480.0,340.0),ScanPoint(1530.0,1880.0),ScanPoint(240.0,1800.0))
    val cases=listOf("flat" to photo(),"clockwise" to photo(rotate(flat,10.0)),"counterclockwise" to photo(rotate(flat,-10.0)),
      "perspective" to photo(angled),"clutter" to photo(clutter=true),"shadow" to photo(shadow=true),"uneven-light" to photo(uneven=true))
    try {
      for((name,image) in cases) {
        val detection=detect(image)
        assertNotNull("$name did not detect the exterior paper",detection)
        assertNull("$name was rejected: ${detection?.qualityProblem(ScannerConfig())}",detection!!.qualityProblem(ScannerConfig()))
        val expected=when(name) { "clockwise" -> rotate(flat,10.0); "counterclockwise" -> rotate(flat,-10.0); "perspective" -> angled; else -> flat }
        for(i in 0..3) {
          assertEquals("$name corner $i x",expected[i].x/1799,detection.corners[i].x,0.035)
          assertEquals("$name corner $i y",expected[i].y/2199,detection.corners[i].y,0.035)
        }
      }
    } finally { cases.forEach { it.second.recycle() } }
  }
  @Test fun refusesPartialLowContrastAndBlurryPagesWithoutInventingCorners() {
    val partial=photo(flat.map { ScanPoint(it.x-500,it.y) })
    val sameBackground=page()
    val blurred=photo(); val rgba=Mat(); val soft=Mat()
    try {
      val cut=detect(partial)
      assertTrue("Partial paper must not trigger capture",cut==null || cut.qualityProblem(ScannerConfig())!=null)
      assertNull("Internal table rules must not become a paper edge",detect(sameBackground))
      OpenCvRuntime.ensure(); Utils.bitmapToMat(blurred,rgba); Imgproc.GaussianBlur(rgba,soft,Size(61.0,61.0),0.0); Utils.matToBitmap(soft,blurred)
      val result=detect(blurred)
      assertTrue("Blur must block auto capture",result==null || result.qualityProblem(ScannerConfig())!=null)
    } finally { partial.recycle(); sameBackground.recycle(); blurred.recycle(); rgba.release(); soft.release() }
  }
  private fun observation()=DocumentDetection(listOf(ScanPoint(.15,.1),ScanPoint(.85,.1),ScanPoint(.85,.9),ScanPoint(.15,.9)),.95,.56,200.0,180.0,0.0,true)
  @Test fun stabilityRequiresSustainedQualityAndNeverCapturesTwice() {
    val gate=CaptureStability(); val d=observation()
    for(i in 0..6)assertFalse(gate.observe(d,1000+i*150L))
    assertTrue(gate.observe(d,2050)); assertFalse(gate.observe(d,2200)); assertFalse(gate.observe(d,3500))
    for(bad in listOf(d.copy(sharpness=1.0),d.copy(brightness=10.0),d.copy(glare=.5),d.copy(complete=false))) {
      gate.reset(); for(i in 0..15)assertFalse(gate.observe(bad,1000+i*150L))
    }
    gate.reset(); for(i in 0..15) {
      val drift=d.copy(corners=d.corners.map { ScanPoint(it.x+i*.005,it.y) })
      assertFalse("Slow drift must restart stability",gate.observe(drift,1000+i*150L))
    }
    gate.reset(); gate.observe(d,1000); gate.observe(d,1150); gate.observe(null,1300)
    assertFalse(gate.observe(d,2400)); assertFalse(gate.observe(d,3000))
  }
  @Test fun uprightAnalysisPointsReturnToTheCorrectRawBufferCoordinates() {
    assertEquals(ScanPoint(30.0,20.0),ScannerGeometry.rawPoint(ScanPoint(30.0,20.0),640,480,0))
    assertEquals(ScanPoint(20.0,449.0),ScannerGeometry.rawPoint(ScanPoint(30.0,20.0),640,480,90))
    assertEquals(ScanPoint(609.0,459.0),ScannerGeometry.rawPoint(ScanPoint(30.0,20.0),640,480,180))
    assertEquals(ScanPoint(619.0,30.0),ScannerGeometry.rawPoint(ScanPoint(30.0,20.0),640,480,270))
  }
  @Test fun perspectiveCorrectionPreservesLandscapeProportionsAndPrivateImageBounds() {
    val bitmap=photo(); val file=save(bitmap)
    val corners=listOf(ScanPoint(300.0/1800,700.0/2200),ScanPoint(1500.0/1800,700.0/2200),ScanPoint(1500.0/1800,1450.0/2200),ScanPoint(300.0/1800,1450.0/2200))
    var output:File?=null
    try {
      val corrected=DocumentImages.warp(context,Uri.fromFile(file).toString(),corners)
      output=File(Uri.parse(corrected["uri"] as String).path!!)
      assertEquals(1.6,(corrected["width"] as Int).toDouble()/(corrected["height"] as Int),.02)
      try { DocumentImages.privateFile(context,"file:///sdcard/unrelated.jpg"); fail("Public paths must be refused") } catch(_:IllegalArgumentException) {}
      try { DocumentImages.warp(context,Uri.fromFile(file).toString(),listOf(corners[0],corners[2],corners[1],corners[3])); fail("Crossed corners must be refused") } catch(_:IllegalArgumentException) {}
    } finally { output?.delete(); file.delete(); bitmap.recycle() }
  }
  @Test fun openCvWarpKeepsTiltedContentLandmarksInTheirCorrectPositions() {
    val page=page()
    val locations=listOf(.2 to .2,.8 to .2,.8 to .8,.2 to .8)
    val colors=listOf(Color.RED,Color.BLUE,Color.GREEN,Color.BLACK)
    Canvas(page).apply { locations.forEachIndexed { i,p ->
      drawCircle((p.first*page.width).toFloat(),(p.second*page.height).toFloat(),45f,Paint().apply { color=colors[i] })
    } }
    val paper=listOf(ScanPoint(350.0,200.0),ScanPoint(1480.0,340.0),ScanPoint(1530.0,1880.0),ScanPoint(240.0,1800.0))
    val image=photo(paper,source=page); val file=save(image)
    var output:File?=null
    try {
      val corrected=DocumentImages.warp(context,Uri.fromFile(file).toString(),paper.map { ScanPoint(it.x/1799,it.y/2199) })
      output=File(Uri.parse(corrected["uri"] as String).path!!)
      val bitmap=BitmapFactory.decodeFile(output.path)
      try { locations.forEachIndexed { i,p ->
        val actual=bitmap.getPixel((p.first*bitmap.width).toInt(),(p.second*bitmap.height).toInt())
        assertTrue(abs(Color.red(actual)-Color.red(colors[i]))<40)
        assertTrue(abs(Color.green(actual)-Color.green(colors[i]))<40)
        assertTrue(abs(Color.blue(actual)-Color.blue(colors[i]))<40)
      } } finally { bitmap.recycle() }
    } finally { output?.delete(); file.delete(); image.recycle(); page.recycle() }
  }
  @Test fun automaticDetectionWarpAndBundledOcrReadTheUnchangedBeefFixture() {
    val original=assets.open("ocr-baseline-clean-page-1.png").use { BitmapFactory.decodeStream(it) }
    // Preserve the supplied form's physical proportions in this camera fixture.
    // The generic table page above intentionally has different dimensions.
    val paperHeight=1100.0*original.height/original.width
    val corners=listOf(ScanPoint(350.0,300.0),ScanPoint(1450.0,300.0),ScanPoint(1450.0,300.0+paperHeight),ScanPoint(350.0,300.0+paperHeight))
    val photo=photo(corners,source=original); val raw=save(photo)
    val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    var result:JSONObject?=null
    try {
      result=DocumentImages.process(context,Uri.fromFile(raw).toString())
      assertTrue("Reliable paper must crop automatically, without supplied corners: $result",result.has("processed"))
      val processed=result.getJSONObject("processed")
      val page=BitmapFactory.decodeFile(Uri.parse(processed.getString("uri")).path!!)
      try {
        val full=Tasks.await(recognizer.process(InputImage.fromBitmap(page,0)),30,TimeUnit.SECONDS)
        assertTrue("Full-page OCR retains multiline text",full.text.contains('\n') && full.textBlocks.size>1)
        val regions=JSONObject(assets.open("ocr-regions.json").bufferedReader().use { it.readText() })
        val expected=JSONObject(assets.open("clean.json").bufferedReader().use { it.readText() }).getJSONObject("raw")
        for(key in regions.keys()) {
          val pieces=mutableListOf<String>(); val entries=regions.getJSONArray(key)
          for(i in 0 until entries.length()) {
            val r=entries.getJSONObject(i)
            val crop=Bitmap.createBitmap(page,floor(r.getDouble("x")*page.width).toInt(),floor(r.getDouble("y")*page.height).toInt(),floor(r.getDouble("width")*page.width).toInt(),floor(r.getDouble("height")*page.height).toInt())
            val scaled=Bitmap.createScaledBitmap(crop,(crop.width*128.0/crop.height).roundToInt(),128,true)
            val file=save(scaled); val prepared=FieldImage.prepare(Uri.fromFile(file).toString(),key=="birth_date")
            try {
              val text=Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap,0)),30,TimeUnit.SECONDS)
              pieces.add(ReadingResult.from(text,prepared).readingText)
            } finally { prepared.bitmap.recycle(); file.delete(); if(scaled!==crop)scaled.recycle(); crop.recycle() }
          }
          val separator=if(key=="school_year")"-" else if(key=="birth_date")"/" else " "
          val actual=pieces.joinToString(separator).replace(Regex("\\s+"),"").uppercase()
          assertEquals("Actual automatically cropped OCR: $key",expected.getString(key).replace(Regex("\\s+"),""),actual)
        }
      } finally { page.recycle() }
    } finally {
      recognizer.close(); raw.delete(); original.recycle(); photo.recycle()
      result?.optJSONObject("source")?.let { File(Uri.parse(it.getString("uri")).path!!).delete() }
      result?.optJSONObject("processed")?.let { File(Uri.parse(it.getString("uri")).path!!).delete() }
    }
  }
}
