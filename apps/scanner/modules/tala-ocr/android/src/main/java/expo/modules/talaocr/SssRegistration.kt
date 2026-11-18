package expo.modules.talaocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.opencv.android.Utils
import org.opencv.calib3d.Calib3d
import org.opencv.core.*
import org.opencv.features2d.BFMatcher
import org.opencv.features2d.SIFT
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Register the printed E-1 layout independently of paper size and printer margins. */
internal object SssRegistration {
  private const val ratio = 612.0 / 792.0

  fun automatic(context: Context, uri: String, page: Int): Map<String, Any>? {
    require(page == 1 || page == 3)
    val resource = context.resources.getIdentifier("assets_ssse1page$page", "drawable", context.packageName)
    check(resource != 0) { "The bundled E-1 reference could not be opened." }
    val reference = requireNotNull(BitmapFactory.decodeResource(context.resources, resource, BitmapFactory.Options().apply {
      inScaled = false
    }))
    return try { register(context, uri, reference, page) } finally { reference.recycle() }
  }

  fun register(context: Context, uri: String, reference: Bitmap, page: Int): Map<String, Any>? {
    OpenCvRuntime.ensure()
    val photo = DocumentImages.decode(context, uri)
    val referenceGray = Mat()
    val photoGray = Mat()
    val referencePoints = MatOfKeyPoint()
    val photoPoints = MatOfKeyPoint()
    val referenceDescriptors = Mat()
    val photoDescriptors = Mat()
    val noMask = Mat()
    val matches = ArrayList<MatOfDMatch>()
    val sift = SIFT.create(3500)
    val matcher = BFMatcher.create(Core.NORM_L2)
    try {
      describe(reference, referenceGray)
      describe(photo, photoGray)
      sift.detectAndCompute(referenceGray, noMask, referencePoints, referenceDescriptors)
      sift.detectAndCompute(photoGray, noMask, photoPoints, photoDescriptors)
      if (referenceDescriptors.rows() < 2 || photoDescriptors.rows() < 2) return null
      matcher.knnMatch(referenceDescriptors, photoDescriptors, matches, 2)
      val good = matches.mapNotNull { row ->
        val pair = row.toArray()
        pair.firstOrNull()?.takeIf { pair.size == 2 && it.distance < .73 * pair[1].distance }
      }.sortedBy { it.distance }.distinctBy { it.trainIdx }
      if (good.size < 24) return null

      val ref = referencePoints.toArray()
      val seen = photoPoints.toArray()
      val source = MatOfPoint2f(*good.map { ref[it.queryIdx].pt }.toTypedArray())
      val target = MatOfPoint2f(*good.map { seen[it.trainIdx].pt }.toTypedArray())
      val inlierMask = Mat()
      try {
        val transform = Calib3d.findHomography(source, target, Calib3d.RANSAC, 2.5, inlierMask, 3000, .995)
        try {
          if (transform.empty()) return null
          val flags = ByteArray(good.size)
          inlierMask.get(0, 0, flags)
          val inliers = good.filterIndexed { index, _ -> flags[index].toInt() != 0 }.map { ref[it.queryIdx].pt }
          if (inliers.size < 24 || inliers.size < good.size * .30) return null
          // Matches must cover the header and lower form, across both sides.
          // A locally matching logo or repeated row cannot align an entire page.
          val width = referenceGray.cols().toDouble()
          val height = referenceGray.rows().toDouble()
          val lower = if (page == 1) .76 else .39
          if (inliers.count { it.y < height * .16 } < 4 ||
              inliers.count { it.y > height * lower } < 4 ||
              inliers.count { it.x < width * .34 } < 4 ||
              inliers.count { it.x > width * .66 } < 4) return null
          val corners = project(transform, canonicalPage().map { Point(it.x * (width - 1), it.y * (height - 1)) })
            .map { Point(it.x * (photo.width - 1) / (photoGray.cols() - 1), it.y * (photo.height - 1) / (photoGray.rows() - 1)) }
          return render(context, photo, corners, page)
        } finally { transform.release() }
      } finally { source.release(); target.release(); inlierMask.release() }
    } finally {
      photo.recycle()
      referenceGray.release(); photoGray.release(); referencePoints.release(); photoPoints.release()
      referenceDescriptors.release(); photoDescriptors.release(); noMask.release()
      matches.forEach { it.release() }
      matcher.clear(); sift.clear()
    }
  }

  // The four intersections of Part I's top border and the final SSS table border.
  internal fun printedFrame(page: Int): List<Point> {
    val (left, right, top, bottom) = when (page) {
      1 -> listOf(15.36, 596.88, 99.60, 770.88)
      3 -> listOf(16.56, 595.68, 85.92, 408.84)
      else -> error("Unsupported E-1 page.")
    }
    return listOf(Point(left / 612, top / 792), Point(right / 612, top / 792),
      Point(right / 612, bottom / 792), Point(left / 612, bottom / 792))
  }

  fun manual(context: Context, uri: String, page: Int, corners: List<ScanPoint>): Map<String, Any> {
    OpenCvRuntime.ensure()
    require(ScannerGeometry.valid(corners)) { "Select all four printed frame corners clockwise." }
    val photo = DocumentImages.decode(context, uri)
    val source = MatOfPoint2f(*printedFrame(page).toTypedArray())
    val target = MatOfPoint2f(*corners.map { Point(it.x * (photo.width - 1), it.y * (photo.height - 1)) }.toTypedArray())
    try {
      val transform = Imgproc.getPerspectiveTransform(source, target)
      try {
        return requireNotNull(render(context, photo, project(transform, canonicalPage()), page)) {
          "Check the four printed frame corners and keep the filled areas in view."
        }
      } finally { transform.release() }
    } finally { photo.recycle(); source.release(); target.release() }
  }

  private fun describe(bitmap: Bitmap, gray: Mat) {
    val rgba = Mat()
    try {
      Utils.bitmapToMat(bitmap, rgba)
      val scale = min(1.0, 1500.0 / max(bitmap.width, bitmap.height))
      Imgproc.resize(rgba, rgba, Size(bitmap.width * scale, bitmap.height * scale), 0.0, 0.0, Imgproc.INTER_AREA)
      Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
    } finally { rgba.release() }
  }

  private fun canonicalPage() = listOf(Point(0.0, 0.0), Point(1.0, 0.0), Point(1.0, 1.0), Point(0.0, 1.0))

  private fun project(transform: Mat, points: List<Point>): List<Point> {
    val from = MatOfPoint2f(*points.toTypedArray())
    val to = MatOfPoint2f()
    try { Core.perspectiveTransform(from, to, transform); return to.toList() }
    finally { from.release(); to.release() }
  }

  private fun render(context: Context, photo: Bitmap, corners: List<Point>, page: Int): Map<String, Any>? {
    val normalized = corners.map { ScanPoint(it.x / (photo.width - 1), it.y / (photo.height - 1)) }
    if (normalized.any { !it.x.isFinite() || !it.y.isFinite() || it.x !in -.15..1.15 || it.y !in -.2..1.65 }) return null
    val cross = corners.indices.map { index ->
      val a = corners[index]; val b = corners[(index + 1) % 4]; val c = corners[(index + 2) % 4]
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    }
    if (cross.any { it <= 1 } || corners[0].y >= corners[3].y || corners[0].x >= corners[1].x) return null
    fun length(i: Int, j: Int) = hypot(corners[i].x - corners[j].x, corners[i].y - corners[j].y)
    val width = (length(0, 1) + length(3, 2)) / 2
    val height = (length(0, 3) + length(1, 2)) / 2
    if (min(width, height) < 480 || width / height !in .48..1.15) return null
    val from = MatOfPoint2f(*corners.toTypedArray())
    val unit = MatOfPoint2f(*canonicalPage().toTypedArray())
    val layoutToPhoto = Imgproc.getPerspectiveTransform(unit, from)
    unit.release()
    // A trimmed blank margin may be white-filled. The printed form must be visible.
    val right = .977
    val bottom = if (page == 1) .974 else .518
    val printed = try {
      project(layoutToPhoto, listOf(Point(.023, .015), Point(right, .015), Point(right, bottom), Point(.023, bottom)))
    } finally { layoutToPhoto.release() }
    if (printed.any { it.x !in -photo.width * .015..photo.width * 1.015 || it.y !in -photo.height * .015..photo.height * 1.015 }) {
      from.release()
      return null
    }
    val outputWidth = min(2318.0, width).roundToInt()
    val outputHeight = (outputWidth / ratio).roundToInt()
    val to = MatOfPoint2f(*canonicalPage().map { Point(it.x * (outputWidth - 1), it.y * (outputHeight - 1)) }.toTypedArray())
    val rgba = Mat()
    val aligned = Mat()
    val transform = Imgproc.getPerspectiveTransform(from, to)
    try {
      Utils.bitmapToMat(photo, rgba)
      Imgproc.warpPerspective(rgba, aligned, transform, Size(outputWidth.toDouble(), outputHeight.toDouble()),
        Imgproc.INTER_CUBIC, Core.BORDER_CONSTANT, Scalar(255.0, 255.0, 255.0, 255.0))
      val output = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888)
      try {
        Utils.matToBitmap(aligned, output)
        return DocumentImages.save(context, output)
      } finally { output.recycle() }
    } finally { from.release(); to.release(); rgba.release(); aligned.release(); transform.release() }
  }
}
