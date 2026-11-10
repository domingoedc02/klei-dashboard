package co.klei.app.ai

import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SsrfGuardTest {
    private fun ip(s: String) = InetAddress.getByName(s)
    private fun guard(dev: Boolean = false, vararg answers: String) = SsrfGuard(dev) { answers.map(::ip) }
    private fun refused(g: SsrfGuard, url: String) = assertEquals(AiFailure.REFUSED, assertFailsWith<AiProviderException> { g.check(url) }.failure, url)

    @Test fun `public address passes and is the one returned`() {
        val t = guard(false, "93.184.216.34").check("https://api.example.com/v1")
        assertEquals("93.184.216.34", t.address.hostAddress)
        assertEquals("api.example.com", t.uri.host)
    }

    @Test fun `every non-public range is refused in production`() {
        val blocked = listOf(
            "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255",
            "0.0.0.0", "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "ff02::1",
            "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2002:7f00:1::1", "2002:a9fe:a9fe::1",
        )
        for (a in blocked) refused(guard(false, a), "https://provider.example/v1")
    }

    @Test fun `neighbours of blocked ranges stay public`() {
        for (a in listOf("172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.255.255", "198.20.0.1", "169.253.0.1", "2606:4700::1111")) {
            assertEquals(SsrfGuard.Range.PUBLIC, SsrfGuard.range(ip(a)), a)
        }
    }

    @Test fun `scheme userinfo and host rules`() {
        val g = guard(false, "93.184.216.34")
        for (u in listOf("http://api.example.com/v1", "ftp://api.example.com", "https://user:pw@api.example.com/v1", "https:///v1", "api.example.com/v1", "https://a b/v1", "")) refused(g, u)
    }

    @Test fun `a name that mixes public and private answers is refused`() {
        refused(guard(false, "93.184.216.34", "10.0.0.5"), "https://mixed.example/v1")
        refused(guard(false, "10.0.0.5", "93.184.216.34"), "https://mixed.example/v1")
    }

    @Test fun `unknown host and empty answer are unreachable, not refused`() {
        val g = SsrfGuard(false) { throw java.net.UnknownHostException(it) }
        assertEquals(AiFailure.UNREACHABLE, assertFailsWith<AiProviderException> { g.check("https://nope.example") }.failure)
        assertEquals(AiFailure.UNREACHABLE, assertFailsWith<AiProviderException> { SsrfGuard(false) { emptyList() }.check("https://nope.example") }.failure)
    }

    @Test fun `dev mode opens http loopback and private only`() {
        val dev = guard(true, "127.0.0.1")
        assertEquals("127.0.0.1", dev.check("http://stub.local:8080/v1").address.hostAddress)
        assertEquals("10.1.2.3", guard(true, "10.1.2.3").check("http://stub").address.hostAddress)
        refused(guard(true, "169.254.169.254"), "http://metadata/latest")
        refused(guard(true, "100.64.0.1"), "http://cgnat")
        refused(guard(true, "fd00:ec2::254").let { SsrfGuard(true) { listOf(ip("169.254.169.254")) } }, "http://metadata")
    }

    @Test fun `resolved once - a second answer never matters`() {
        var calls = 0
        val g = SsrfGuard(false) { calls++; if (calls == 1) listOf(ip("93.184.216.34")) else listOf(ip("127.0.0.1")) }
        val t = g.check("https://rebind.example/v1")
        assertEquals(1, calls)
        assertEquals("93.184.216.34", t.address.hostAddress)
    }

    @Test fun `settings rules accept http and https origins only`() {
        assertEquals("https://api.openai.com:443", AiSettingsRules.origin("https://API.openai.com/v1"))
        assertEquals("http://localhost:11434", AiSettingsRules.origin("http://localhost:11434/v1"))
        for (u in listOf("ftp://x", "https://u:p@x/v1", "https://x/v1?k=1", "https://x/v1#f", "x.com", "https://")) assertNull(AiSettingsRules.origin(u), u)
    }
}
