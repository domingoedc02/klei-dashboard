# Download site image (story 18.5). Build context is electron/download-site/.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY . .
RUN ./mvnw -B -ntp -q -DskipTests package

FROM eclipse-temurin:25-jre
# Numeric user with no passwd entry. Run with a read-only root filesystem; the data folder is mounted read-only.
USER 10001:10001
WORKDIR /app
COPY --from=build /src/target/download-site.jar /app/site.jar
EXPOSE 8090
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/site.jar"]
