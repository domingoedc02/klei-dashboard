package co.klei.app.web

import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Caps every non-multipart body before authentication or parsing sees it. Multipart uploads have their own
 * limits (`spring.servlet.multipart`). A declared length over the cap is refused outright; a chunked body is
 * counted as it is read and fails with `too_large` once it passes the cap.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
class BodyLimitFilter(@Value("\${klei.max-body-bytes:1048576}") private val max: Long) : OncePerRequestFilter() {
    override fun doFilterInternal(req: HttpServletRequest, res: HttpServletResponse, chain: FilterChain) {
        if (req.contentType?.startsWith("multipart/", ignoreCase = true) == true) return chain.doFilter(req, res)
        if (req.contentLengthLong > max) return Problems.write(ProblemCode.TOO_LARGE, req, res)
        chain.doFilter(Counted(req, max), res)
    }

    private class Counted(req: HttpServletRequest, private val max: Long) : HttpServletRequestWrapper(req) {
        override fun getInputStream(): ServletInputStream {
            val src = super.getInputStream()
            return object : ServletInputStream() {
                private var seen = 0L
                private fun count(n: Int): Int {
                    if (n > 0) seen += n
                    if (seen > max) throw ProblemException(ProblemCode.TOO_LARGE)
                    return n
                }
                override fun read(): Int = src.read().also { if (it >= 0) count(1) }
                override fun read(b: ByteArray, off: Int, len: Int): Int = count(src.read(b, off, len))
                override fun isFinished(): Boolean = src.isFinished
                override fun isReady(): Boolean = src.isReady
                override fun setReadListener(l: ReadListener?) = src.setReadListener(l)
            }
        }
    }
}
