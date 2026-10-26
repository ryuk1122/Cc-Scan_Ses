package expo.modules.cedulascanner

import java.util.concurrent.atomic.AtomicInteger

/** The camera buffer stays alive until every asynchronous reader has finished with it. */
class FrameLease(private val close: () -> Unit) {
  private val readers = AtomicInteger(1)
  fun retain() {
    while (true) {
      val count=readers.get()
      check(count > 0)
      if (readers.compareAndSet(count,count+1)) return
    }
  }
  fun release() {
    val remaining = readers.decrementAndGet()
    check(remaining >= 0)
    if (remaining == 0) close()
  }
}
