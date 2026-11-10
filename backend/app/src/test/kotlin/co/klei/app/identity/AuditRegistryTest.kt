package co.klei.app.identity

import co.klei.core.audit.AuditAction
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The registry of FR-40 actions: each one has a writer, or is listed here until its story adds one (empty since Story 9.2). */
class AuditRegistryTest {
    private val pending = emptySet<AuditAction>()

    private val main: String = Files.walk(Path.of("src/main/kotlin")).use { files ->
        files.filter { it.toString().endsWith(".kt") }.map { Files.readString(it) }.toList().joinToString("\n")
    }

    @Test fun `every action has a writer in the main code unless it is pending, and no writer uses a bare string`() {
        val unwritten = AuditAction.entries.filter { !main.contains("AuditAction.${it.name}") }.toSet()
        assertEquals(pending, unwritten)
        assertTrue(!Regex("""audit\.record\(\s*"""").containsMatchIn(main), "audit.record takes an AuditAction, not a string")
    }

    @Test fun `codes are unique snake case`() {
        val codes = AuditAction.entries.map { it.code }
        assertEquals(codes.size, codes.toSet().size)
        assertTrue(codes.all { Regex("[a-z]+(_[a-z]+)*").matches(it) })
    }
}
