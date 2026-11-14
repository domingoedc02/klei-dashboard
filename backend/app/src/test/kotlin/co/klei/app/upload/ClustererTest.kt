package co.klei.app.upload

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ClustererTest {
    private fun v(vararg x: Float) = floatArrayOf(*x)

    /** Three gowns on three axes, two photos each, shuffled so order does not do the work. */
    private val photos = listOf(
        v(1f, 0.05f, 0f), v(0f, 1f, 0.1f), v(0f, 0.1f, 1f),
        v(0.98f, 0f, 0.1f), v(0.05f, 0.97f, 0f), v(0.1f, 0f, 0.99f),
    )

    @Test fun `three synthetic gowns make three groups of two`() {
        val groups = Clusterer.cluster(photos, Clusterer.threshold(3))
        assertEquals(listOf(listOf(0, 3), listOf(1, 4), listOf(2, 5)), groups.map { it.members })
        assertTrue(groups.all { it.confidence in 90..100 }, groups.toString())
    }

    @Test fun `same input gives same output`() {
        assertEquals(Clusterer.cluster(photos, 0.75), Clusterer.cluster(photos, 0.75))
    }

    @Test fun `a looser threshold merges what a stricter one keeps apart`() {
        val pair = listOf(v(1f, 0f), v(0.7f, 0.714f)) // cosine about 0.70
        assertEquals(1, Clusterer.cluster(pair, Clusterer.threshold(2)).size)
        assertEquals(2, Clusterer.cluster(pair, Clusterer.threshold(3)).size)
    }

    @Test fun `a lone photo is its own group and reads as Low`() {
        val g = Clusterer.cluster(listOf(v(1f, 0f), v(0f, 1f)), 0.75)
        assertEquals(2, g.size)
        assertEquals(listOf(0, 0), g.map { it.confidence })
        assertEquals("low", confidenceBand(g[0].confidence))
    }

    @Test fun `empty input, zero vectors and bad dimensions`() {
        assertEquals(emptyList(), Clusterer.cluster(emptyList(), 0.75))
        assertEquals(2, Clusterer.cluster(listOf(v(0f, 0f), v(0f, 0f)), 0.75).size)
        assertFailsWith<IllegalArgumentException> { Clusterer.cluster(listOf(v(1f), v(1f, 2f)), 0.75) }
    }

    @Test fun `thresholds follow the sensitivity scale and clamp`() {
        assertEquals(listOf(0.55, 0.65, 0.75, 0.82, 0.88), (1..5).map(Clusterer::threshold))
        assertEquals(0.55, Clusterer.threshold(0))
        assertEquals(0.88, Clusterer.threshold(9))
    }

    @Test fun `bands`() {
        assertEquals(listOf("high", "medium", "low", "low"), listOf(90, 80, 79, 0).map(::confidenceBand))
    }

    /** Unit vector at [deg] degrees in the plane, so the cosine between two of them is cos of the angle between them. */
    private fun at(deg: Double) = v(Math.cos(Math.toRadians(deg)).toFloat(), Math.sin(Math.toRadians(deg)).toFloat())

    @Test fun `one outlier lowers the group below the mean-only value and below the same group without it`() {
        val tight = listOf(at(0.0), at(2.0), at(4.0))
        val withOutlier = tight + at(40.0) // cosine to the others 0.77, 0.80, 0.84: still merges at the default sensitivity
        val before = Clusterer.cluster(tight, Clusterer.threshold(3)).single().confidence
        val g = Clusterer.cluster(withOutlier, Clusterer.threshold(3)).single()
        val sims = (0 until 3).map { cosine(withOutlier[it], withOutlier[3]) } + listOf(cosine(tight[0], tight[1]), cosine(tight[0], tight[2]), cosine(tight[1], tight[2]))
        val meanOnly = Math.round(sims.average() * 100).toInt()
        assertTrue(g.confidence < meanOnly, "${g.confidence} should be under the mean-only $meanOnly")
        assertTrue(g.confidence < before, "${g.confidence} should be under the outlier-free $before")
        assertEquals(Math.round((0.5 * sims.average() + 0.5 * sims.min()) * 100).toInt(), g.confidence)
    }

    @Test fun `a pair reads as its single similarity`() {
        val g = Clusterer.cluster(listOf(at(0.0), at(10.0)), Clusterer.threshold(3)).single()
        assertEquals(Math.round(Math.cos(Math.toRadians(10.0)) * 100).toInt(), g.confidence)
    }

    @Test fun `two reported-style gowns that still merge are not High`() {
        // synthetic stand-in: gowns A and B at cosine 0.78, a third photo at 0.95 to both (operator vectors not supplied)
        val a = at(0.0)
        val b = at(Math.toDegrees(Math.acos(0.78)))
        val mid = at(Math.toDegrees(Math.acos(0.78)) / 2)
        val g = Clusterer.cluster(listOf(a, mid, b), Clusterer.threshold(3)).single()
        assertTrue(g.confidence < 90, "merged but weakest pair is 0.78, got ${g.confidence}")
        assertNotEquals("high", confidenceBand(g.confidence))
    }

    /** The textbook O(n^3) average-link search the nearest-neighbour chain replaced; ties go to the lowest pair. */
    private fun reference(vectors: List<FloatArray>, threshold: Double): List<List<Int>> {
        val sim = Clusterer.similarities(vectors)
        val live = vectors.indices.map { mutableListOf(it) }.toMutableList()
        while (true) {
            var best = -1.0; var bi = -1; var bj = -1
            for (i in live.indices) for (j in i + 1 until live.size) {
                val avg = live[i].sumOf { a -> live[j].sumOf { b -> sim[a, b] } } / (live[i].size * live[j].size)
                if (avg > best) { best = avg; bi = i; bj = j }
            }
            if (bi < 0 || best < threshold) break
            live[bi].addAll(live[bj]); live.removeAt(bj)
        }
        return live.map { it.sorted() }.sortedBy { it.first() }
    }

    @Test fun `groups equal a plain average-link search on random vectors`() {
        val rnd = java.util.Random(7)
        repeat(20) {
            val vs = List(60) { FloatArray(4) { rnd.nextGaussian().toFloat() } }
            for (t in listOf(0.0, 0.3, 0.55, 0.75)) {
                assertEquals(reference(vs, t), Clusterer.cluster(vs, t).map { c -> c.members }, "threshold $t")
            }
        }
    }

    @Test fun `two thousand photos in twenty gowns make twenty groups`() {
        val rnd = java.util.Random(11)
        val centres = List(20) { FloatArray(32) { rnd.nextGaussian().toFloat() } }
        val vs = List(2000) { i -> FloatArray(32) { d -> centres[i % 20][d] + 0.05f * rnd.nextGaussian().toFloat() } }
        val groups = Clusterer.cluster(vs, Clusterer.threshold(3))
        assertEquals(20, groups.size)
        assertTrue(groups.all { it.members.size == 100 })
    }

    private fun cosine(a: FloatArray, b: FloatArray) = a.indices.sumOf { (a[it] * b[it]).toDouble() }
}
