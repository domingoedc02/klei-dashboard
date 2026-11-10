package co.klei.app.auth

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class RedirectUriTest {
    @Test fun `only the deep link and a loopback callback are accepted`() {
        val good = listOf("klei://auth/callback", "http://127.0.0.1:1024/callback", "http://127.0.0.1:49152/callback", "http://127.0.0.1:65535/callback")
        val bad = listOf(
            "", "klei://auth/callback/", "klei://auth/callback?x=1", "klei://evil/callback", "KLEI://auth/callback",
            "http://127.0.0.1:1023/callback", "http://127.0.0.1:65536/callback", "http://127.0.0.1:99999/callback", "http://127.0.0.1/callback",
            "http://127.0.0.1:5000/callback?x=1", "http://127.0.0.1:5000/callback/", "http://127.0.0.1:5000/other",
            "http://user@127.0.0.1:5000/callback", "http://127.0.0.1:5000@evil.test/callback", "http://127.0.0.1.evil.test:5000/callback",
            "https://127.0.0.1:5000/callback", "http://localhost:5000/callback", "http://[::1]:5000/callback", "https://evil.test/", "//evil.test",
            "http://127.0.0.1:05000/callback", "http://127.0.0.1:5000/callback#x",
        )
        assertEquals(emptyList(), good.filterNot(RedirectUri::valid))
        assertEquals(emptyList(), bad.filter(RedirectUri::valid))
    }
}
