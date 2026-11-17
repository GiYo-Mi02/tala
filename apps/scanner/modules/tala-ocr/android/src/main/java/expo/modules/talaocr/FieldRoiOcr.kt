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

internal data class RoiRequest(val fieldId:String,val part:Int,val rect:Rect,val cells:Int,val diagnostics:Boolean=false)
internal data class GridCleaned(val bitmap:Bitmap,val verticalLines:List<Int>,val horizontalLines:List<Int>,val occupiedCells:List<Int>,val removedInkFraction:Double)

/** OCR sees file pixels, never a View/preview/screenshot. Region decoding does not shrink the page. */
internal object FieldRoiOcr {
  private val ids=setOf("school_year","grade_level","lrn","learner_last_name","learner_first_name","learner_middle_name","birth_date")
  fun crop(context:Context,uri:String,request:RoiRequest):Bitmap {
    require(request.fieldId in ids && request.cells in 1..40 && request.part in 0..2)
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
  fun clean(original:Bitmap,cells:Int,thinRules:Boolean=false):GridCleaned {
    val w=original.width; val h=original.height; val pixels=IntArray(w*h)
    original.getPixels(pixels,0,w,0,0,w,h)
    fun dark(value:Int)=Color.red(value)*299+Color.green(value)*587+Color.blue(value)*114<160000
    val vertical=mutableListOf<Int>(); val horizontal=mutableListOf<Int>()
    val mask=BooleanArray(w*h)
    val cell=w.toDouble()/cells
    for(boundary in 0..cells) {
      val predicted=(boundary*cell).roundToInt().coerceIn(0,w-1)
      val radius=max(1,(cell*.16).roundToInt())
      var best=-1; var bestCount=0
      for(x in max(0,predicted-radius)..min(w-1,predicted+radius)) {
        var count=0
        for(y in 0 until h)if(dark(pixels[y*w+x]))count++
        if(count>bestCount || (count==bestCount && abs(x-predicted)<abs(best-predicted))) { bestCount=count; best=x }
      }
      if(best>=0 && bestCount>=h*.80) {
        vertical.add(best)
        // Include the rule's antialiased edges, bounded to 8% of one cell.
        val halfWidth=if(thinRules)1 else max(1,(min(cell,h.toDouble())*.08).roundToInt())
        for(x in max(0,best-halfWidth)..min(w-1,best+halfWidth))for(y in 0 until h)mask[y*w+x]=true
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
    val cleaned=try { clean(original,request.cells,request.fieldId=="birth_date") } catch(e:Throwable) { original.recycle(); throw e }
    val originalInput=try { prepare(original,request.fieldId) } catch(e:Throwable) { original.recycle(); cleaned.bitmap.recycle(); throw e }
    val processedInput=try { prepare(cleaned.bitmap,request.fieldId) } catch(e:Throwable) { original.recycle(); cleaned.bitmap.recycle(); originalInput.bitmap.recycle(); throw e }
    val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val files=mutableListOf<File>(); var success=false
    try {
      fun recognize(prepared:PreparedField):Map<String,Any?> {
        val text=Tasks.await(recognizer.process(InputImage.fromBitmap(prepared.bitmap,0)),30,TimeUnit.SECONDS)
        return ReadingResult.from(text,prepared).bridge()+mapOf("confidence" to confidence(text))
      }
      val raw=recognize(originalInput)
      val processed=if(cleaned.verticalLines.isEmpty() && cleaned.horizontalLines.isEmpty())raw else recognize(processedInput)
      fun snapshot(bitmap:Bitmap):String {
        val file=DocumentImages.newFile(context,"png"); files.add(file)
        file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) }
        return Uri.fromFile(file).toString()
      }
      val diagnostics=if(BuildConfig.DEBUG && request.diagnostics)mapOf(
        "originalCrop" to snapshot(original),"processedCrop" to snapshot(cleaned.bitmap),
        "originalInput" to snapshot(originalInput.bitmap),"processedInput" to snapshot(processedInput.bitmap)
      ) else emptyMap()
      val result=mapOf("fieldId" to request.fieldId,"part" to request.part,"original" to raw,"processed" to processed,
        "x" to request.rect.left,"y" to request.rect.top,
        "sourceWidth" to original.width,"sourceHeight" to original.height,
        "inputWidth" to processedInput.bitmap.width,"inputHeight" to processedInput.bitmap.height,
        "verticalLines" to cleaned.verticalLines,"horizontalLines" to cleaned.horizontalLines,"occupiedCells" to cleaned.occupiedCells,
        "removedInkFraction" to cleaned.removedInkFraction,"diagnostics" to diagnostics)
      success=true
      return result
    } finally {
      recognizer.close(); original.recycle(); cleaned.bitmap.recycle(); originalInput.bitmap.recycle(); processedInput.bitmap.recycle()
      if(!success)files.forEach { it.delete() }
    }
  }
}
