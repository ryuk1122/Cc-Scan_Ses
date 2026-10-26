package expo.modules.cedulascanner

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CedulaScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CedulaScanner")
    View(CedulaScannerView::class) {
      Events("onObservation", "onStatus", "onBarcode", "onError")
      Prop("active") { view: CedulaScannerView, value: Boolean -> view.setActive(value) }
      Prop("torch") { view: CedulaScannerView, value: Boolean -> view.setTorch(value) }
      Prop("session") { view: CedulaScannerView, value: Int -> view.setSession(value) }
      OnViewDestroys { view: CedulaScannerView -> view.release() }
      AsyncFunction("capture") { view: CedulaScannerView, promise: Promise ->
        view.capture(promise)
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("getPerformance") { view: CedulaScannerView -> view.getPerformance() }
      AsyncFunction("resetPerformance") { view: CedulaScannerView -> view.resetPerformance() }
      AsyncFunction("recordConfirmation") { view: CedulaScannerView, firstFrameId: Double -> view.recordConfirmation(firstFrameId) }
    }
  }
}
