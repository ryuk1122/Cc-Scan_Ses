package expo.modules.cedulascanner

/** Deterministic acceptance rules, separate from camera hardware so their boundaries can be tested. */
object ReadingQuality {
  fun message(inBounds: Boolean, characterHeight: Int, angle: Float,
              brightness: Double, whiteFraction: Double, sharpness: Double): String? = when {
    !inBounds -> "Se están cortando las líneas; aleja un poco la cédula"
    characterHeight < 16 -> "Acerca la cédula para ampliar las letras"
    !angle.isFinite() || kotlin.math.abs(angle) > 15 -> "Endereza la cédula frente a la cámara"
    !brightness.isFinite() || !whiteFraction.isFinite() || !sharpness.isFinite() -> "Mantén la cédula quieta para volver a medir"
    brightness < 45 -> "Falta luz sobre las líneas"
    whiteFraction > 0.70 && sharpness < 65 -> "Inclina ligeramente la cédula para quitar el reflejo"
    sharpness < 65 -> "Toca las líneas para enfocar y mantén la cédula quieta"
    else -> null
  }
}
