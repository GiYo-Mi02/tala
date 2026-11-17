package expo.modules.talaocr

import org.opencv.android.OpenCVLoader
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import kotlin.math.*

internal object OpenCvRuntime {
  @Volatile private var initialized = false
  @Synchronized fun ensure() {
    if (!initialized) { check(OpenCVLoader.initLocal()) { "The offline image processor could not open." }; initialized=true }
  }
}

/** Stateless detector: all native Mats are released on every success/failure path. */
internal class DocumentDetector(private val config: ScannerConfig = ScannerConfig()) {
  fun detect(sourceGray: Mat): DocumentDetection? {
    OpenCvRuntime.ensure()
    val scaled=Mat(); val blurred=Mat(); val edges=Mat(); val closed=Mat(); val hierarchy=Mat()
    val contours=ArrayList<MatOfPoint>()
    val kernel=Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0,3.0))
    try {
      val scale=min(1.0,config.detectionLongEdge.toDouble()/max(sourceGray.cols(),sourceGray.rows()))
      Imgproc.resize(sourceGray,scaled,Size(sourceGray.cols()*scale,sourceGray.rows()*scale),0.0,0.0,Imgproc.INTER_AREA)
      Imgproc.GaussianBlur(scaled,blurred,Size(5.0,5.0),0.0)
      val mean=Core.mean(blurred).`val`[0]
      Imgproc.Canny(blurred,edges,max(18.0,mean*0.30),max(55.0,mean*0.85))
      Imgproc.morphologyEx(edges,closed,Imgproc.MORPH_CLOSE,kernel)
      Imgproc.findContours(closed,contours,hierarchy,Imgproc.RETR_LIST,Imgproc.CHAIN_APPROX_SIMPLE)
      val frameArea=scaled.cols().toDouble()*scaled.rows()
      var best: DocumentDetection?=null
      var bestRank=0.0
      for (contour in contours.sortedByDescending { abs(Imgproc.contourArea(it)) }.take(30)) {
        if (abs(Imgproc.contourArea(contour))/frameArea < 0.12) continue
        val curve=MatOfPoint2f(*contour.toArray()); val approx=MatOfPoint2f()
        try {
          Imgproc.approxPolyDP(curve,approx,Imgproc.arcLength(curve,true)*0.018,true)
          if (approx.total()!=4L) continue
          val polygon=MatOfPoint(*approx.toArray())
          val convex=try { Imgproc.isContourConvex(polygon) } finally { polygon.release() }
          if (!convex) continue
          val p=ScannerGeometry.order(approx.toArray().map { ScanPoint(it.x/(scaled.cols()-1),it.y/(scaled.rows()-1)) })
          if (!ScannerGeometry.valid(p)) continue
          val area=ScannerGeometry.area(p)
          val pixel=p.map { Point(it.x*(scaled.cols()-1),it.y*(scaled.rows()-1)) }
          fun length(a:Int,b:Int)=hypot(pixel[a].x-pixel[b].x,pixel[a].y-pixel[b].y)
          val horizontal=(length(0,1)+length(3,2))/2; val vertical=(length(0,3)+length(1,2))/2
          if (horizontal/vertical !in 0.32..3.1 || max(length(0,1),length(3,2))/min(length(0,1),length(3,2))>2.4 ||
            max(length(0,3),length(1,2))/min(length(0,3),length(1,2))>2.4) continue
          val cosines=(0..3).map { i ->
            val a=pixel[(i+3)%4]; val b=pixel[i]; val c=pixel[(i+1)%4]
            abs(((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y))/(hypot(a.x-b.x,a.y-b.y)*hypot(c.x-b.x,c.y-b.y)))
          }
          if (cosines.max()>0.82) continue
          var hits=0; var samples=0
          for (i in 0..3) for (step in 0..40) {
            val a=pixel[i]; val b=pixel[(i+1)%4]; val t=step/40.0
            val x=(a.x+(b.x-a.x)*t).roundToInt(); val y=(a.y+(b.y-a.y)*t).roundToInt()
            var found=false
            for (dy in -2..2) for (dx in -2..2) {
              val xx=x+dx; val yy=y+dy
              if (xx in 0 until edges.cols() && yy in 0 until edges.rows() && edges.get(yy,xx)[0]>0) found=true
            }
            if (found) hits++; samples++
          }
          val edgeStrength=hits.toDouble()/samples
          if (edgeStrength<0.68) continue
          // A paper edge separates two surfaces. Internal table rules have white
          // paper on both sides and must not become the outer document crop.
          val center=Point(pixel.map { it.x }.average(),pixel.map { it.y }.average())
          var contrasting=0; var contrastSamples=0
          for(i in 0..3) for(step in 3..17) {
            val a=pixel[i]; val b=pixel[(i+1)%4]; val t=step/20.0
            val x=a.x+(b.x-a.x)*t; val y=a.y+(b.y-a.y)*t
            val dx=center.x-x; val dy=center.y-y; val length=hypot(dx,dy)
            val ix=(x+dx/length*8).roundToInt(); val iy=(y+dy/length*8).roundToInt()
            val ox=(x-dx/length*8).roundToInt(); val oy=(y-dy/length*8).roundToInt()
            if(ix in 0 until scaled.cols() && ox in 0 until scaled.cols() && iy in 0 until scaled.rows() && oy in 0 until scaled.rows()) {
              if(abs(scaled.get(iy,ix)[0]-scaled.get(oy,ox)[0])>=12)contrasting++
              contrastSamples++
            }
          }
          if(contrastSamples<30 || contrasting.toDouble()/contrastSamples<0.55)continue
          val confidence=(0.60*edgeStrength+0.25*(1-cosines.average())+0.15*min(1.0,area/0.45)).coerceIn(0.0,1.0)
          val mask=Mat.zeros(scaled.rows(),scaled.cols(),CvType.CV_8UC1)
          val maskPoly=MatOfPoint(*pixel.toTypedArray()); val laplacian=Mat(); val meanMat=MatOfDouble(); val std=MatOfDouble()
          try {
            Imgproc.fillConvexPoly(mask,maskPoly,Scalar(255.0))
            // Exclude the strong outer paper edge from the sharpness estimate.
            val erosion=Imgproc.getStructuringElement(Imgproc.MORPH_RECT,Size(9.0,9.0))
            try { Imgproc.erode(mask,mask,erosion) } finally { erosion.release() }
            Imgproc.Laplacian(scaled,laplacian,CvType.CV_64F)
            Core.meanStdDev(laplacian,meanMat,std,mask)
            val brightness=Core.mean(scaled,mask).`val`[0]
            // Glare is saturated low-texture area, rather than ordinary white paper.
            val saturated=Mat(); val texture=Mat(); val textureAbs=Mat()
            val glare=try {
              Core.inRange(scaled,Scalar(253.0),Scalar(255.0),saturated)
              Core.convertScaleAbs(laplacian,textureAbs)
              Core.inRange(textureAbs,Scalar(0.0),Scalar(1.0),texture)
              Core.bitwise_and(saturated,texture,saturated); Core.bitwise_and(saturated,mask,saturated)
              // White sheets are common; only reject saturation when the rest of the page is dim.
              if (brightness<200) Core.countNonZero(saturated).toDouble()/max(1,Core.countNonZero(mask)) else 0.0
            } finally { saturated.release(); texture.release(); textureAbs.release() }
            val complete=p.all { it.x>config.edgeMargin && it.y>config.edgeMargin && it.x<1-config.edgeMargin && it.y<1-config.edgeMargin }
            val detection=DocumentDetection(p,confidence,area,std.toArray()[0].pow(2),brightness,glare,complete)
            // A large, complete exterior paper boundary outranks inner table cells.
            val rank=area*confidence*(if(complete) 1.0 else 0.5)
            if (rank>bestRank) { best=detection; bestRank=rank }
          } finally { mask.release(); maskPoly.release(); laplacian.release(); meanMat.release(); std.release() }
        } finally { curve.release(); approx.release() }
      }
      return best
    } finally {
      contours.forEach { it.release() }; scaled.release(); blurred.release(); edges.release(); closed.release(); hierarchy.release(); kernel.release()
    }
  }
}
