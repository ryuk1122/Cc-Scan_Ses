package expo.modules.cedulascanner

import org.junit.Assert.*
import org.junit.Test

class ReadingQualityTest {
  @Test fun readableWhiteCardMustNotBeRejectedAsGlare() {
    assertNull(ReadingQuality.message(true, 22, 0f, 245.0, 0.95, 180.0))
  }
  @Test fun obscuringGlareRequiresCorrection() {
    assertTrue(ReadingQuality.message(true, 22, 0f, 245.0, 0.95, 25.0)!!.contains("reflejo"))
  }
  @Test fun blurRequiresFocusInsteadOfGuessing() {
    assertTrue(ReadingQuality.message(true, 22, 0f, 150.0, 0.1, 25.0)!!.contains("enfocar"))
  }
  @Test fun darkImageNeedsLight() {
    assertTrue(ReadingQuality.message(true, 22, 0f, 20.0, 0.0, 180.0)!!.contains("luz"))
  }
  @Test fun cutRowsNeedAnotherFrame() {
    assertTrue(ReadingQuality.message(false, 22, 0f, 150.0, 0.0, 180.0)!!.contains("cortando"))
  }
  @Test fun smallCharactersNeedCloserPresentation() {
    assertTrue(ReadingQuality.message(true, 15, 0f, 150.0, 0.0, 180.0)!!.contains("Acerca"))
  }
  @Test fun tiltedDocumentNeedsAlignmentInEitherDirection() {
    for (angle in listOf(-16f, 16f, 180f, Float.NaN))
      assertTrue(ReadingQuality.message(true, 22, angle, 150.0, 0.0, 180.0)!!.contains("Endereza"))
  }
  @Test fun invalidMeasurementsCannotPass() {
    assertNotNull(ReadingQuality.message(true,22,0f,Double.NaN,0.0,180.0))
    assertNotNull(ReadingQuality.message(true,22,0f,150.0,0.0,Double.NaN))
  }
  @Test fun calibratedBoundariesRemainReadable() {
    assertNull(ReadingQuality.message(true,16,15f,45.0,0.7,65.0))
  }
}
