package co.klei.app

import com.tngtech.archunit.base.DescribedPredicate
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.RawCiphertext
import com.tngtech.archunit.core.domain.JavaCall
import com.tngtech.archunit.core.domain.JavaClass
import jakarta.persistence.EntityManager
import org.springframework.data.jpa.repository.Query
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.jdbc.core.JdbcOperations
import com.tngtech.archunit.core.domain.JavaMethod
import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.lang.ArchCondition
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.ConditionEvents
import com.tngtech.archunit.lang.SimpleConditionEvent
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses
import org.junit.jupiter.api.Test
import org.springframework.web.bind.annotation.RequestMapping
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.test.assertEquals
import kotlin.test.assertTrue

object ArchRules {
    val coreNotApp: ArchRule = noClasses().that().resideInAPackage("co.klei.core..")
        .should().dependOnClassesThat().resideInAPackage("co.klei.app..")
        .`as`("RULE core-must-not-import-app")

    val cryptoIsLeaf: ArchRule = noClasses().that().resideInAPackage("co.klei.crypto..")
        .should().dependOnClassesThat().resideInAnyPackage("co.klei.core..", "co.klei.app..")
        .`as`("RULE crypto-must-not-import-core-or-app")

    val jcaConfinedToCrypto: ArchRule = noClasses().that().resideOutsideOfPackage("co.klei.crypto..")
        .should().dependOnClassesThat(
            DescribedPredicate.describe<JavaClass>("are javax.crypto, MessageDigest or SecureRandom") {
                it.packageName.startsWith("javax.crypto") ||
                    it.isEquivalentTo(MessageDigest::class.java) || it.isEquivalentTo(SecureRandom::class.java)
            },
        )
        .`as`("RULE jca-only-in-crypto (AD-2)")

    // Story 4.1: every object read or write goes through ObjectStorePort, so nothing else can bypass encryption by talking to S3.
    val s3ConfinedToStorage: ArchRule = noClasses().that().resideOutsideOfPackage("co.klei.app.storage..")
        .should().dependOnClassesThat().resideInAPackage("software.amazon.awssdk..")
        .`as`("RULE s3-client-only-in-storage (AD-7)")

    // AD-19: ciphertext columns are written by the interceptor only.
    private val CT_WRITE = Regex("""(?is)\b(insert|update|merge)\b.*?(_ct\b|_bidx\b|(?-i:Ct\b|Bidx\b))""")

    val noRawCiphertextWritesInQueries: ArchRule = methods()
        .that().areAnnotatedWith(Query::class.java)
        .and().areDeclaredInClassesThat().areNotAnnotatedWith(RawCiphertext::class.java)
        .should(object : ArchCondition<JavaMethod>("not write *_ct or *_bidx in a @Query") {
            override fun check(m: JavaMethod, events: ConditionEvents) {
                val q = m.getAnnotationOfType(Query::class.java)
                if (CT_WRITE.containsMatchIn(q.value) || CT_WRITE.containsMatchIn(q.countQuery))
                    events.add(SimpleConditionEvent.violated(m, "${m.fullName} writes a ciphertext column"))
            }
        })
        .`as`("RULE no-raw-ciphertext-write-in-query (AD-19)")
        .allowEmptyShould(true) // shortcut: guards future repositories; the fixture test proves it bites.

    private val RAW_WRITE = setOf("update", "batchUpdate", "createNativeQuery")

    val noRawSqlWritesOutsideRawCiphertext: ArchRule = noClasses()
        .that().areNotAnnotatedWith(RawCiphertext::class.java)
        .should().callMethodWhere(
            DescribedPredicate.describe<JavaCall<*>>("write through JdbcOperations or EntityManager.createNativeQuery") {
                it.name in RAW_WRITE &&
                    (it.targetOwner.isAssignableTo(JdbcOperations::class.java) || it.targetOwner.isAssignableTo(EntityManager::class.java))
            },
        )
        .`as`("RULE no-raw-sql-write-outside-raw-ciphertext (AD-19)")

    private val VALUE_METHODS = Regex("toString|equals|hashCode|copy|component\\d+")

    val entitiesHaveNoValueSemantics: ArchRule = classes()
        .that().areAnnotatedWith(EncryptedEntity::class.java)
        .should(object : ArchCondition<JavaClass>("not declare toString, equals, hashCode, copy or componentN") {
            override fun check(c: JavaClass, events: ConditionEvents) {
                c.methods.filter { VALUE_METHODS.matches(it.name) }.forEach {
                    events.add(SimpleConditionEvent.violated(c, "${it.fullName} would expose decrypted fields"))
                }
            }
        })
        .`as`("RULE no-entity-value-semantics (AD-19)")
        .allowEmptyShould(true) // shortcut: production entities arrive in Story 1.4+; probes cover it now.

    private val AUTH_ANNOTATIONS = setOf("PermitAll", "PreAuthorize", "TokenAuthorized")

    // AD-9: every request-mapped method declares its authorization.
    val endpointsDeclareAuthorization: ArchRule = methods()
        .that(DescribedPredicate.describe("are request-mapped") { it.isMetaAnnotatedWith(RequestMapping::class.java) })
        .should(object : ArchCondition<JavaMethod>("declare @PermitAll, @PreAuthorize or @TokenAuthorized") {
            override fun check(m: JavaMethod, events: ConditionEvents) {
                val ok = m.annotations.any { it.rawType.simpleName in AUTH_ANNOTATIONS }
                if (!ok) events.add(SimpleConditionEvent.violated(m, "${m.fullName} has no authorization annotation"))
            }
        })
        .`as`("RULE endpoint-declares-authorization (AD-9)")

    private val ROLE_CHECK = Regex("""hasRole|hasAnyRole|ROLE_|['"](Admin|Staff|Viewer)['"]""")

    // AD-9: code checks Permissions, never Role names; Roles are data an Admin can edit.
    /** Story 8.3 (FR-25): the assistant reads through query side classes only; services that write, and mail, are out of reach. */
    val assistantHasNoWritePath: ArchRule = noClasses().that().resideInAPackage("co.klei.app.assistant..")
        .should().dependOnClassesThat(object : DescribedPredicate<JavaClass>("write services or mail") {
            override fun test(c: JavaClass): Boolean =
                c.packageName.startsWith("co.klei.core.mail") || c.simpleName == "SmtpMailAdapter" ||
                    (c.simpleName.endsWith("Service") && c.simpleName != "GownQueryService" && c.simpleName != "AssistantService" && c.simpleName != "AiSettingService" &&
                        c.packageName.startsWith("co.klei.app.") && !c.packageName.startsWith("co.klei.app.assistant"))
        })
        .`as`("RULE assistant-has-no-write-path")

    val noRoleNamesInAuthorization: ArchRule = methods()
        .that().areAnnotatedWith(PreAuthorize::class.java)
        .should(object : ArchCondition<JavaMethod>("check Permissions, not Role names, in @PreAuthorize") {
            override fun check(m: JavaMethod, events: ConditionEvents) {
                val expr = m.getAnnotationOfType(PreAuthorize::class.java).value
                if (ROLE_CHECK.containsMatchIn(expr)) events.add(SimpleConditionEvent.violated(m, "${m.fullName} checks a Role: $expr"))
            }
        })
        .`as`("RULE no-role-names-in-authorization (AD-9)")
        .allowEmptyShould(true) // shortcut: only /me and the test probes exist so far; the fixture test proves it bites.
}

class ArchitectureTest {
    private val main = ClassFileImporter().withImportOption(ImportOption.DoNotIncludeTests()).importPackages("co.klei")

    @Test fun `modules point one way`() {
        ArchRules.coreNotApp.check(main)
        ArchRules.cryptoIsLeaf.check(main)
    }

    @Test fun `jca stays in crypto`() = ArchRules.jcaConfinedToCrypto.check(main)

    @Test fun `s3 client stays in storage`() = ArchRules.s3ConfinedToStorage.check(main)

    @Test fun `ciphertext columns are written by the interceptor only`() {
        ArchRules.noRawCiphertextWritesInQueries.check(main)
        ArchRules.noRawSqlWritesOutsideRawCiphertext.check(main)
    }

    @Test fun `encrypted entities have no value semantics`() {
        val probes = ClassFileImporter().importPackages("co.klei.app.probe")
        assertTrue(probes.any { it.simpleName == "CryptoProbe" }, "scan must see the probe entities")
        ArchRules.entitiesHaveNoValueSemantics.check(probes)
        ArchRules.entitiesHaveNoValueSemantics.check(main)
    }

    @Test fun `every endpoint declares authorization`() {
        assertTrue(main.any { it.simpleName == "HealthController" }, "scan must see the app module")
        ArchRules.endpointsDeclareAuthorization.check(main)
    }

    @Test fun `authorization checks permissions never role names`() = ArchRules.noRoleNamesInAuthorization.check(main)

    @Test fun `assistant has no write path`() {
        assertTrue(main.any { it.simpleName == "AssistantService" }, "scan must see the assistant package")
        ArchRules.assistantHasNoWritePath.check(main)
        val bad = ClassFileImporter().importPackages("co.klei.app.assistant.fixture")
        assertTrue(ArchRules.assistantHasNoWritePath.evaluate(bad).hasViolation())
    }

    @Test fun `rules fail on violations and name the rule`() {
        val fixtures = ClassFileImporter().importPackages("co.klei.fixture")
        val jca = ArchRules.jcaConfinedToCrypto.evaluate(fixtures)
        assertTrue(jca.hasViolation())
        assertTrue(jca.failureReport.toString().contains("jca-only-in-crypto"))
        val ep = ArchRules.endpointsDeclareAuthorization.evaluate(fixtures)
        assertEquals(1, ep.failureReport.details.size)
        for (r in listOf(ArchRules.s3ConfinedToStorage, ArchRules.noRawCiphertextWritesInQueries, ArchRules.noRawSqlWritesOutsideRawCiphertext, ArchRules.entitiesHaveNoValueSemantics, ArchRules.noRoleNamesInAuthorization)) {
            val e = r.evaluate(fixtures)
            assertTrue(e.hasViolation(), r.description)
            assertTrue(e.failureReport.toString().contains("RULE "), r.description)
        }
    }
}
