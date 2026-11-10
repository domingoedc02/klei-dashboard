package co.klei.app.web

import co.klei.app.search.SearchResult
import co.klei.app.search.SearchService
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

class SearchRequest {
    var q: String? = null
}

/** FR-28. POST so the words stay out of URLs and access logs. Gowns need View gallery, Inquiries need Reply; a caller with either gets that kind. */
@RestController
@RequestMapping("/api/v1/search")
class SearchController(private val search: SearchService) {
    @PreAuthorize("hasAnyAuthority('PERM_VIEW_GALLERY','PERM_REPLY')")
    @PostMapping
    fun search(@RequestBody body: SearchRequest, auth: Authentication): SearchResult {
        val has = auth.authorities.map { it.authority }.toSet()
        return search.search(body.q, "PERM_VIEW_GALLERY" in has, "PERM_REPLY" in has)
    }
}
