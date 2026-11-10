# Backend image (Story 1.2). Build context is `backend/`: see the `backend` service in docker-compose.yml.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY . .
RUN ./mvnw -B -ntp -q -DskipTests package -pl app -am

FROM eclipse-temurin:25-jre
# Numeric user with no passwd entry: nothing to log in as. Root filesystem is read-only at run time; /tmp is a tmpfs.
USER 10001:10001
WORKDIR /app
COPY --from=build /src/app/target/klei-app-*.jar /app/klei.jar
EXPOSE 8080 8081
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-XX:+ExitOnOutOfMemoryError", "-XX:-HeapDumpOnOutOfMemoryError", "-jar", "/app/klei.jar"]
