package co.klei.app.web

import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.media.Content
import io.swagger.v3.oas.models.media.MediaType
import io.swagger.v3.oas.models.media.ArraySchema
import io.swagger.v3.oas.models.media.ObjectSchema
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.media.StringSchema
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import io.swagger.v3.oas.models.servers.Server
import org.springdoc.core.customizers.OpenApiCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * The OpenAPI contract (`docs/api/openapi.json`, architecture §7). Every error is one `Problem`; its `extensions`
 * object has a fixed schema per `code`, declared here so the desktop client never meets an undeclared field.
 */
@Configuration
class OpenApiConfig {
    @Bean
    fun api(): OpenAPI = OpenAPI()
        .info(Info().title("Klei Bridal API").version("1"))
        // Fixed, or springdoc writes the random test port into the committed file.
        .servers(listOf(Server().url("/")))
        .components(Components().addSecuritySchemes("bearer", SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
        .addSecurityItem(SecurityRequirement().addList("bearer"))

    @Bean
    fun problemSchemas() = OpenApiCustomizer { api ->
        val c = api.components
        // Only 409 carries extensions so far (`usedBy`, Taxonomy); add a code's properties here when its endpoint lands.
        ProblemCode.entries.forEach {
            val schema = ObjectSchema().additionalProperties(false)
            if (it == ProblemCode.CONFLICT) schema.addProperty("usedBy", Schema<Long>().type("integer").format("int64")).addProperty("check", StringSchema())
            c.addSchemas("Extensions_${it.code}", schema)
        }
        c.addSchemas(
            "Problem",
            ObjectSchema()
                .addProperty("type", StringSchema())
                .addProperty("title", StringSchema())
                .addProperty("status", Schema<Int>().type("integer"))
                .addProperty("code", StringSchema()._enum(ProblemCode.entries.map { it.code }))
                .addProperty("correlationId", StringSchema())
                // Only a 422 names fields, by fixed code; the submitted value is never echoed.
                .addProperty("fields", ArraySchema().items(ObjectSchema().addProperty("field", StringSchema()).addProperty("code", StringSchema()).required(listOf("field", "code"))))
                .addProperty("extensions", Schema<Any>().oneOf(ProblemCode.entries.map { Schema<Any>().`$ref`("#/components/schemas/Extensions_${it.code}") }))
                .required(listOf("type", "title", "status", "code", "correlationId")),
        )
        val problem = ApiResponse().description("Sign-in required or out of date").content(
            Content().addMediaType("application/problem+json", MediaType().schema(Schema<Any>().`$ref`("#/components/schemas/Problem"))),
        )
        api.paths?.values?.forEach { p -> p.readOperations().forEach { it.responses.addApiResponse("401", problem) } }
    }
}
