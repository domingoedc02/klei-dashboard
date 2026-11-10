package co.klei.app.signature

/** The text a reply ends with. The desktop has the same function (`signature.ts`); both must pass `docs/fixtures/signature.json`. */
object SignatureRenderer {
    const val DOT = " · "

    fun render(
        enabled: Boolean, signoff: String, name: String, title: String, phone: String, studioName: String, studioAddress: String,
    ): String {
        if (!enabled) return ""
        val studioLine = listOf(studioName, phone).map { it.trim() }.filter { it.isNotEmpty() }.joinToString(DOT)
        return (listOf(signoff, name, title, studioLine) + studioAddress.lines())
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
    }
}
