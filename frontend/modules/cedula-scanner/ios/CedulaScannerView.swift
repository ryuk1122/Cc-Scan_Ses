import AVFoundation
import CoreImage
import ExpoModulesCore
import Vision
import UIKit

final class CedulaScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onObservation = EventDispatcher()
  let onStatus = EventDispatcher()
  let onBarcode = EventDispatcher()
  let onError = EventDispatcher()
  private let camera = AVCaptureSession()
  private let queue = DispatchQueue(label: "ses.cedula.camera", qos: .userInitiated)
  private let ciContext = CIContext()
  private var preview: AVCaptureVideoPreviewLayer!
  private var device: AVCaptureDevice?
  private var configured = false
  private var active = false
  private var attached = false
  private var foreground = true
  private var torch = false
  private var sessionID = 0
  private var generation = 0
  private var frameID = 0
  private var lastFrameTime = 0.0
  private var lastBarcodeTime = 0.0
  private var lastStatusTime = 0.0
  private var latestImage: CGImage?
  private var metrics: [String: [Double]] = [:]
  private var firstFrameTimes: [Int: Double] = [:]
  private var observers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    preview = AVCaptureVideoPreviewLayer(session: camera)
    preview.videoGravity = .resizeAspectFill
    layer.insertSublayer(preview, at: 0)
    foreground = UIApplication.shared.applicationState == .active
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in self?.foreground = false; self?.reconcile() }
    })
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in self?.foreground = true; self?.reconcile() }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: camera, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in self?.latestImage = nil; self?.status("paused", "Cámara interrumpida; vuelve a la aplicación") }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: camera, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in self?.generation += 1; self?.reconcile() }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: camera, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in
        guard let self else { return }
        self.latestImage = nil
        self.generation += 1
        self.emit(self.onError, ["message": "La cámara se detuvo. Pulsa Reiniciar cámara para volver a abrirla"])
      }
    })
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
    if preview.connection?.isVideoOrientationSupported == true { preview.connection?.videoOrientation = .portrait }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    let present = window != nil
    queue.async { [weak self] in self?.attached = present; self?.reconcile() }
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    let session = camera
    queue.async { if session.isRunning { session.stopRunning() } }
  }

  func setActive(_ value: Bool) {
    queue.async { [weak self] in
      guard let self else { return }
      if self.active != value { self.generation += 1; self.latestImage = nil }
      self.active = value
      self.reconcile()
    }
  }
  func setSession(_ value: Int) {
    queue.async { [weak self] in
      guard let self else { return }
      if self.sessionID != value { self.latestImage = nil; self.generation += 1 }
      self.sessionID = value
    }
  }
  func setTorch(_ value: Bool) {
    queue.async { [weak self] in self?.torch = value; self?.applyTorch() }
  }

  private func reconcile() {
    guard active && attached && foreground else {
      latestImage = nil
      if camera.isRunning { camera.stopRunning() }
      applyTorch()
      return
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      emit(onError, ["message": "Permite el acceso a la cámara en Ajustes del iPhone"])
      return
    }
    do {
      if !configured { try configure() }
      if !camera.isRunning { camera.startRunning() }
      applyTorch()
    } catch { emit(onError, ["message": "No se pudo iniciar la cámara: \(error.localizedDescription)"]) }
  }

  private func configure() throws {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      throw NSError(domain: "CedulaScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "No hay cámara trasera disponible"])
    }
    let input = try AVCaptureDeviceInput(device: device)
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.setSampleBufferDelegate(self, queue: queue)
    camera.beginConfiguration()
    defer { camera.commitConfiguration() }
    camera.sessionPreset = camera.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
    guard camera.canAddInput(input), camera.canAddOutput(output) else {
      throw NSError(domain: "CedulaScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "La cámara no admite el lector"])
    }
    camera.addInput(input)
    camera.addOutput(output)
    if output.connection(with: .video)?.isVideoOrientationSupported == true { output.connection(with: .video)?.videoOrientation = .portrait }
    self.device = device
    try device.lockForConfiguration()
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
    device.isSubjectAreaChangeMonitoringEnabled = true
    device.unlockForConfiguration()
    configured = true
  }

  private func applyTorch() {
    guard let device, device.hasTorch else { return }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      let enabled = torch && active && foreground && attached && camera.isRunning
      if enabled { try device.setTorchModeOn(level: 0.35) } else { device.torchMode = .off }
    } catch { status("lighting", "No se pudo cambiar la luz; prueba con iluminación ambiental") }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard active && attached && foreground, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastFrameTime >= 0.16 else { return }
    lastFrameTime = now
    frameID += 1
    let id = frameID
    firstFrameTimes[id] = now
    if firstFrameTimes.count > 90 { firstFrameTimes = firstFrameTimes.filter { $0.key > id - 60 } }
    let image = CIImage(cvPixelBuffer: buffer)
    latestImage = ciContext.createCGImage(image, from: image.extent)
    if now - lastBarcodeTime >= 0.4 {
      lastBarcodeTime = now
      let started = ProcessInfo.processInfo.systemUptime
      if let result = CedulaBarcodeDecoder.decodePixelBuffer(buffer) {
        record("barcodeDetectedMs", (ProcessInfo.processInfo.systemUptime - started) * 1000)
        emit(onBarcode, result)
      }
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.012
    do {
      let started = ProcessInfo.processInfo.systemUptime
      try VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up).perform([request])
      record("ocrProcessingMs", (ProcessInfo.processInfo.systemUptime - started) * 1000)
      let lines = (request.results ?? []).compactMap { result -> MrzTextLine? in
        guard let text = result.topCandidates(1).first?.string else { return nil }
        return MrzTextLine(text: text, x: Double(result.boundingBox.minX), y: Double(result.boundingBox.midY), height: Double(result.boundingBox.height))
      }
      record("ocrLines", Double(lines.count))
      if let raw = MrzCandidates.find(lines) {
        record("mrzDetectedMs", (ProcessInfo.processInfo.systemUptime - started) * 1000)
        emit(onObservation, ["raw": raw, "frameId": id, "generation": generation, "guidance": "Mantén visibles las tres líneas"])
      } else { status("searching", "Presenta el reverso completo; evita reflejos sobre las líneas") }
    } catch { status("searching", "Vuelve a enfocar el reverso de la cédula") }
  }

  private func emit(_ dispatcher: EventDispatcher, _ payload: [String: Any]) {
    var data = payload
    data["session"] = sessionID
    DispatchQueue.main.async { dispatcher(data) }
  }
  private func status(_ code: String, _ message: String) {
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastStatusTime > 0.4 else { return }
    lastStatusTime = now
    emit(onStatus, ["code": code, "message": message])
  }
  func capture(_ promise: Promise) {
    queue.async { [weak self] in
      guard let self, self.active, self.foreground, self.attached, let image = self.latestImage,
        let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.88) else {
        promise.reject("CAMERA_NOT_READY", "La cámara no tiene una imagen disponible")
        return
      }
      promise.resolve(data.base64EncodedString())
    }
  }
  private func record(_ key: String, _ value: Double) {
    metrics[key, default: []].append(value)
    if metrics[key]!.count > 200 { metrics[key]!.removeFirst() }
  }
  func recordConfirmation(_ firstFrameID: Double) {
    queue.async { [weak self] in
      guard let self, let start = self.firstFrameTimes[Int(firstFrameID)] else { return }
      self.record("mrzConfirmationMs", (ProcessInfo.processInfo.systemUptime - start) * 1000)
    }
  }
  func resetPerformance() { queue.async { [weak self] in self?.metrics.removeAll(); self?.firstFrameTimes.removeAll() } }
  func getPerformance(_ promise: Promise) {
    queue.async { [weak self] in
      guard let self else { promise.resolve([String: Any]()); return }
      var result: [String: Any] = [:]
      for (key, values) in self.metrics where !values.isEmpty {
        let sorted = values.sorted()
        result[key] = ["samples": values.count, "p50Ms": sorted[sorted.count / 2],
          "p95Ms": sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))],
          "maxMs": sorted.last!, "under150Percent": Double(values.filter { $0 < 150 }.count) * 100 / Double(values.count)] as [String: Any]
      }
      promise.resolve(result)
    }
  }
}
