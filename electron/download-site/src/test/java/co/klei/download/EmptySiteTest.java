package co.klei.download;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class EmptySiteTest {
    static final String TOKEN = DownloadSiteTest.TOKEN;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws IOException {
        Path empty = Files.createTempDirectory("klei-dl-empty");
        r.add("klei.download.path-token", () -> TOKEN);
        r.add("klei.download.path-token-file", () -> "");
        r.add("klei.download.data-dir", empty::toString);
    }

    @Autowired MockMvc mvc;

    @Test
    void noListedVersionMeansNoLatestAndAnEmptyPageStill200s() throws Exception {
        mvc.perform(get("/" + TOKEN + "/latest.json")).andExpect(status().isNotFound()).andExpect(content().string(""))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/" + TOKEN + "/")).andExpect(status().isOk());
    }
}
