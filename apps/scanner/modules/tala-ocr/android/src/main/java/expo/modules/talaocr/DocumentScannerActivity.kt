package expo.modules.talaocr

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.util.Size
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.core.resolutionselector.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.camera.view.transform.CoordinateTransform
import androidx.camera.view.transform.ImageProxyTransformFactory
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/** Native camera owns only cache candidates; React owns review, OCR and persistent acceptance. */
class DocumentScannerActivity : ComponentActivity() {
  private lateinit var preview:PreviewView
  private lateinit var overlay:BoundaryOverlay
  private lateinit var status:TextView
  private lateinit var captureButton:Button
  private lateinit var lightButton:Button
  private lateinit var autoButton:Button
  private lateinit var permissionButton:Button
  private val worker=Executors.newSingleThreadExecutor()
  private val processing=AtomicBoolean(false)
  private val opening=AtomicBoolean(false)
  private var provider:ProcessCameraProvider?=null
  private var imageCapture:ImageCapture?=null
  private var analyzer:ImageAnalysis?=null
  private var camera:Camera?=null
  @Volatile private var autoEnabled=true
  private var torchEnabled=false
  private var lastAnalyzed=0L
  private var delivered=false
  @Volatile private var active=false
  private val owned=java.util.Collections.synchronizedSet(mutableSetOf<File>())
  private lateinit var config:ScannerConfig
  private lateinit var stability:CaptureStability
  private val permission=registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if(granted)startCamera() else showPermission()
  }

  override fun onCreate(savedInstanceState:Bundle?) {
    super.onCreate(savedInstanceState)
    val options=try { JSONObject(intent.getStringExtra("config") ?: "{}") } catch(_:Exception) { JSONObject() }
    config=ScannerConfig(
      stableMs=options.optLong("stableMs",1000).coerceIn(800,1500),
      motionTolerance=options.optDouble("motionTolerance",0.018).coerceIn(0.005,0.05),
      minSharpness=options.optDouble("minSharpness",45.0).coerceIn(5.0,250.0),
      minBrightness=options.optDouble("minBrightness",45.0).coerceIn(10.0,100.0),
      maxGlare=options.optDouble("maxGlare",0.20).coerceIn(0.05,0.5)
    )
    stability=CaptureStability(config)
    val root=FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    preview=PreviewView(this).apply { implementationMode=PreviewView.ImplementationMode.COMPATIBLE; scaleType=PreviewView.ScaleType.FILL_CENTER }
    root.addView(preview,FrameLayout.LayoutParams(-1,-1))
    overlay=BoundaryOverlay(this); root.addView(overlay,FrameLayout.LayoutParams(-1,-1))
    val controls=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER; setPadding(dp(16),dp(16),dp(16),dp(16)) }
    val top=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
    fun button(label:String, action:()->Unit)=Button(this).apply {
      text=label; contentDescription=label; minHeight=dp(48); setOnClickListener { action() }
    }
    top.addView(button("Back") { cancelScan() },LinearLayout.LayoutParams(0,dp(56),1f))
    autoButton=button("Auto: On") { autoEnabled=!autoEnabled; autoButton.text=if(autoEnabled)"Auto: On" else "Auto: Off"; stability.reset() }
    top.addView(autoButton,LinearLayout.LayoutParams(0,dp(56),1f))
    lightButton=button("Light: Off") {
      val selected=camera ?: return@button
      if(!selected.cameraInfo.hasFlashUnit())return@button
      torchEnabled=!torchEnabled
      selected.cameraControl.enableTorch(torchEnabled).addListener({ lightButton.text=if(torchEnabled)"Light: On" else "Light: Off" },ContextCompat.getMainExecutor(this))
    }
    top.addView(lightButton,LinearLayout.LayoutParams(0,dp(56),1f)); controls.addView(top)
    status=TextView(this).apply {
      text="Opening camera…"; textSize=16f; setTextColor(Color.WHITE); setBackgroundColor(0xCC142D29.toInt())
      gravity=Gravity.CENTER; setPadding(dp(12),dp(10),dp(12),dp(10)); accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    controls.addView(status,LinearLayout.LayoutParams(-1,-2))
    permissionButton=button("Allow camera") {
      if(shouldShowRequestPermissionRationale(Manifest.permission.CAMERA))permission.launch(Manifest.permission.CAMERA)
      else startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))
    }.apply { visibility=View.GONE }
    controls.addView(permissionButton)
    controls.addView(View(this),LinearLayout.LayoutParams(1,0,1f))
    val hint=TextView(this).apply { text="Point at the whole document and hold steady."; setTextColor(Color.WHITE); gravity=Gravity.CENTER; textSize=14f; setPadding(0,dp(8),0,dp(8)) }
    controls.addView(hint)
    captureButton=button("Capture") { capture(false) }.apply { isEnabled=false }
    controls.addView(captureButton,LinearLayout.LayoutParams(-1,dp(64)))
    root.addView(controls,FrameLayout.LayoutParams(-1,-1)); setContentView(root)
    preview.previewStreamState.observe(this) { state ->
      if(active && !processing.get()) {
        captureButton.isEnabled=state==PreviewView.StreamState.STREAMING
        if(state==PreviewView.StreamState.STREAMING)status.text="Searching for document"
      }
    }
    ViewCompat.setOnApplyWindowInsetsListener(controls) { v,insets ->
      val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(dp(16)+bars.left,dp(12)+bars.top,dp(16)+bars.right,dp(12)+bars.bottom); insets
    }
    onBackPressedDispatcher.addCallback(this,object:OnBackPressedCallback(true) { override fun handleOnBackPressed() { cancelScan() } })
    if(ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)permission.launch(Manifest.permission.CAMERA)
    else preview.post { startCamera() }
  }
  override fun onResume() {
    super.onResume(); active=true; if(::stability.isInitialized)stability.reset()
    if(::preview.isInitialized && ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED && camera==null && !processing.get())preview.post { startCamera() }
  }
  override fun onPause() {
    active=false; stability.reset(); camera?.cameraControl?.enableTorch(false); torchEnabled=false
    if(::lightButton.isInitialized)lightButton.text="Light: Off"
    if(::captureButton.isInitialized)captureButton.isEnabled=false
    super.onPause()
  }
  private fun showPermission() {
    status.text="Camera access is needed. Allow it in app settings, then return here."
    permissionButton.visibility=View.VISIBLE; captureButton.isEnabled=false
  }
  private fun startCamera() {
    if(!active || processing.get() || camera!=null || !opening.compareAndSet(false,true))return
    permissionButton.visibility=View.GONE
    worker.execute {
      try { OpenCvRuntime.ensure() } catch(_:Throwable) {
        opening.set(false); runOnUiThread { status.text="The offline scanner could not open. Close and reopen it." }; return@execute
      }
      runOnUiThread {
        if(isFinishing || !active) { opening.set(false); return@runOnUiThread }
        val future=ProcessCameraProvider.getInstance(this)
        future.addListener({
          if(isFinishing || !active) { opening.set(false); return@addListener }
          try {
            val cameraProvider=future.get(); provider=cameraProvider
            val aspect=AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
            val live=Preview.Builder().setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspect).build()).build()
            val analysis=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
              .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspect)
                .setResolutionStrategy(ResolutionStrategy(Size(640,480),ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build()).build()
            val still=ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
              .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspect)
                .setResolutionStrategy(ResolutionStrategy(Size(4032,3024),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()).build()
            val viewport=preview.viewPort
            if(viewport==null) { opening.set(false); preview.post { camera=null; startCamera() }; return@addListener }
            live.setSurfaceProvider(preview.surfaceProvider)
            analysis.setAnalyzer(worker) { image -> analyze(image) }
            val group=UseCaseGroup.Builder().setViewPort(viewport).addUseCase(live).addUseCase(analysis).addUseCase(still).build()
            cameraProvider.unbindAll(); camera=cameraProvider.bindToLifecycle(this,CameraSelector.DEFAULT_BACK_CAMERA,group)
            imageCapture=still; analyzer=analysis; lightButton.isEnabled=camera?.cameraInfo?.hasFlashUnit()==true
            captureButton.isEnabled=preview.previewStreamState.value==PreviewView.StreamState.STREAMING; status.text="Opening camera…"
            camera?.cameraInfo?.cameraState?.observe(this) { state ->
              if(state.error!=null && active && !processing.get()) { captureButton.isEnabled=false; status.text="Camera interrupted. Close other camera apps and reopen the scanner." }
            }
            // CameraX continuously handles AE/AF; start with a metered center focus as well.
            val point=preview.meteringPointFactory.createPoint(preview.width/2f,preview.height/2f)
            camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point,FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE).build())
          } catch(_:Exception) { status.text="Camera could not open. Close other camera apps and retry."; captureButton.isEnabled=false }
          finally { opening.set(false) }
        },ContextCompat.getMainExecutor(this))
      }
    }
  }

  @androidx.annotation.OptIn(androidx.camera.view.TransformExperimental::class)
  private fun analyze(image:ImageProxy) {
    try {
      val now=SystemClock.elapsedRealtime()
      if(!active || processing.get() || now-lastAnalyzed<config.analysisIntervalMs)return
      lastAnalyzed=now
      val w=image.width; val h=image.height; val plane=image.planes[0]; val buffer=plane.buffer.duplicate()
      val offset=buffer.position()
      val pixels=ByteArray(w*h)
      for(y in 0 until h) for(x in 0 until w) pixels[y*w+x]=buffer.get(offset+y*plane.rowStride+x*plane.pixelStride)
      val gray=Mat(h,w,CvType.CV_8UC1); val rotated=Mat()
      val rect=image.cropRect
      var detection:DocumentDetection?=null
      try {
        gray.put(0,0,pixels)
        val crop=gray.submat(rect.top,rect.bottom,rect.left,rect.right)
        try {
          when(image.imageInfo.rotationDegrees) {
            90 -> Core.rotate(crop,rotated,Core.ROTATE_90_CLOCKWISE)
            180 -> Core.rotate(crop,rotated,Core.ROTATE_180)
            270 -> Core.rotate(crop,rotated,Core.ROTATE_90_COUNTERCLOCKWISE)
            else -> crop.copyTo(rotated)
          }
          detection=DocumentDetector(config).detect(rotated)
          val d=detection
          val points=d?.corners?.flatMap {
            val p=ScannerGeometry.rawPoint(ScanPoint(it.x*(rotated.cols()-1),it.y*(rotated.rows()-1)),rect.width(),rect.height(),image.imageInfo.rotationDegrees)
            listOf((p.x+rect.left).toFloat(),(p.y+rect.top).toFloat())
          }?.toFloatArray()
          val transform=ImageProxyTransformFactory().getOutputTransform(image)
          runOnUiThread {
            if(!active || processing.get())return@runOnUiThread
            val target=preview.outputTransform
            if(points!=null && target!=null) {
              CoordinateTransform(transform,target).mapPoints(points)
              overlay.update(points,d?.qualityProblem(config)==null)
            } else overlay.update(null,false)
            status.text=if(d==null)"Searching for document" else d.qualityProblem(config) ?: "Hold steady"
          }
        } finally { crop.release() }
      } finally { gray.release(); rotated.release() }
      val ready=stability.observe(detection,now)
      if(ready && autoEnabled)runOnUiThread { if(active && autoEnabled && preview.outputTransform!=null)capture(true) else stability.reset() }
    } catch(_:Exception) {
      stability.reset(); runOnUiThread { if(!processing.get()) { overlay.update(null,false); status.text="Adjust position or capture manually" } }
    } finally { image.close() }
  }
  private fun capture(automatic:Boolean) {
    val still=imageCapture ?: return
    if(!active || !processing.compareAndSet(false,true))return
    captureButton.isEnabled=false; autoButton.isEnabled=false; lightButton.isEnabled=false; status.text=if(automatic)"Ready · capturing…" else "Capturing…"
    val raw=DocumentImages.newFile(this); owned.add(raw)
    still.takePicture(ImageCapture.OutputFileOptions.Builder(raw).build(),ContextCompat.getMainExecutor(this),object:ImageCapture.OnImageSavedCallback {
      override fun onError(exception:ImageCaptureException) { raw.delete(); failCapture("Capture failed. Hold steady and try again.") }
      override fun onImageSaved(output:ImageCapture.OutputFileResults) {
        status.text="Straightening document…"; analyzer?.clearAnalyzer(); provider?.unbindAll(); camera=null
        worker.execute {
          try {
            val result=DocumentImages.process(this@DocumentScannerActivity,Uri.fromFile(raw).toString(),config)
            val source=result.getJSONObject("source"); owned.add(File(Uri.parse(source.getString("uri")).path!!))
            result.optJSONObject("processed")?.let { owned.add(File(Uri.parse(it.getString("uri")).path!!)) }
            val metadata=DocumentImages.newFile(this@DocumentScannerActivity,"json"); owned.add(metadata)
            metadata.writeText(result.toString())
            runOnUiThread {
              if(isFinishing || isDestroyed) { cleanup(); return@runOnUiThread }
              delivered=true; setResult(Activity.RESULT_OK,Intent().putExtra("resultPath",metadata.path)); finish()
            }
          } catch(_:Throwable) { runOnUiThread { failCapture("Image processing failed. Retake or close the scanner.") } }
        }
      }
    })
  }
  private fun failCapture(message:String) {
    if(isDestroyed)return
    cleanup(); processing.set(false); stability.reset(); autoEnabled=false
    autoButton.text="Auto: Off"; autoButton.isEnabled=true; status.text=message
    if(camera==null)startCamera() else { captureButton.isEnabled=true; lightButton.isEnabled=camera?.cameraInfo?.hasFlashUnit()==true }
  }
  private fun cleanup() { synchronized(owned) { owned.forEach { it.delete() }; owned.clear() } }
  private fun cancelScan() { if(processing.get())return; setResult(Activity.RESULT_CANCELED); finish() }
  override fun onDestroy() {
    active=false; analyzer?.clearAnalyzer(); provider?.unbindAll(); worker.shutdown()
    if(!delivered)cleanup()
    super.onDestroy()
  }
  private fun dp(value:Int)=(value*resources.displayMetrics.density).toInt()
}

private class BoundaryOverlay(context:android.content.Context):View(context) {
  private var polygon:FloatArray?=null
  private var ready=false
  private var updated=0L
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { style=Paint.Style.STROKE; strokeWidth=3*resources.displayMetrics.density }
  fun update(points:FloatArray?,valid:Boolean) {
    val old=polygon
    if(points==null) { if(SystemClock.elapsedRealtime()-updated>300)polygon=null; ready=false }
    else {
      polygon=if(old!=null && old.indices.all { kotlin.math.abs(old[it]-points[it])<width*0.08 })FloatArray(8) { old[it]*0.60f+points[it]*0.40f } else points.copyOf()
      ready=valid; updated=SystemClock.elapsedRealtime()
    }
    invalidate()
  }
  override fun onDraw(canvas:Canvas) {
    super.onDraw(canvas)
    val p=polygon ?: return
    val path=Path().apply { moveTo(p[0],p[1]); for(i in 1..3)lineTo(p[i*2],p[i*2+1]); close() }
    paint.color=if(ready)Color.rgb(76,235,168) else Color.rgb(255,192,76)
    canvas.drawPath(path,paint)
    for(i in 0..3)canvas.drawCircle(p[i*2],p[i*2+1],6*resources.displayMetrics.density,paint)
  }
}
