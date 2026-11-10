package co.klei.app.web

import kotlin.test.Test
import kotlin.test.assertEquals

class ClientIpTest {
    private fun ip(hops: Int, xff: String?) = ClientIp(hops).resolve(xff, "10.0.0.9")

    @Test fun `one trusted hop takes the last entry, which our proxy appended`() {
        assertEquals("203.0.113.5", ip(1, "198.51.100.1, 203.0.113.5"))
    }

    @Test fun `spoofed leading entries are ignored`() {
        assertEquals("203.0.113.5", ip(1, "1.1.1.1, 2.2.2.2, 203.0.113.5"))
    }

    @Test fun `two hops take the second from the right`() {
        assertEquals("198.51.100.1", ip(2, "9.9.9.9, 198.51.100.1, 203.0.113.5"))
    }

    @Test fun `fewer entries than hops, no header or zero hops fall back to the peer`() {
        assertEquals("10.0.0.9", ip(2, "203.0.113.5"))
        assertEquals("10.0.0.9", ip(1, null))
        assertEquals("10.0.0.9", ip(0, "203.0.113.5"))
    }
}
