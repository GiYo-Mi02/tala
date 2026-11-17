package expo.modules.talaocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.ColorSpace
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import java.io.File
import java.util.UUID
import kotlin.math.*

internal object DocumentImages {
  private const val WORKING_LONG_EDGE=3200
  private const val WORKING_PIXELS=8_000_000.0
  fun privateFile(context: Context, uri: String): File {
    val parsed=Uri.parse(uri)
    require(parsed.scheme=="file" && parsed.authority.isNullOrEmpty()) { "Use an image in private app storage." }
    val file=File(requireNotNull(parsed.path)).canonicalFile
    require(listOf(context.cacheDir,context.filesDir).any { file.path.startsWith(it.canonicalPath+File.separator) }) { "Use an image in private app storage." }
    require(file.isFile && file.length()>0) { "The captured image is missing." }
    return file
  }
  fun decode(context: Context, uri: String, applyExif: Boolean=false): Bitmap {
    val file=privateFile(context,uri)
    val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
    BitmapFactory.decodeFile(file.path,bounds)
    require(bounds.outWidth>0 && bounds.outHeight>0) { "The captured image could not be opened." }
    val scale=min(1.0,min(WORKING_LONG_EDGE.toDouble()/max(bounds.outWidth,bounds.outHeight),
      sqrt(WORKING_PIXELS/(bounds.outWidth.toDouble()*bounds.outHeight))))
    val options=BitmapFactory.Options().apply {
      inSampleSize=1
      inPreferredConfig=Bitmap.Config.ARGB_8888
      while(inSampleSize*2<=1.0/scale)inSampleSize*=2
      if(scale<1.0) {
        inScaled=true; inDensity=1_000_000
        inTargetDensity=(scale*inSampleSize*inDensity).toInt().coerceAtLeast(1)
      }
      if(Build.VERSION.SDK_INT>=26)inPreferredColorSpace=ColorSpace.get(ColorSpace.Named.SRGB)
    }
    val decoded=requireNotNull(BitmapFactory.decodeFile(file.path,options)) { "The captured image could not be opened." }
    val bitmap=if(decoded.config==Bitmap.Config.ARGB_8888)decoded else try {
      requireNotNull(decoded.copy(Bitmap.Config.ARGB_8888,false))
    } finally { decoded.recycle() }
    bitmap.density=Bitmap.DENSITY_NONE
    if (!applyExif) return bitmap
    val orientation=ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)
    val matrix=Matrix().apply {
      when(orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f,1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f,-1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f,1f) }
        ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(270f); postScale(-1f,1f) }
      }
    }
    if (matrix.isIdentity) return bitmap
    return try { Bitmap.createBitmap(bitmap,0,0,bitmap.width,bitmap.height,matrix,true) } finally { bitmap.recycle() }
  }
  fun newFile(context:Context,suffix:String="jpg")=File(context.cacheDir,"tala-scan-${UUID.randomUUID()}.$suffix")
  fun save(context:Context,bitmap:Bitmap): Map<String,Any> {
    val file=newFile(context)
    try {
      file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG,98,it)) { "Could not save the processed image." } }
      return mapOf("uri" to Uri.fromFile(file).toString(),"width" to bitmap.width,"height" to bitmap.height)
    } catch(e:Throwable) { file.delete(); throw e }
  }
  fun pointsJson(points:List<ScanPoint>)=JSONArray(points.map { JSONObject(mapOf("x" to it.x,"y" to it.y)) })
  fun points(values:List<Map<String,Double>>)=values.map { ScanPoint(requireNotNull(it["x"]),requireNotNull(it["y"])) }

  /** Sample inside the crop: a plain rectangle is not evidence of document content. */
  private fun croppedContentIssue(bitmap:Bitmap,config:ScannerConfig):Pair<String,String>? {
    var sum=0.0; var squared=0.0; var count=0
    for(y in 0 until 64)for(x in 0 until 64) {
      val pixel=bitmap.getPixel(((x+.5)*bitmap.width/64).toInt().coerceAtMost(bitmap.width-1),
        ((y+.5)*bitmap.height/64).toInt().coerceAtMost(bitmap.height-1))
      val value=(android.graphics.Color.red(pixel)*299+android.graphics.Color.green(pixel)*587+android.graphics.Color.blue(pixel)*114)/1000.0
      sum+=value; squared+=value*value; count++
    }
    val mean=sum/count; val variation=sqrt(max(0.0,squared/count-mean*mean))
    return when {
      mean<config.hardMinBrightness -> "CAPTURE_DARK" to "The detected area is too dark to read. Uncover the lens, add light, and retake."
      variation<config.minImageVariation -> "CAPTURE_EMPTY" to "The detected area has no document detail. Point at the printed page and retake."
      else -> null
    }
  }

  /** Preserve the detected proportions; never impose A4 on an arbitrary document. */
  fun warp(context:Context,uri:String,points:List<ScanPoint>): Map<String,Any> {
    OpenCvRuntime.ensure()
    require(ScannerGeometry.valid(points)) { "Select four paper corners clockwise." }
    val input=decode(context,uri)
    val rgba=Mat(); val destination=Mat(); val src=MatOfPoint2f(); val dst=MatOfPoint2f()
    var transform:Mat?=null
    try {
      val pixels=points.map { Point(it.x*(input.width-1),it.y*(input.height-1)) }
      fun edge(a:Int,b:Int)=hypot(pixels[a].x-pixels[b].x,pixels[a].y-pixels[b].y)
      val width=(edge(0,1)+edge(3,2))/2; val height=(edge(0,3)+edge(1,2))/2
      if(min(width,height)<600)throw ScanCropResolutionException()
      val scale=min(1.0,3000.0/max(width,height))
      val w=(width*scale).roundToInt(); val h=(height*scale).roundToInt()
      Utils.bitmapToMat(input,rgba); input.recycle()
      src.fromArray(*pixels.toTypedArray())
      dst.fromArray(Point(0.0,0.0),Point((w-1).toDouble(),0.0),Point((w-1).toDouble(),(h-1).toDouble()),Point(0.0,(h-1).toDouble()))
      transform=Imgproc.getPerspectiveTransform(src,dst)
      Imgproc.warpPerspective(rgba,destination,transform,Size(w.toDouble(),h.toDouble()),Imgproc.INTER_CUBIC,Core.BORDER_CONSTANT,Scalar(255.0,255.0,255.0,255.0))
      val output=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888)
      try { Utils.matToBitmap(destination,output); return save(context,output) } finally { output.recycle() }
    } finally { if(!input.isRecycled)input.recycle(); rgba.release(); destination.release(); src.release(); dst.release(); transform?.release() }
  }

  fun process(context:Context,rawUri:String,config:ScannerConfig=ScannerConfig()): JSONObject {
    OpenCvRuntime.ensure()
    val bitmap=decode(context,rawUri,true)
    val source=try { save(context,bitmap) } finally { bitmap.recycle() }
    val normalizedUri=source["uri"] as String
    val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
    BitmapFactory.decodeFile(privateFile(context,rawUri).path,bounds)
    val result=JSONObject().put("source",JSONObject(source)).put("rawUri",rawUri).put("allowManual",true)
    fun fallback(code:String,stage:String,message:String,allowManual:Boolean=true,error:Throwable?=null):JSONObject {
      val diagnostic=JSONObject().put("code",code).put("stage",stage).put("sourceWidth",bounds.outWidth).put("sourceHeight",bounds.outHeight)
        .put("workingWidth",source["width"]).put("workingHeight",source["height"])
      // No photograph, recognized text, file path or exception message is logged.
      Log.w("TalaScanner","code=$code stage=$stage kind=${error?.javaClass?.simpleName ?: "quality"} source=${bounds.outWidth}x${bounds.outHeight} working=${source["width"]}x${source["height"]}")
      return result.put("reason",message).put("allowManual",allowManual).put("diagnostic",diagnostic)
    }
    val rgba=Mat(); val gray=Mat()
    var stage="detection"
    var correctedUri:String?=null
    try {
      val normalized=decode(context,normalizedUri)
      try { Utils.bitmapToMat(normalized,rgba) } finally { normalized.recycle() }
      Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY)
      val mean=MatOfDouble(); val deviation=MatOfDouble()
      try {
        Core.meanStdDev(gray,mean,deviation)
        if(mean.toArray()[0]<config.hardMinBrightness)
          return fallback("CAPTURE_DARK","quality","The photo is too dark or the camera is covered. Uncover the lens, add light, and retake.",false)
        if(deviation.toArray()[0]<config.minImageVariation)
          return fallback("CAPTURE_EMPTY","quality","No document detail was found. Point at the printed page and retake.",false)
      } finally { mean.release(); deviation.release() }
      val detection=DocumentDetector(config).detect(gray)
      gray.release(); rgba.release()
      val problem=detection?.qualityProblem(config) ?: "No reliable paper boundary. Retake or adjust the crop."
      if (detection!=null && detection.complete && detection.confidence>=config.minConfidence && detection.area in 0.12..config.maxArea) {
        stage="crop"
        result.put("suggestedCorners",pointsJson(detection.corners))
        val processed=warp(context,normalizedUri,detection.corners)
        correctedUri=processed["uri"] as String
        stage="content"
        val cropped=decode(context,correctedUri)
        val issue=try { croppedContentIssue(cropped,config) } finally { cropped.recycle() }
        if(issue!=null)return fallback(issue.first,"content",issue.second,false)
        result.put("processed",JSONObject(processed)).put("corners",pointsJson(detection.corners)).put("confidence",detection.confidence)
        detection.qualityProblem(config)?.let { result.put("warning",it) }
      } else {
        if(detection!=null)result.put("suggestedCorners",pointsJson(detection.corners))
        return fallback("BOUNDARY_UNCERTAIN","detection",problem)
      }
      return result
    } catch(e:ScanCropResolutionException) {
      return fallback("CROP_RESOLUTION","crop","The detected page is too small to correct clearly. Move closer and retake, or adjust the crop.",true,e)
    } catch(e:OutOfMemoryError) {
      return fallback("PROCESSING_MEMORY",stage,"There is not enough memory to correct this photo. The original is kept. Close other apps, then retake or adjust the crop.",true,e)
    } catch(e:java.io.IOException) {
      return fallback("PROCESSING_STORAGE",stage,"The corrected image could not be saved. Free some phone storage, then retake. The original is kept.",true,e)
    } catch(e:Exception) {
      return fallback(when(stage) { "crop" -> "CROP_FAILED"; "content" -> "CONTENT_CHECK_FAILED"; else -> "DETECTION_FAILED" },stage,
        "Automatic correction could not finish. The original photo is kept; retake or adjust the crop.",true,e)
    }
    finally {
      rgba.release(); gray.release()
      if(!result.has("processed"))correctedUri?.let { File(Uri.parse(it).path!!).delete() }
    }
  }
}

internal class ScanCropResolutionException:IllegalArgumentException("Move closer or retake a higher resolution photo.")
