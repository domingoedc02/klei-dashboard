package co.klei.app.auth

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.util.Base64

/** Draws [text] as a QR code and returns it as an SVG `data:` URI, so the desktop CSP (`img-src data:`) shows it without a request. */
object Qr {
    fun svgDataUri(text: String): String {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 2))
        val path = StringBuilder()
        for (y in 0 until m.height) for (x in 0 until m.width) if (m[x, y]) path.append("M$x $y" + "h1v1h-1z")
        val svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${m.height}" shape-rendering="crispEdges">""" +
            """<rect width="${m.width}" height="${m.height}" fill="#fff"/><path d="$path" fill="#000"/></svg>"""
        return "data:image/svg+xml;base64," + Base64.getEncoder().encodeToString(svg.toByteArray())
    }
}
