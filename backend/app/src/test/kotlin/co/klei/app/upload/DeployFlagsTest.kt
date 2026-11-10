package co.klei.app.upload

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/** Story 4.1: a decode bomb ends the process, leaves no heap dump holding plaintext, and cannot take the host's memory. */
class DeployFlagsTest {
    private fun infra(name: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "infra/$name").exists()) dir = dir.parentFile
        return File(checkNotNull(dir) { "infra/$name not found" }, "infra/$name").readText()
    }

    @Test fun `the JVM exits on out-of-memory, writes no heap dump, and the container has a memory limit`() {
        val docker = infra("Dockerfile")
        assertTrue("-XX:+ExitOnOutOfMemoryError" in docker)
        assertTrue("-XX:-HeapDumpOnOutOfMemoryError" in docker)
        assertTrue(Regex("""(?m)^\s+mem_limit:\s*\S+""").containsMatchIn(infra("docker-compose.yml")))
    }
}
