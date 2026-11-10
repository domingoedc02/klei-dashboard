package co.klei.app.upload

import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import org.springframework.stereotype.Component
import java.awt.Color
import java.awt.Image
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import javax.imageio.stream.MemoryCacheImageOutputStream

/**
 * The 480 px JPEG that the gallery shows (or [size] px for an avatar). It is rebuilt from decoded pixels, so EXIF, GPS, ICC and any trailing
 * bytes of the original never reach it (FR-8). A file that will not decode is refused here.
 */
@Component
class ThumbnailService(private val images: ImageValidator) {
    fun make(bytes: ByteArray, info: Inspected, size: Int = SIZE): ByteArray {
        val decoded = try {
            decode(bytes, info, size)
        } catch (_: Exception) {
            throw ProblemException(ProblemCode.UNSUPPORTED_TYPE)
        }
        return encode(fit(decoded, info, size))
    }

    // Decoding at 1/n scale keeps a 40 MP photo from needing 160 MB of heap; WebP is read whole.
    private fun decode(bytes: ByteArray, info: Inspected, size: Int): BufferedImage = images.reader(bytes, info.type) { r ->
        val param = r.defaultReadParam
        val step = if (info.type == ImageType.WEBP) 1 else maxOf(1, maxOf(info.width, info.height) / (size * 2))
        if (step > 1) param.setSourceSubsampling(step, step, 0, 0)
        r.read(0, param)
    }

    private fun fit(src: BufferedImage, info: Inspected, size: Int): BufferedImage {
        val scale = minOf(1.0, size.toDouble() / maxOf(info.width, info.height))
        val w = maxOf(1, Math.round(info.width * scale).toInt())
        val h = maxOf(1, Math.round(info.height * scale).toInt())
        val out = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        val g = out.createGraphics()
        try {
            g.color = Color.WHITE
            g.fillRect(0, 0, w, h)
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
            g.drawImage(src.getScaledInstance(w, h, Image.SCALE_AREA_AVERAGING), 0, 0, null)
        } finally {
            g.dispose()
        }
        return out
    }

    private fun encode(img: BufferedImage): ByteArray {
        val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
        val out = ByteArrayOutputStream()
        try {
            MemoryCacheImageOutputStream(out).use { stream ->
                writer.output = stream
                val p = writer.defaultWriteParam
                p.compressionMode = ImageWriteParam.MODE_EXPLICIT
                p.compressionQuality = 0.82f
                writer.write(null, IIOImage(img, null, null), p)
            }
        } finally {
            writer.dispose()
        }
        return out.toByteArray()
    }

    companion object {
        const val SIZE = 480
    }
}
