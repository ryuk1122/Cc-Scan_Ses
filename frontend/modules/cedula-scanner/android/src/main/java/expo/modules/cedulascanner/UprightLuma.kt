package expo.modules.cedulascanner

import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max

/** Read only the needed Y samples, respecting padding, pixel stride and camera rotation. No RGB copy. */
class UprightLuma(private val bytes: ByteBuffer, private val sourceWidth: Int, private val sourceHeight: Int,
                  private val rowStride: Int, private val pixelStride: Int, private val rotation: Int) {
  private val base = bytes.position()
  val width = if (rotation == 90 || rotation == 270) sourceHeight else sourceWidth
  val height = if (rotation == 90 || rotation == 270) sourceWidth else sourceHeight
  init {
    require(rotation in listOf(0,90,180,270))
    require(sourceWidth > 0 && sourceHeight > 0 && pixelStride > 0 && rowStride >= (sourceWidth-1)*pixelStride+1)
    require(base + (sourceHeight-1)*rowStride + (sourceWidth-1)*pixelStride < bytes.limit())
  }
  fun at(x: Int, y: Int): Int {
    require(x in 0 until width && y in 0 until height)
    val sx: Int; val sy: Int
    when (rotation) {
      90 -> { sx=y; sy=sourceHeight-1-x }
      180 -> { sx=sourceWidth-1-x; sy=sourceHeight-1-y }
      270 -> { sx=sourceWidth-1-y; sy=x }
      else -> { sx=x; sy=y }
    }
    return bytes.get(base + sy*rowStride + sx*pixelStride).toInt() and 255
  }
  fun quality(left: Int, top: Int, right: Int, bottom: Int): DoubleArray {
    require(left >= 0 && top >= 0 && right <= width && bottom <= height && right > left && bottom > top)
    var count=0; var sum=0.0; var glare=0; var lap=0.0; var lap2=0.0
    val step=max(2,(right-left)/160)
    var row=0
    for (by in top+1 until bottom-1 step step) {
      var column=0
      for (bx in left+1 until right-1 step step) {
      // Vary sampling phase: a regular grid can mistake sharp periodic strokes for a flat image.
      val x=(bx+row%step).coerceAtMost(right-2)
      val y=(by+column%step).coerceAtMost(bottom-2)
      column++
      fun gray(px: Int, py: Int)=((at(px,py)-16)*255.0/219).coerceIn(0.0,255.0)
      val v=gray(x,y)
      val edge=gray(x-1,y)+gray(x+1,y)+gray(x,y-1)+gray(x,y+1)-4*v
      sum+=v; lap+=edge; lap2+=edge*edge; count++
      if (v>250 && abs(edge)<3) glare++
      }
      row++
    }
    if (count==0) return doubleArrayOf(0.0,1.0,0.0)
    return doubleArrayOf(sum/count,glare.toDouble()/count,lap2/count-(lap/count)*(lap/count))
  }
}
