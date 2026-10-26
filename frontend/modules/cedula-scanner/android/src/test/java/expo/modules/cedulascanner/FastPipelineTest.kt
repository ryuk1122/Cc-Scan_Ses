package expo.modules.cedulascanner

import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class FastPipelineTest {
  private fun plane(rotation: Int=0): UprightLuma {
    val bytes=ByteBuffer.allocate(18)
    bytes.position(3)
    for ((i,value) in listOf(1,2,3,4,5,6).withIndex()) bytes.put(3+(i/3)*8+(i%3)*2,value.toByte())
    return UprightLuma(bytes,3,2,8,2,rotation)
  }
  private fun pixels(plane: UprightLuma)= (0 until plane.height).flatMap { y -> (0 until plane.width).map { x -> plane.at(x,y) } }

  @Test fun zeroRotationReadsPaddingPixelStrideAndBufferOffset() { assertEquals(listOf(1,2,3,4,5,6),pixels(plane())) }
  @Test fun clockwiseRotationMatchesVisibleRows() { assertEquals(listOf(4,1,5,2,6,3),pixels(plane(90))) }
  @Test fun upsideDownRotationMatchesVisibleRows() { assertEquals(listOf(6,5,4,3,2,1),pixels(plane(180))) }
  @Test fun counterclockwiseRotationMatchesVisibleRows() { assertEquals(listOf(3,6,2,5,1,4),pixels(plane(270))) }
  @Test fun samplingNeverMovesTheCameraBufferPosition() {
    val bytes=ByteBuffer.wrap(ByteArray(16)); bytes.position(4)
    val sample=UprightLuma(bytes,3,2,4,1,90)
    sample.at(0,0)
    assertEquals(4,bytes.position())
  }
  @Test fun badCoordinatesCannotReadOutsideTheImage() {
    assertThrows(IllegalArgumentException::class.java) { plane().at(-1,0) }
    assertThrows(IllegalArgumentException::class.java) { plane(90).at(2,0) }
    assertThrows(IllegalArgumentException::class.java) { plane().quality(0,0,4,2) }
  }
  @Test fun invalidPlaneCannotOverrunTheBuffer() {
    assertThrows(IllegalArgumentException::class.java) { UprightLuma(ByteBuffer.allocate(2),3,2,3,1,0) }
  }
  @Test fun sharpAndBlankRegionsRemainDistinguishableWithoutRgbConversion() {
    val sharp=ByteBuffer.allocate(32*32)
    for (y in 0 until 32) for(x in 0 until 32) sharp.put(y*32+x,if((x+y)%2==0) 16.toByte() else 235.toByte())
    val detail=UprightLuma(sharp,32,32,32,1,0).quality(0,0,32,32)
    val blank=UprightLuma(ByteBuffer.wrap(ByteArray(32*32) { 235.toByte() }),32,32,32,1,0).quality(0,0,32,32)
    assertTrue(detail[2]>65)
    assertEquals(0.0,blank[2],0.0001)
    assertEquals(1.0,blank[1],0.0001)
  }

  @Test fun frameLivesUntilBothReadersAndDispatchHaveFinished() {
    var closed=0
    val frame=FrameLease { closed++ }
    frame.retain(); frame.retain()
    frame.release(); frame.release()
    assertEquals(0,closed)
    frame.release()
    assertEquals(1,closed)
  }
  @Test fun readerStartupFailureStillReleasesFrameOnce() {
    var closed=0
    val frame=FrameLease { closed++ }
    frame.retain(); frame.release() // failed reader startup
    frame.release() // dispatch
    assertEquals(1,closed)
    assertThrows(IllegalStateException::class.java) { frame.retain() }
    assertEquals(1,closed)
  }
  @Test fun concurrentReadersCannotDoubleCloseOrLeakFrames() {
    val closed=AtomicInteger()
    val pool=Executors.newFixedThreadPool(3)
    try {
      repeat(100) {
        val frame=FrameLease { closed.incrementAndGet() }
        frame.retain(); frame.retain()
        val jobs=(0..2).map { pool.submit { frame.release() } }
        jobs.forEach { it.get() }
      }
      assertEquals(100,closed.get())
    } finally { pool.shutdown() }
  }

  @Test fun latencyStatisticsUseMeasuredValuesAndStrict150Threshold() {
    val stats=ScanPerformance()
    stats.record("detected",149.0);stats.record("detected",150.0)
    val result=stats.snapshot()["detected"]!!
    assertEquals(2,result["samples"])
    assertEquals(150.0,result["p95Ms"])
    assertEquals(50.0,result["under150Percent"])
  }
  @Test fun latencyWindowDoesNotHideRecentSlowSamplesBehindOldFastOnes() {
    val stats=ScanPerformance(3)
    listOf(10.0,20.0,300.0,400.0).forEach { stats.record("detected",it) }
    assertEquals(300.0,stats.snapshot()["detected"]!!["p50Ms"])
    assertEquals(400.0,stats.snapshot()["detected"]!!["p95Ms"])
    assertEquals(3,stats.snapshot()["detected"]!!["samples"])
  }
  @Test fun invalidAndResetTimingsNeverAppearAsFakeFastScans() {
    val stats=ScanPerformance()
    listOf(Double.NaN,Double.POSITIVE_INFINITY,-1.0).forEach { stats.record("bad",it) }
    assertTrue(stats.snapshot().isEmpty())
    stats.record("good",30.0)
    stats.reset()
    assertTrue(stats.snapshot().isEmpty())
  }
}
