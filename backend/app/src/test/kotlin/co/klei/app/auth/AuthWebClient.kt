package co.klei.app.auth

import co.klei.crypto.Pkce
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpHeaders
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse

/**
 * A browser stand-in for the Auth Web flow: manual cookie jar (the `__Host-` cookie is Secure, and the JDK jar will not
 * send a Secure cookie over http) and CSRF taken from the last page. Used by the tests; `infra/ci/smoke.sh` does the same with curl.
 */
class AuthWebClient(private val authBase: String, private val apiBase: String) {
    class Page(val status: Int, val body: String, val headers: HttpHeaders) {
        fun header(name: String): String? = headers.firstValue(name).orElse(null)
        /** The redirect target the A6 page hands to the browser. */
        fun target(): String? = Regex("""url=([^"]+)"""").find(body)?.groupValues?.get(1)?.replace("&amp;", "&")
        fun code(): String? = target()?.let { Regex("""[?&]code=([^&]+)""").find(it)?.groupValues?.get(1) }
    }

    private val http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()
    private var cookie: String? = null
    private var csrf: String? = null
    val cookieJarSize get() = if (cookie == null) 0 else 1

    fun authorize(verifier: String = VERIFIER, redirect: String = DEEP_LINK, state: String = STATE, challenge: String = Pkce.s256(verifier), client: String = "desktop"): Page =
        get("/authorize?client=$client&challenge=$challenge&state=$state&redirect=${enc(redirect)}")

    fun login(email: String, password: String, keep: Boolean = false, token: String? = csrf): Page =
        post("/login", buildMap {
            put("email", email); put("password", password)
            if (keep) put("keep", "1")
            token?.let { put("_csrf", it) }
        })

    /** Full happy path: returns the one-time code. */
    fun signIn(email: String, password: String, verifier: String = VERIFIER, keep: Boolean = false): String {
        authorize(verifier)
        return checkNotNull(login(email, password, keep).code()) { "no code issued" }
    }

    fun get(path: String): Page = send(HttpRequest.newBuilder(URI.create(authBase + path)).GET())

    fun post(path: String, form: Map<String, String>): Page =
        send(
            HttpRequest.newBuilder(URI.create(authBase + path)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(BodyPublishers.ofString(form.entries.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" })),
        )

    /** A form post from the page last shown: its CSRF token goes along, as the browser would send it. */
    fun submit(path: String, form: Map<String, String>): Page = post(path, csrf?.let { form + ("_csrf" to it) } ?: form)

    fun api(method: String, path: String, json: String? = null, bearer: String? = null, headers: Map<String, String> = emptyMap()): Page =
        http.send(
            HttpRequest.newBuilder(URI.create(apiBase + path)).method(method, if (json == null) BodyPublishers.noBody() else BodyPublishers.ofString(json))
                .apply { if (json != null) header("Content-Type", "application/json"); bearer?.let { header("Authorization", "Bearer $it") }; headers.forEach { (k, v) -> header(k, v) } }.build(),
            HttpResponse.BodyHandlers.ofString(),
        ).let { Page(it.statusCode(), it.body(), it.headers()) }

    fun exchange(code: String, verifier: String = VERIFIER): Page = api("POST", "/api/v1/auth/token", """{"code":"$code","verifier":"$verifier"}""")

    private fun send(b: HttpRequest.Builder): Page {
        cookie?.let { b.header("Cookie", it) }
        val r = http.send(b.build(), HttpResponse.BodyHandlers.ofString())
        r.headers().allValues("Set-Cookie").firstOrNull { it.startsWith(COOKIE) }?.let { c ->
            cookie = if (c.substringAfter('=').startsWith(";") || "Max-Age=0" in c) null else c.substringBefore(';')
        }
        Regex("""name="_csrf" value="([^"]+)"""").find(r.body())?.let { csrf = it.groupValues[1] }
        return Page(r.statusCode(), r.body(), r.headers())
    }

    private fun enc(s: String) = URLEncoder.encode(s, Charsets.UTF_8)

    companion object {
        const val COOKIE = "__Host-klei-auth"
        const val DEEP_LINK = "klei://auth/callback"
        const val VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        const val STATE = "state-0123456789abcdef"
        fun field(json: String, name: String): String? = Regex(""""$name":"([^"]+)"""").find(json)?.groupValues?.get(1)
    }
}
