package expo.modules.cedulascanner

import kotlin.math.ceil

/** Timing samples only. Never retains text, document numbers or images. */
class ScanPerformance(private val capacity: Int = 120) {
  init { require(capacity > 0) }
  private val windows = mutableMapOf<String, ArrayDeque<Double>>()
  @Synchronized fun record(stage: String, elapsed: Double) {
    if (!elapsed.isFinite() || elapsed < 0) return
    val window=windows.getOrPut(stage) { ArrayDeque() }
    if (window.size == capacity) window.removeFirst()
    window.addLast(elapsed)
  }
  @Synchronized fun reset() { windows.clear() }
  @Synchronized fun snapshot(): Map<String, Map<String, Any>> = windows.mapValues { (_,window) ->
    val values=window.sorted()
    mapOf("samples" to values.size,
      "p50Ms" to values[(ceil(values.size*0.50).toInt()-1).coerceAtLeast(0)],
      "p95Ms" to values[(ceil(values.size*0.95).toInt()-1).coerceAtLeast(0)],
      "maxMs" to values.last(), "under150Percent" to 100.0*values.count { it < 150 }/values.size)
  }
}
