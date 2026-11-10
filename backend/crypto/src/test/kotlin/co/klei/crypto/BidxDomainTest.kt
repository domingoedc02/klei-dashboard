package co.klei.crypto

import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/** The architecture §4.2 table is the oracle for the enum. */
class BidxDomainTest {
    @Test fun `enum equals the domains in architecture 4_2`() {
        val doc = generateSequence(Path.of("").toAbsolutePath()) { it.parent }.map { it.resolve("docs/architecture.md") }.first(Files::exists)
        val section = Files.readString(doc).substringAfter("### 4.2 Blind indexes").substringBefore("### 4.3")
        val fromDoc = Regex("(?m)^\\| `([A-Z_]+)` \\|").findAll(section).map { it.groupValues[1] }.toSet()
        assertEquals(fromDoc, BidxDomain.entries.map { it.name }.toSet())
    }
}
