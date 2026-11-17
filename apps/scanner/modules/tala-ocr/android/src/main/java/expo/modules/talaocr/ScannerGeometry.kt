package expo.modules.talaocr

import kotlin.math.*

internal data class ScanPoint(val x: Double, val y: Double)
internal data class ScannerConfig(
  val stableMs: Long = 1000, val maxFrameGapMs: Long = 450, val motionTolerance: Double = 0.018,
  val minArea: Double = 0.20, val maxArea: Double = 0.94, val edgeMargin: Double = 0.015,
  val minConfidence: Double = 0.72, val minSharpness: Double = 45.0,
  val minBrightness: Double = 45.0, val maxBrightness: Double = 245.0, val maxGlare: Double = 0.20,
  val analysisIntervalMs: Long = 140, val detectionLongEdge: Int = 960,
  val hardMinBrightness: Double = 25.0, val minImageVariation: Double = 3.0
)
internal data class DocumentDetection(
  val corners: List<ScanPoint>, val confidence: Double, val area: Double,
  val sharpness: Double, val brightness: Double, val glare: Double, val complete: Boolean
) {
  fun qualityProblem(c: ScannerConfig): String? = when {
    !complete -> "Keep all paper edges visible"
    area < c.minArea -> "Move closer"
    area > c.maxArea -> "Move back slightly"
    confidence < c.minConfidence -> "Use a clearer background"
    brightness < c.minBrightness -> "Add light or turn on the flashlight"
    brightness > c.maxBrightness || glare > c.maxGlare -> "Tilt slightly to reduce glare"
    sharpness < c.minSharpness -> "Hold still for a sharper image"
    else -> null
  }
}
internal object ScannerGeometry {
  fun area(p: List<ScanPoint>): Double = abs(p.indices.sumOf { i ->
    p[i].x * p[(i + 1) % p.size].y - p[i].y * p[(i + 1) % p.size].x
  }) / 2
  fun order(points: List<ScanPoint>): List<ScanPoint> {
    val cx = points.map { it.x }.average(); val cy = points.map { it.y }.average()
    val clockwise = points.sortedBy { atan2(it.y - cy, it.x - cx) }
    val first = clockwise.indices.minBy { clockwise[it].x + clockwise[it].y }
    return (0..3).map { clockwise[(first + it) % 4] }
  }
  fun valid(p: List<ScanPoint>): Boolean {
    if (p.size != 4 || p.any { !it.x.isFinite() || !it.y.isFinite() || it.x !in 0.0..1.0 || it.y !in 0.0..1.0 }) return false
    return (0..3).all { i ->
      val a=p[i]; val b=p[(i+1)%4]; val d=p[(i+2)%4]
      (b.x-a.x)*(d.y-b.y)-(b.y-a.y)*(d.x-b.x) > 0.00001
    } && area(p) > 0.01
  }
  fun distance(a: ScanPoint, b: ScanPoint) = hypot(a.x-b.x, a.y-b.y)
  /** Inverse of Core.rotate, before CameraX maps the raw buffer to PreviewView. */
  fun rawPoint(p: ScanPoint, rawWidth: Int, rawHeight: Int, rotation: Int): ScanPoint = when (rotation) {
    90 -> ScanPoint(p.y, rawHeight-1-p.x)
    180 -> ScanPoint(rawWidth-1-p.x, rawHeight-1-p.y)
    270 -> ScanPoint(rawWidth-1-p.y, p.x)
    else -> p
  }
}

/** Uses an anchor, not only the previous frame, so slow drift cannot satisfy stability. */
internal class CaptureStability(private val config: ScannerConfig = ScannerConfig()) {
  private var anchor: List<ScanPoint>? = null
  private var started = 0L
  private var lastFrame = 0L
  private var observations = 0
  private var latched = false
  @Synchronized fun reset() { anchor=null; started=0; lastFrame=0; observations=0; latched=false }
  @Synchronized fun observe(detection: DocumentDetection?, now: Long): Boolean {
    if (latched) return false
    if (detection == null || detection.qualityProblem(config) != null) { reset(); return false }
    val previous = anchor
    val moved = previous == null || lastFrame == 0L || now-lastFrame > config.maxFrameGapMs || now < lastFrame ||
      previous.indices.any { ScannerGeometry.distance(previous[it], detection.corners[it]) > config.motionTolerance }
    if (moved) { anchor=detection.corners.toList(); started=now; observations=0 }
    lastFrame=now; observations++
    if (now-started >= config.stableMs && observations >= 5) { latched=true; return true }
    return false
  }
}
