import ExpoModulesCore

public final class CedulaScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CedulaScanner")
    View(CedulaScannerView.self) {
      Events("onObservation", "onStatus", "onBarcode", "onError")
      Prop("active") { (view: CedulaScannerView, value: Bool) in view.setActive(value) }
      Prop("torch") { (view: CedulaScannerView, value: Bool) in view.setTorch(value) }
      Prop("session") { (view: CedulaScannerView, value: Int) in view.setSession(value) }
      AsyncFunction("capture") { (view: CedulaScannerView, promise: Promise) in view.capture(promise) }
      AsyncFunction("getPerformance") { (view: CedulaScannerView, promise: Promise) in view.getPerformance(promise) }
      AsyncFunction("resetPerformance") { (view: CedulaScannerView) in view.resetPerformance() }
      AsyncFunction("recordConfirmation") { (view: CedulaScannerView, firstFrameId: Double) in view.recordConfirmation(firstFrameId) }
    }
  }
}
