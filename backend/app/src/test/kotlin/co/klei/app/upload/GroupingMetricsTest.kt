package co.klei.app.upload

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GroupingMetricsTest {
    private val labels = listOf("a", "a", "b", "b")

    @Test fun `a perfect clustering scores 1 and 1`() {
        val s = GroupingMetrics.precisionRecall(labels, listOf(listOf(0, 1), listOf(2, 3)))
        assertEquals(1.0, s.precision)
        assertEquals(1.0, s.recall)
        assertEquals(1.0, s.f1)
    }

    @Test fun `two labels in one cluster lose precision and keep recall`() {
        val s = GroupingMetrics.precisionRecall(labels, listOf(listOf(0, 1, 2, 3)))
        assertEquals(2.0 / 6, s.precision)
        assertEquals(1.0, s.recall)
    }

    @Test fun `an over-split clustering keeps precision and loses recall`() {
        val s = GroupingMetrics.precisionRecall(labels, listOf(listOf(0), listOf(1), listOf(2, 3)))
        assertEquals(1.0, s.precision)
        assertEquals(0.5, s.recall)
    }

    @Test fun `all singletons give recall 0 without dividing by zero`() {
        val s = GroupingMetrics.precisionRecall(labels, listOf(listOf(0), listOf(1), listOf(2), listOf(3)))
        assertEquals(0.0, s.recall)
        assertEquals(1.0, s.precision)
        assertEquals(0.0, s.f1)
    }

    @Test fun `a folder with no true pair has recall 1`() {
        assertEquals(1.0, GroupingMetrics.precisionRecall(listOf("a", "b"), listOf(listOf(0), listOf(1))).recall)
    }

    @Test fun `purity`() {
        assertTrue(GroupingMetrics.pure(listOf(0, 1), labels))
        assertFalse(GroupingMetrics.pure(listOf(1, 2), labels))
        assertTrue(GroupingMetrics.pure(listOf(3), labels))
    }
}
