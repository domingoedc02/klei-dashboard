package co.klei.app.upload

/** Rules around the vision check of one Group (Story 10.3). Pure: no provider, no database. */
object GroupVerify {
    /** Most thumbnails one verify call carries. */
    const val MAX_IMAGES = 8

    /** A Group nobody has looked at cannot read High (band starts at 90). */
    const val UNVERIFIED_CAP = 89

    /**
     * The members to send (ascending): all of them up to [MAX_IMAGES], else the 3 least like the rest, the 3 most like the rest,
     * and the first two, by upload order, not yet chosen. [members] are indexes into [sim], in upload order.
     */
    fun pick(members: List<Int>, sim: Array<DoubleArray>): List<Int> {
        if (members.size <= MAX_IMAGES) return members
        val mean = members.associateWith { a -> members.filter { it != a }.sumOf { sim[a][it] } / (members.size - 1) }
        val ranked = members.sortedWith(compareBy({ mean.getValue(it) }, { it }))
        val chosen = (ranked.take(3) + ranked.takeLast(3)).toMutableSet()
        members.filter { it !in chosen }.take(MAX_IMAGES - chosen.size).forEach { chosen += it }
        return chosen.sorted()
    }

    /**
     * Turns the partition of the [sent] photos (positions in [sent]) into groups of [members]: a photo that was not sent joins
     * the part of the sent photo it is most like. Parts come out ordered by their first member, members ascending.
     */
    fun split(members: List<Int>, sent: List<Int>, parts: List<List<Int>>, sim: Array<DoubleArray>): List<List<Int>> {
        val out = parts.map { p -> p.map { sent[it] }.toMutableList() }
        for (m in members - sent.toSet()) {
            val nearest = sent.maxBy { s -> sim[m][s] }
            out.first { nearest in it }.add(m)
        }
        return out.map { it.sorted() }.sortedBy { it.first() }
    }
}
