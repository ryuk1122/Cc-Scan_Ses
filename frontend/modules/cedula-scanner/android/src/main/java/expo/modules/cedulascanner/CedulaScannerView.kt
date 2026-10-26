package expo.modules.cedulascanner

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.SystemClock
import android.util.Base64
import android.util.Size
import android.view.MotionEvent
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.min

/** One camera owner. All automatic frames remain in memory; only explicit capture writes a temporary file. */
class CedulaScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onObservation by EventDispatcher()
  private val onStatus by EventDispatcher()
  private val onBarcode by EventDispatcher()
  private val onError by EventDispatcher()
  private val preview = PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE }
  private val executor = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val barcodeReader = BarcodeScanning.getClient(BarcodeScannerOptions.Builder()
    .setBarcodeFormats(Barcode.FORMAT_PDF417, Barcode.FORMAT_QR_CODE).build())
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var analysis: ImageAnalysis? = null
  private var captureUseCase: ImageCapture? = null
  private var previewUseCase: Preview? = null
  @Volatile private var active = true
  @Volatile private var generation = 0
  @Volatile private var session = 0
  private var torch = false
  private val performance = ScanPerformance()
  private val resourcesClosed = AtomicBoolean(false)
  private var lastStatus = ""
  private var statusAt = 0L
  @Volatile private var attached = false
  @Volatile private var released = false

  init {
    addView(preview, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    preview.setOnTouchListener { _, event ->
      if (event.action == MotionEvent.ACTION_UP) {
        val point = preview.meteringPointFactory.createPoint(event.x, event.y)
        camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point)
          .setAutoCancelDuration(3, TimeUnit.SECONDS).build())
      }
      true
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    preview.layout(0, 0, right - left, bottom - top)
  }

  fun setActive(value: Boolean) {
    if (active != value) { active = value; generation++; status("searching", "Presenta el reverso de la cédula") }
    if (value && attached && camera == null) startCamera()
  }

  fun setTorch(value: Boolean) { torch = value; camera?.cameraControl?.enableTorch(value) }

  fun setSession(value: Int) {
    if (session != value) { session = value; generation++ }
    if (active && attached && camera == null) startCamera()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    if (active) startCamera()
  }

  override fun onDetachedFromWindow() {
    attached = false
    generation++
    analysis?.clearAnalyzer()
    val cases = listOfNotNull(previewUseCase, analysis, captureUseCase)
    if (cases.isNotEmpty()) provider?.unbind(*cases.toTypedArray())
    camera = null
    super.onDetachedFromWindow()
  }

  fun release() {
    if (released) return
    released = true
    active = false
    generation++
    analysis?.clearAnalyzer()
    val cases = listOfNotNull(previewUseCase, analysis, captureUseCase)
    if (cases.isNotEmpty()) provider?.unbind(*cases.toTypedArray())
    camera = null
    // Let the current ML Kit task release its bitmap before closing its clients.
    executor.execute { if (!busy.get()) closeResources() }
  }

  private fun status(code: String, message: String) {
    val now = SystemClock.elapsedRealtime()
    if (code == lastStatus && now - statusAt < 800) return
    lastStatus = code; statusAt = now
    onStatus(mapOf("code" to code, "message" to message, "generation" to generation, "session" to session))
  }

  private fun startCamera() {
    if (released || !attached || camera != null) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      onError(mapOf("message" to "Falta permiso de cámara", "session" to session)); return
    }
    val ticket = generation
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!attached || !active || released || ticket != generation || camera != null) return@addListener
      try {
        val owner = appContext.currentActivity as? LifecycleOwner ?: error("No hay actividad de cámara")
        val p = future.get(); provider = p
        val resolution = ResolutionSelector.Builder().setResolutionStrategy(
          ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
        val displayRotation = display?.rotation ?: 0
        val live = Preview.Builder().setTargetRotation(displayRotation).build().also { it.setSurfaceProvider(preview.surfaceProvider) }
        val frames = ImageAnalysis.Builder().setTargetRotation(displayRotation).setResolutionSelector(resolution)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        val photo = ImageCapture.Builder().setTargetRotation(displayRotation)
          .setResolutionSelector(resolution)
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
        frames.setAnalyzer(executor) { analyze(it) }
        previewUseCase = live; analysis = frames; captureUseCase = photo
        camera = p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, live, frames, photo)
        setTorch(torch)
        status("searching", "Presenta el reverso de la cédula")
      } catch (e: Exception) { onError(mapOf("message" to (e.message ?: "No se pudo iniciar la cámara"), "session" to session)) }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun closeResources() {
    if (!resourcesClosed.compareAndSet(false,true)) return
    recognizer.close(); barcodeReader.close(); executor.shutdown()
  }

  fun getPerformance() = performance.snapshot()
  fun resetPerformance() = performance.reset()
  fun recordConfirmation(firstFrameId: Double) {
    val now=SystemClock.elapsedRealtime().toDouble()
    if (firstFrameId.isFinite() && firstFrameId > 0 && firstFrameId <= now)
      performance.record("mrzConfirmationMs",now-firstFrameId)
  }

  @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
  private fun analyze(frame: ImageProxy) {
    if (!active || !attached || released || !busy.compareAndSet(false,true)) { frame.close(); return }
    val now=SystemClock.elapsedRealtime()
    val ticket=generation
    val sessionTicket=session
    val lease=FrameLease {
      try { frame.close() } finally {
        performance.record("frameProcessingMs",(SystemClock.elapsedRealtime()-now).toDouble())
        busy.set(false)
        if (released) closeResources()
      }
    }
    fun current()=active && attached && !released && generation==ticket && session==sessionTicket
    try {
      val media=frame.image ?: return
      val input=InputImage.fromMediaImage(media,frame.imageInfo.rotationDegrees)
      // Both readers see the same native buffer. Neither waits for the other to report a result.
      lease.retain()
      try {
        barcodeReader.process(input).addOnCompleteListener(executor) { task ->
          try {
            val elapsed=(SystemClock.elapsedRealtime()-now).toDouble()
            performance.record("barcodeProcessingMs",elapsed)
            if (task.isSuccessful && current()) {
              val codes=task.result
              if (codes.isNotEmpty()) performance.record("barcodeDetectedMs",elapsed)
              for (code in codes) {
                val raw=if (code.format==Barcode.FORMAT_PDF417 && code.rawBytes!=null)
                  String(code.rawBytes!!,Charsets.ISO_8859_1) else code.rawValue.orEmpty()
                if (raw.isNotEmpty()) onBarcode(mapOf("raw" to raw,
                  "type" to if (code.format==Barcode.FORMAT_PDF417) "pdf417" else "qr",
                  "frameId" to now.toDouble(),"session" to sessionTicket,"elapsedMs" to elapsed))
              }
            }
          } finally { lease.release() }
        }
      } catch (_: Exception) { lease.release() }
      lease.retain()
      try {
        recognizer.process(input).addOnCompleteListener(executor) { task ->
          try {
            performance.record("ocrProcessingMs",(SystemClock.elapsedRealtime()-now).toDouble())
            if (task.isSuccessful && current()) observe(task.result,frame,now,sessionTicket)
            else if (current()) status("retry","Mantén la cédula quieta para volver a leer")
          } catch (_: Exception) {
            if (current()) status("retry","Mantén la cédula quieta para volver a leer")
          } finally { lease.release() }
        }
      } catch (_: Exception) { lease.release() }
    } catch (_: Exception) {
      if (current()) status("retry","No pude analizar este cuadro; vuelve a alinear la cédula")
    } finally { lease.release() }
  }

  private fun observe(text: Text, frame: ImageProxy, frameId: Long, sessionTicket: Int) {
    val lines = text.textBlocks.flatMap { it.lines }.filter { it.boundingBox != null }
      .sortedBy { it.boundingBox!!.top }
    // Merge OCR fragments only if they occupy the same physical text row.
    val rows = mutableListOf<MutableList<Text.Line>>()
    for (line in lines) {
      val box = line.boundingBox!!
      val row = rows.lastOrNull()
      val anchor = row?.firstOrNull()?.boundingBox
      if (anchor != null && abs(box.centerY() - anchor.centerY()) < min(box.height(), anchor.height()) * 0.45)
        row.add(line) else rows.add(mutableListOf(line))
    }
    fun compact(row: List<Text.Line>) = row.sortedBy { it.boundingBox!!.left }.joinToString("") { it.text }
      .uppercase().replace(Regex("\\s"), "").replace(Regex("[«‹›>]"), "<")
    // Spaces are OCR word gaps, whereas '<' is a printed MRZ character.
    fun clean(row: List<Text.Line>) = compact(row).replace(" ", "")
    val start = rows.indexOfFirst { clean(it).replace("0", "O").matches(Regex("[I1][DC]<?CO[LI1].*")) }
    if (start < 0 || start + 2 >= rows.size) { status("searching", "Alinea las tres líneas del reverso y acerca la cédula"); return }
    val selected = rows.subList(start, start + 3)
    val raw = selected.map { row -> row.sortedBy { it.boundingBox!!.left }.joinToString("") { it.text }
      .uppercase().replace(Regex("\\s"), "").replace(Regex("[«‹›>]"), "<") }
    val boxes = selected.flatten().map { it.boundingBox!! }
    val roi = Rect(boxes.minOf { it.left }, boxes.minOf { it.top }, boxes.maxOf { it.right }, boxes.maxOf { it.bottom })
    val plane=frame.planes[0]
    val luma=UprightLuma(plane.buffer,frame.width,frame.height,plane.rowStride,plane.pixelStride,frame.imageInfo.rotationDegrees)
    val inBounds = roi.left > 2 && roi.top > 2 && roi.right < luma.width - 2 && roi.bottom < luma.height - 2
    if (!inBounds) { status("bounds", "Se están cortando las líneas; aleja un poco la cédula"); return }
    val qualityStart=SystemClock.elapsedRealtimeNanos()
    val quality = luma.quality(roi.left,roi.top,roi.right,roi.bottom)
    performance.record("qualityMs",(SystemClock.elapsedRealtimeNanos()-qualityStart)/1_000_000.0)
    val message = ReadingQuality.message(inBounds, boxes.minOf { it.height() },
      selected.flatten().maxOf { abs(it.angle) }, quality[0], quality[1], quality[2])
    if (message != null) { status("quality", message); return }
    performance.record("mrzDetectedMs",(SystemClock.elapsedRealtime()-frameId).toDouble())
    status("reading", "Leyendo y comprobando los datos…")
    onObservation(mapOf("raw" to raw.joinToString("\n"), "frameId" to frameId.toDouble(),
      "generation" to generation, "session" to sessionTicket, "elapsedMs" to (SystemClock.elapsedRealtime() - frameId).toDouble()))
  }

  fun capture(promise: Promise) {
    val photo = captureUseCase
    if (photo == null || !attached) { promise.reject("CAMERA_UNAVAILABLE", "La cámara no está lista", null); return }
    val file = File.createTempFile("cedula-manual-", ".jpg", context.cacheDir)
    photo.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context),
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(result: ImageCapture.OutputFileResults) {
          try { promise.resolve(Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)) }
          catch (e: Exception) { promise.reject("CAPTURE_FAILED", e.message, e) }
          finally { file.delete() }
        }
        override fun onError(error: ImageCaptureException) { file.delete(); promise.reject("CAPTURE_FAILED", error.message, error) }
      })
  }
}
