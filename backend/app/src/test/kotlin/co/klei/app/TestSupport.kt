package co.klei.app

import org.springframework.test.context.DynamicPropertyRegistry
import java.util.Base64

object TestSupport {
    fun key(seed: Int): String = Base64.getEncoder().encodeToString(ByteArray(32) { (seed + it).toByte() })

    fun keys(r: DynamicPropertyRegistry) {
        r.add("KLEI_KEK_1") { key(1) }
        r.add("KLEI_KEK_ACTIVE") { "1" }
        r.add("KLEI_BIDX_KEY") { key(50) }
        r.add("KLEI_JWT_KEY") { key(100) }
    }

    const val ADMIN_EMAIL = "admin@example.test"
    const val ADMIN_PASSWORD = "Admin-pass-123"

    fun bootstrap(r: DynamicPropertyRegistry) {
        r.add("KLEI_BOOTSTRAP_ADMIN_EMAIL") { ADMIN_EMAIL }
        r.add("KLEI_BOOTSTRAP_ADMIN_PASSWORD") { ADMIN_PASSWORD }
    }

    fun s3(r: DynamicPropertyRegistry) {
        r.add("klei.s3.endpoint") { "http://127.0.0.1:1" }
        r.add("klei.s3.access-key") { "a" }
        r.add("klei.s3.secret-key") { "b" }
        r.add("klei.s3.bucket") { "bk" }
    }
}
