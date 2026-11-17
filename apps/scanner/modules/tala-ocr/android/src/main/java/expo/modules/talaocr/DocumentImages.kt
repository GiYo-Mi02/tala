package expo.modules.talaocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
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
    val options=BitmapFactory.Options().apply {
      inSampleSize=1
      inPreferredConfig=Bitmap.Config.ARGB_8888
      while (bounds.outWidth.toLong()*bounds.outHeight/inSampleSize/inSampleSize>16_000_000L || max(bounds.outWidth,bounds.outHeight)/inSampleSize>5000) inSampleSize*=2
    }
    val bitmap=requireNotNull(BitmapFactory.decodeFile(file.path,options)) { "The captured image could not be opened." }
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
      require(min(width,height)>=600) { "Move closer or retake a higher resolution photo." }
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
    val rgba=Mat(); val gray=Mat()
    try {
      val normalized=decode(context,normalizedUri)
      try { Utils.bitmapToMat(normalized,rgba) } finally { normalized.recycle() }
      Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY)
      val detection=DocumentDetector(config).detect(gray)
      gray.release(); rgba.release()
      val result=JSONObject().put("source",JSONObject(source)).put("rawUri",rawUri)
      val problem=detection?.qualityProblem(config) ?: "No reliable paper boundary. Retake or adjust the crop."
      if (detection!=null && detection.complete && detection.confidence>=config.minConfidence && detection.area in 0.12..config.maxArea) {
        val processed=warp(context,normalizedUri,detection.corners)
        result.put("processed",JSONObject(processed)).put("corners",pointsJson(detection.corners)).put("confidence",detection.confidence)
        detection.qualityProblem(config)?.let { result.put("warning",it) }
      } else {
        result.put("reason",problem)
        if(detection!=null)result.put("suggestedCorners",pointsJson(detection.corners))
      }
      return result
    } catch(e:Throwable) { privateFile(context,normalizedUri).delete(); throw e }
    finally { rgba.release(); gray.release() }
  }
}
