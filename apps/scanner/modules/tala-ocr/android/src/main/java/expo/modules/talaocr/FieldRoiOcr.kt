package expo.modules.talaocr

import android.content.Context
import android.graphics.*
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.*

internal data class RoiRequest(val fieldId:String,val part:Int,val rect:Rect,val cells:Int,val diagnostics:Boolean=false,
  val templateId:String="beef-sy-2024-2025",val kind:String="",val grid:Boolean=true)
internal data class GridCleaned(val bitmap:Bitmap,val verticalLines:List<Int>,val horizontalLines:List<Int>,val occupiedCells:List<Int>,val removedInkFraction:Double)

/** OCR sees file pixels, never a View/preview/screenshot. Region decoding does not shrink the page. */
internal object FieldRoiOcr {
  private val ids=setOf("school_year","grade_level","lrn","learner_last_name","learner_first_name","learner_middle_name","birth_date")
  fun crop(context:Context,uri:String,request:RoiRequest):Bitmap {
    val supported=if(request.templateId=="beef-sy-2024-2025")request.fieldId in ids
      else request.templateId=="sss-e1-cov01214-09-2015" && request.fieldId.matches(Regex("sss_[a-z0-9_]{1,90}"))
    require(supported && request.cells in 1..40 && request.part in 0..2)
    val file=DocumentImages.privateFile(context,uri)
    val decoder=BitmapRegionDecoder.newInstance(file.path,false)
    try {
      val r=request.rect
      require(r.left>=0 && r.top>=0 && r.width()>=request.cells && r.height()>0 && r.right<=decoder.width && r.bottom<=decoder.height && r.height()<=decoder.height*.1) { "Field coordinates are outside the corrected document." }
      val options=BitmapFactory.Options().apply { inPreferredConfig=Bitmap.Config.ARGB_8888; inSampleSize=1; inScaled=false }
      return requireNotNull(decoder.decodeRegion(r,options)).apply { density=Bitmap.DENSITY_NONE }
    } finally { decoder.recycle() }
  }
  /** Remove only long rules close to registered cell boundaries, never arbitrary glyph columns. */
  fun clean(original:Bitmap,cells:Int,thinRules:Boolean=false,adaptiveRules:Boolean=false):GridCleaned {
    val w=original.width; val h=original.height; val pixels=IntArray(w*h)
    original.getPixels(pixels,0,w,0,0,w,h)
    fun dark(value:Int)=Color.red(value)*299+Color.green(value)*587+Color.blue(value)*114<160000
    val vertical=mutableListOf<Int>(); val horizontal=mutableListOf<Int>()
    val mask=BooleanArray(w*h)
    val cell=w.toDouble()/cells
    val columnInk=IntArray(w) { x -> (0 until h).count { y -> dark(pixels[y*w+x]) } }
    for(boundary in 0..cells) {
      val predicted=(boundary*cell).roundToInt().coerceIn(0,w-1)
      val radius=max(1,(cell*.16).roundToInt())
      var best=-1; var bestCount=0
      for(x in max(0,predicted-radius)..min(w-1,predicted+radius)) {
        val count=columnInk[x]
        if(count>bestCount || (count==bestCount && abs(x-predicted)<abs(best-predicted))) { bestCount=count; best=x }
      }
      if(best>=0 && bestCount>=h*.80) {
        vertical.add(best)
        // Include the rule's antialiased edges, bounded to 8% of one cell.
        val halfWidth=if(thinRules)1 else max(1,(min(cell,h.toDouble())*.08).roundToInt())
        var left=max(0,best-halfWidth);var right=min(w-1,best+halfWidth)
        if(adaptiveRules) {
          // E-1 uses both single and double-width date separators. Measure each
          // registered rule's contiguous long-ink columns instead of leaving edges.
          left=best;right=best
          while(left>max(0,predicted-radius) && columnInk[left-1]>=h*.75)left--
          while(right<min(w-1,predicted+radius) && columnInk[right+1]>=h*.75)right++
          left=max(0,left-1);right=min(w-1,right+1)
        }
        for(x in left..right)for(y in 0 until h)mask[y*w+x]=true
      }
    }
    for(y in 0 until h)if(y<h*.12 || y>=h*.88) {
      var count=0
      for(x in 0 until w)if(dark(pixels[y*w+x]))count++
      if(count>=w*.70) {
        horizontal.add(y)
        for(yy in max(0,y-1)..min(h-1,y+1))for(x in 0 until w)mask[yy*w+x]=true
      }
    }
    var originalInk=0; var removedInk=0
    for(i in pixels.indices) {
      if(dark(pixels[i])) { originalInk++; if(mask[i])removedInk++ }
      if(mask[i])pixels[i]=Color.WHITE
    }
    val occupied=mutableListOf<Int>()
    for(index in 0 until cells) {
      val left=(index*cell+cell*.18).toInt().coerceIn(0,w-1)
      val right=((index+1)*cell-cell*.18).toInt().coerceIn(left+1,w)
      val top=max(0,(h*.12).toInt()); val bottom=max(top+1,(h*.88).toInt())
      var ink=0; var area=0
      for(y in top until bottom)for(x in left until right) { if(dark(pixels[y*w+x]))ink++; area++ }
      if(ink>=max(3.0,area*.015))occupied.add(index)
    }
    val cleaned=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888).apply { density=Bitmap.DENSITY_NONE }
    return GridCleaned(cleaned,vertical,horizontal,occupied,removedInk.toDouble()/max(1,originalInk))
  }
  fun prepare(bitmap:Bitmap,fieldId:String):PreparedField {
    val minimum=when(fieldId) { "birth_date" -> 80; else -> 52 }
    val factor=max(1.0,minimum.toDouble()/bitmap.height) // Upscale only; retain native ROI detail.
    val width=(bitmap.width*factor).roundToInt(); val height=(bitmap.height*factor).roundToInt()
    val scaled=if(factor>1)Bitmap.createScaledBitmap(bitmap,width,height,true) else bitmap
    try {
      val inset=32; val padded=Bitmap.createBitmap(width+64,height+64,Bitmap.Config.ARGB_8888)
      padded.density=Bitmap.DENSITY_NONE
      Canvas(padded).apply { drawColor(Color.WHITE); drawBitmap(scaled,inset.toFloat(),inset.toFloat(),null) }
      return PreparedField(padded,bitmap.width,bitmap.height,width,height,inset)
    } finally { if(scaled!==bitmap)scaled.recycle() }
  }
  private fun confidence(text:com.google.mlkit.vision.text.Text):Double? {
    val values=text.textBlocks.flatMap { it.lines }.flatMap { it.elements }.map { it.confidence.toDouble() }.filter { it.isFinite() && it in 0.0..1.0 }
    return if(values.isEmpty())null else values.average()
  }
  fun read(context:Context,uri:String,request:RoiRequest):Map<String,Any?> {
    val original=crop(context,uri,request)
    val date=request.fieldId=="birth_date" || request.kind=="date"
    val cleaned=try { if(request.grid)clean(original,request.cells,date,request.templateId=="sss-e1-cov01214-09-2015")
      else GridCleaned(requireNotNull(original.copy(Bitmap.Config.ARGB_8888,false)),emptyList(),emptyList(),emptyList(),0.0)
    } catch(e:Throwable) { original.recycle(); throw e }
    val originalInput=try { prepare(original,if(date)"birth_date" else request.fieldId) } catch(e:Throwable) { original.recycle(); cleaned.bitmap.recycle(); throw e }
    val processedInput=try { prepare(cleaned.bitmap,if(date)"birth_date" else request.fieldId) } catch(e:Throwable) { original.recycle(); cleaned.bitmap.recycle(); originalInput.bitmap.recycle(); throw e }
    val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val files=mutableListOf<File>(); var success=false
    val segmentInputs=mutableListOf<Bitmap>()
    try {
      fun recognize(prepared:PreparedField):Map<String,Any?> {
        val text=Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap,0)),30,TimeUnit.SECONDS)
        return ReadingResult.from(text,prepared).bridge()+mapOf("confidence" to confidence(text))
      }
      val raw=recognize(originalInput)
      val processed=if(cleaned.verticalLines.isEmpty() && cleaned.horizontalLines.isEmpty())raw else recognize(processedInput)
      // The E-1 TIN/CRN grid groups digits in threes. A second, independent
      // reading of those groups can recover repeated digits omitted by row OCR.
      // It never fills a missing character or substitutes O/0, I/1, etc.
      val segments=mutableListOf<Map<String,Any?>>()
      val segmentElements=mutableListOf<Map<String,Any>>()
      val segmentConfidence=mutableListOf<Double>()
      val processedCompact=(processed["readingText"] as String).replace(Regex("\\s+"),"")
      if(request.templateId=="sss-e1-cov01214-09-2015" && request.kind=="identifier" && request.grid && request.cells>=6 &&
        processedCompact.isNotEmpty() && !processedCompact.matches(Regex("\\d{${request.cells}}"))) {
        for(start in 0 until request.cells step 3) {
          val count=min(3,request.cells-start)
          val left=(start*original.width.toDouble()/request.cells).roundToInt()
          val right=((start+count)*original.width.toDouble()/request.cells).roundToInt()
          val cell=Bitmap.createBitmap(cleaned.bitmap,left,0,right-left,original.height)
          val prepared=try { prepare(cell,request.fieldId) } finally { cell.recycle() }
          segmentInputs.add(prepared.bitmap)
          val text=Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap,0)),30,TimeUnit.SECONDS)
          val reading=ReadingResult.from(text,prepared)
          segmentElements.addAll(reading.elements.map { e->e+mapOf("x" to ((e["x"] as Number).toDouble()+left)) })
          segmentConfidence.addAll(text.textBlocks.flatMap { it.lines }.flatMap { it.elements }.map { it.confidence.toDouble() }.filter { it.isFinite() && it in 0.0..1.0 })
          segments.add(reading.bridge()+mapOf("startCell" to start,"cells" to count,"confidence" to confidence(text)))
        }
      }
      val segmented=if(segments.isEmpty())null else mapOf("text" to segments.joinToString(" ") { (it["text"] as String).trim() },
        "readingText" to segments.joinToString(" ") { (it["readingText"] as String).trim() },"elements" to segmentElements,
        "confidence" to if(segmentConfidence.isEmpty())null else segmentConfidence.average())
      fun snapshot(bitmap:Bitmap):String {
        val file=DocumentImages.newFile(context,"png"); files.add(file)
        file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) }
        return Uri.fromFile(file).toString()
      }
      val diagnostics=if(BuildConfig.DEBUG && request.diagnostics)mutableMapOf(
        "originalCrop" to snapshot(original),"processedCrop" to snapshot(cleaned.bitmap),
        "originalInput" to snapshot(originalInput.bitmap),"processedInput" to snapshot(processedInput.bitmap)
      ).apply { segmentInputs.forEachIndexed { index,bitmap->put("segmentedInput$index",snapshot(bitmap)) } } else emptyMap()
      val result=mapOf("fieldId" to request.fieldId,"part" to request.part,"original" to raw,"processed" to processed,
        "x" to request.rect.left,"y" to request.rect.top,
        "sourceWidth" to original.width,"sourceHeight" to original.height,
        "inputWidth" to processedInput.bitmap.width,"inputHeight" to processedInput.bitmap.height,
        "verticalLines" to cleaned.verticalLines,"horizontalLines" to cleaned.horizontalLines,"occupiedCells" to cleaned.occupiedCells,
        "removedInkFraction" to cleaned.removedInkFraction,"diagnostics" to diagnostics) +
        mapOf("segmented" to segmented,"segments" to segments)
      success=true
      return result
    } finally {
      recognizer.close(); original.recycle(); cleaned.bitmap.recycle(); originalInput.bitmap.recycle(); processedInput.bitmap.recycle()
      segmentInputs.forEach { it.recycle() }
      if(!success)files.forEach { it.delete() }
    }
  }
}
