package co.klei.download;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/** Replaces Boot's error controller: every error is an empty 404, never a body that names a path or exception. */
@Controller
class EmptyError implements ErrorController {
    @RequestMapping("/error")
    ResponseEntity<Void> error(HttpServletResponse res) {
        TokenGate.apply(res);
        return ResponseEntity.notFound().build();
    }
}
