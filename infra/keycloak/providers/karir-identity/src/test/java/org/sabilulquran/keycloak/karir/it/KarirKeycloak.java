package org.sabilulquran.keycloak.karir.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetup;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.testcontainers.Testcontainers;
import org.testcontainers.containers.Container;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;

/**
 * The Keycloak under test. By default a Testcontainers Keycloak 26.7.2 with the provider JAR and the themes,
 * configured by running the realm's reconcile script twice (it must be idempotent): {@link Target#KARIR} runs
 * {@code scripts/reconcile-karir-realm.sh}, {@link Target#KELUARGA} runs {@code scripts/reconcile-keluarga-realm.sh}.
 *
 * <p>With {@code -Dkarir.it.keycloakUrl=...} the tests run against an already running, already reconciled Keycloak
 * instead (local debugging without Docker); the other {@code karir.it.*} properties then describe that instance.
 */
final class KarirKeycloak implements AutoCloseable {
    /** What differs between the two realms served by the provider. */
    enum Target {
        KARIR("sq-karir", "reconcile-karir-realm.sh", "KARIR_REALM_RECONCILE_IDEMPOTENT_PASS", "SQ_KARIR_", "NIK_PEPPER",
                "X-Karir", "karir-portal", "karir-identity-admin", "http://karir.test", "/tmp/sq-karir-realm.kcadm"),
        KELUARGA("sq-keluarga", "reconcile-keluarga-realm.sh", "KELUARGA_REALM_RECONCILE_IDEMPOTENT_PASS", "SQ_KELUARGA_",
                "KK_PEPPER", "X-Keluarga", "keluarga-web", "keluarga-identity-admin", "http://keluarga.test",
                "/tmp/sq-keluarga-realm.kcadm");

        final String realm;
        final String script;
        final String passMarker;
        final String envPrefix;
        final String pepperVariable;
        final String relayHeaderPrefix;
        final String portalClient;
        final String adminClient;
        final String publicBase;
        final String kcadmConfig;

        Target(String realm, String script, String passMarker, String envPrefix, String pepperVariable,
               String relayHeaderPrefix, String portalClient, String adminClient, String publicBase, String kcadmConfig) {
            this.realm = realm;
            this.script = script;
            this.passMarker = passMarker;
            this.envPrefix = envPrefix;
            this.pepperVariable = pepperVariable;
            this.relayHeaderPrefix = relayHeaderPrefix;
            this.portalClient = portalClient;
            this.adminClient = adminClient;
            this.publicBase = publicBase;
            this.kcadmConfig = kcadmConfig;
        }
    }

    static final String REALM = Target.KARIR.realm;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String IMAGE = "quay.io/keycloak/keycloak:26.7.2";
    private static final String CONTAINER_ADMIN = "it-admin";
    private static final String CONTAINER_ADMIN_PASSWORD = "it-admin-password-synthetic-only";

    final Target target;
    final String baseUrl;
    final String publicBaseUrl;
    final String pepper;
    final String portalSecret;
    final String adminClientSecret;
    final FakeServices fakes;
    final GreenMail mail;
    final List<String> reconcileOutputs = new ArrayList<>();
    private final String adminUser;
    private final String adminPassword;
    private final GenericContainer<?> container;
    private final Path externalLog;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private KarirKeycloak(Target target, String baseUrl, String publicBaseUrl, String pepper, String portalSecret,
                          String adminClientSecret, FakeServices fakes, GreenMail mail, String adminUser,
                          String adminPassword, GenericContainer<?> container, Path externalLog) {
        this.target = target;
        this.baseUrl = baseUrl;
        this.publicBaseUrl = publicBaseUrl;
        this.pepper = pepper;
        this.portalSecret = portalSecret;
        this.adminClientSecret = adminClientSecret;
        this.fakes = fakes;
        this.mail = mail;
        this.adminUser = adminUser;
        this.adminPassword = adminPassword;
        this.container = container;
        this.externalLog = externalLog;
    }

    static KarirKeycloak start() throws Exception {
        String external = System.getProperty("karir.it.keycloakUrl");
        return external == null || external.isBlank() ? startContainer(Target.KARIR) : external(external);
    }

    /** A container for one realm. The external-instance mode is only offered for {@link Target#KARIR}. */
    static KarirKeycloak start(Target target) throws Exception {
        return target == Target.KARIR ? start() : startContainer(target);
    }

    private static KarirKeycloak external(String url) throws Exception {
        String relaySecret = System.getProperty("karir.it.relaySecret");
        FakeServices fakes = new FakeServices(Integer.getInteger("karir.it.fakePort", 18999), relaySecret);
        GreenMail mail = new GreenMail(new ServerSetup(Integer.getInteger("karir.it.smtpPort", 18025), "127.0.0.1", "smtp"));
        mail.start();
        String log = System.getProperty("karir.it.logFile");
        KarirKeycloak keycloak = new KarirKeycloak(Target.KARIR, url.replaceAll("/$", ""), System.getProperty("karir.it.publicBase"),
                System.getProperty("karir.it.pepper"), System.getProperty("karir.it.portalSecret"),
                System.getProperty("karir.it.adminClientSecret"), fakes, mail, System.getProperty("karir.it.adminUser"),
                System.getProperty("karir.it.adminPassword"), null, log == null ? null : Path.of(log));
        keycloak.configureSmtp("127.0.0.1", mail.getSmtp().getPort());
        return keycloak;
    }

    private static KarirKeycloak startContainer(Target target) throws Exception {
        String pepper = "it-pepper-synthetic-only-0123456789abcdef";
        String relaySecret = "it-relay-secret-synthetic-only-0123456789";
        String portalSecret = "it-portal-secret-synthetic-only-0123456789";
        String adminClientSecret = "it-admin-client-secret-synthetic-only-0123";
        String publicBase = target.publicBase;
        String env = target.envPrefix;
        Path keycloakDir = Path.of(System.getProperty("karir.keycloakDir")).toAbsolutePath().normalize();
        Path jar = Path.of(System.getProperty("karir.providerJar"));

        FakeServices fakes = new FakeServices(0, relaySecret, target.relayHeaderPrefix);
        GreenMail mail = new GreenMail(new ServerSetup(0, "0.0.0.0", "smtp").dynamicPort());
        mail.start();
        Testcontainers.exposeHostPorts(fakes.port(), mail.getSmtp().getPort());

        GenericContainer<?> container = new GenericContainer<>(IMAGE)
                .withCopyFileToContainer(MountableFile.forHostPath(jar, 0644), "/opt/keycloak/providers/sq-external-identity.jar")
                .withCopyFileToContainer(MountableFile.forHostPath(keycloakDir.resolve("themes/sq-hub"), 0755), "/opt/keycloak/themes/sq-hub")
                .withCopyFileToContainer(MountableFile.forHostPath(keycloakDir.resolve("themes/sq-karir"), 0755), "/opt/keycloak/themes/sq-karir")
                .withCopyFileToContainer(MountableFile.forHostPath(keycloakDir.resolve("themes/sq-keluarga"), 0755), "/opt/keycloak/themes/sq-keluarga")
                .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", CONTAINER_ADMIN)
                .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", CONTAINER_ADMIN_PASSWORD)
                .withEnv("KC_HEALTH_ENABLED", "true")
                .withEnv("KC_PROXY_HEADERS", "xforwarded")
                .withEnv("KC_CACHE", "local")
                .withEnv(env + target.pepperVariable, pepper)
                .withEnv(env + "OTP_RELAY_URL", "http://host.testcontainers.internal:" + fakes.port() + "/relay")
                .withEnv(env + "OTP_RELAY_SECRET", relaySecret)
                .withEnv(env + "TURNSTILE_SITE_KEY", "1x00000000000000000000AA")
                .withEnv(env + "TURNSTILE_SECRET", "it-turnstile-secret")
                .withEnv(env + "TURNSTILE_VERIFY_URL", "http://host.testcontainers.internal:" + fakes.port() + "/turnstile")
                .withCommand("start-dev")
                .withExposedPorts(8080, 9000)
                .waitingFor(Wait.forHttp("/health/ready").forPort(9000).withStartupTimeout(Duration.ofMinutes(4)));
        container.start();
        String baseUrl = "http://" + container.getHost() + ":" + container.getMappedPort(8080);
        KarirKeycloak keycloak = new KarirKeycloak(target, baseUrl, publicBase, pepper, portalSecret, adminClientSecret, fakes,
                mail, CONTAINER_ADMIN, CONTAINER_ADMIN_PASSWORD, container, null);

        Container.ExecResult login = container.execInContainer("/opt/keycloak/bin/kcadm.sh", "config", "credentials",
                "--server", "http://localhost:8080", "--realm", "master", "--user", CONTAINER_ADMIN,
                "--password", CONTAINER_ADMIN_PASSWORD, "--config", target.kcadmConfig);
        if (login.getExitCode() != 0) {
            throw new IllegalStateException("kcadm login failed: " + login.getStderr());
        }
        for (int run = 1; run <= 2; run++) {
            keycloak.reconcileOutputs.add(keycloak.runReconcile(keycloakDir, "host.testcontainers.internal", mail.getSmtp().getPort()));
        }
        return keycloak;
    }

    private String runReconcile(Path keycloakDir, String smtpHost, int smtpPort) throws Exception {
        ProcessBuilder builder = new ProcessBuilder("bash", keycloakDir.resolve("scripts/" + target.script).toString())
                .redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.put("KEYCLOAK_EXEC_MODE", "container");
        env.put("KEYCLOAK_CONTAINER", container.getContainerName().replaceFirst("^/", ""));
        env.put("KEYCLOAK_KCADM_CONFIG", target.kcadmConfig);
        if (target == Target.KARIR) {
            env.put("KARIR_PORTAL_CLIENT_SECRET", portalSecret);
            env.put("KARIR_IDENTITY_ADMIN_CLIENT_SECRET", adminClientSecret);
            env.put("KARIR_PUBLIC_BASE_URL", publicBaseUrl);
        } else {
            env.put("KELUARGA_WEB_CLIENT_SECRET", portalSecret);
            env.put("KELUARGA_IDENTITY_ADMIN_CLIENT_SECRET", adminClientSecret);
            env.put("KELUARGA_PUBLIC_BASE_URL", publicBaseUrl);
            env.put("SPMB_PUBLIC_BASE_URL", "http://spmb.test");
        }
        String smtp = target == Target.KARIR ? "KARIR_SMTP_" : "KELUARGA_SMTP_";
        env.put(smtp + "HOST", smtpHost);
        env.put(smtp + "PORT", Integer.toString(smtpPort));
        env.put(smtp + "FROM", "identity@example.test");
        env.put(smtp + "STARTTLS", "false");
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.waitFor() != 0 || !output.contains(target.passMarker)) {
            throw new IllegalStateException(target.script + " failed:\n" + output);
        }
        return output;
    }

    /** Keycloak server log so far (container stdout, or the external log file). */
    String serverLog() throws IOException {
        if (container != null) {
            return container.getLogs();
        }
        return externalLog != null && Files.exists(externalLog) ? Files.readString(externalLog) : "";
    }

    void configureSmtp(String host, int port) throws Exception {
        JsonNode realm = admin("GET", "/admin/realms/" + target.realm, null).json();
        ((com.fasterxml.jackson.databind.node.ObjectNode) realm).set("smtpServer", JSON.valueToTree(Map.of(
                "host", host, "port", Integer.toString(port), "from", "karir@example.test",
                "starttls", "false", "ssl", "false", "auth", "false")));
        Response response = admin("PUT", "/admin/realms/" + target.realm, JSON.writeValueAsString(realm));
        if (response.status() != 204) {
            throw new IllegalStateException("SMTP setup failed: " + response.status());
        }
    }

    record Response(int status, String body, HttpResponse<String> raw) {
        JsonNode json() throws IOException {
            return JSON.readTree(body);
        }
    }

    Response admin(String method, String path, String jsonBody) throws Exception {
        return call(method, path, jsonBody, masterToken());
    }

    Response serviceAccount(String method, String path, String jsonBody) throws Exception {
        return call(method, path, jsonBody, clientCredentialsToken());
    }

    String clientCredentialsToken() throws Exception {
        return token("/realms/" + target.realm + "/protocol/openid-connect/token",
                "grant_type=client_credentials&client_id=" + target.adminClient + "&client_secret=" + encode(adminClientSecret));
    }

    JsonNode exchangeCode(String code, String verifier) throws Exception {
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(baseUrl + "/realms/" + target.realm + "/protocol/openid-connect/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=authorization_code&client_id=" + target.portalClient
                        + "&client_secret=" + encode(portalSecret) + "&code=" + encode(code)
                        + "&code_verifier=" + encode(verifier)
                        + "&redirect_uri=" + encode(publicBaseUrl + "/api/auth/callback")))
                .build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new AssertionError("code exchange failed: " + response.statusCode() + " " + response.body());
        }
        return JSON.readTree(response.body());
    }

    private String masterToken() throws Exception {
        return token("/realms/master/protocol/openid-connect/token",
                "grant_type=password&client_id=admin-cli&username=" + encode(adminUser) + "&password=" + encode(adminPassword));
    }

    private String token(String path, String form) throws Exception {
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form)).build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("token request failed: " + response.statusCode());
        }
        return JSON.readTree(response.body()).path("access_token").asText();
    }

    private Response call(String method, String path, String jsonBody, String token) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/json");
        if (jsonBody == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(jsonBody));
        }
        HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(), response.body(), response);
    }

    static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    @Override
    public void close() {
        fakes.close();
        mail.stop();
        if (container != null) {
            container.stop();
        }
    }
}
