package co.klei.app.upload

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PickImagesTest {
    /** Unit vectors at the given angles; index order is upload order. */
    private fun sim(vararg deg: Double) = Clusterer.similarities(deg.map { floatArrayOf(Math.cos(Math.toRadians(it)).toFloat(), Math.sin(Math.toRadians(it)).toFloat()) })

    @Test fun `eight or fewer are all sent`() {
        val s = sim(0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0)
        assertEquals((0..7).toList(), GroupVerify.pick((0..7).toList(), s))
        assertEquals(listOf(2, 5), GroupVerify.pick(listOf(2, 5), s))
    }

    @Test fun `over eight sends the 3 least alike, the 3 most alike and the first two left in upload order`() {
        // 10 photos near 0..9 degrees except photo 6 at 35 degrees (least alike) and photos 1 and 8 at the centre (most alike)
        val s = sim(0.0, 4.0, 1.0, 2.0, 8.0, 7.0, 35.0, 9.0, 4.5, 3.0)
        val members = (0..9).toList()
        val mean = members.associateWith { a -> members.filter { it != a }.map { s[a][it] }.average() }
        val ranked = members.sortedBy { mean.getValue(it) }
        val chosen = GroupVerify.pick(members, s)
        assertEquals(8, chosen.size)
        assertEquals(chosen.sorted(), chosen)
        assertTrue(chosen.containsAll(ranked.take(3) + ranked.takeLast(3)), "$chosen vs $ranked")
        assertTrue(6 in chosen, "the outlier is always sent")
        val rest = members.filter { it !in (ranked.take(3) + ranked.takeLast(3)) }
        assertEquals((ranked.take(3) + ranked.takeLast(3) + rest.take(2)).sorted(), chosen)
    }

    @Test fun `a group of 200 sends 8 and the choice is deterministic`() {
        val s = sim(*DoubleArray(200) { it * 0.1 })
        val m = (0 until 200).toList()
        assertEquals(8, GroupVerify.pick(m, s).size)
        assertEquals(GroupVerify.pick(m, s), GroupVerify.pick(m, s))
    }

    @Test fun `unsent photos join the sent photo they are most like, members stay ascending, parts ordered by first member`() {
        val s = sim(0.0, 90.0, 1.0, 89.0, 2.0) // 0, 2, 4 near 0 degrees; 1, 3 near 90
        val members = listOf(0, 1, 2, 3, 4)
        val sent = listOf(0, 1, 3)
        assertEquals(listOf(listOf(0, 2, 4), listOf(1, 3)), GroupVerify.split(members, sent, listOf(listOf(0), listOf(1, 2)), s))
        assertEquals(listOf(members), GroupVerify.split(members, sent, listOf(listOf(0, 1, 2)), s))
    }
}
