package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OtpDeliveryClientTest {
    private static final String SECRET = "relay-secret-for-unit-tests-only-0123456789";
    private HttpServer server;
    private final List<String[]> received = new ArrayList<>();
    private final AtomicInteger status = new AtomicInteger(202);

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/otp-deliveries", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            received.add(new String[] {
                    exchange.getRequestHeaders().getFirst("X-Karir-Timestamp"),
                    exchange.getRequestHeaders().getFirst("X-Karir-Signature"),
                    exchange.getRequestHeaders().getFirst("Content-Type"),
                    body});
            exchange.sendResponseHeaders(status.get(), -1);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void signatureMatchesKarirSq() {
        String body = "{\"channel\":\"whatsapp\",\"to\":\"6281234567890\",\"code\":\"481702\",\"purpose\":\"reset\","
                + "\"requestId\":\"00000000-0000-4000-8000-000000000001\"}";
        assertEquals(body, OtpDeliveryClient.relayBody("6281234567890", "481702", OtpDeliveryClient.Purpose.RESET,
                "00000000-0000-4000-8000-000000000001"));
        // Computed with karir-sq signRelayRequest(secret, "1760000000", body).
        assertEquals("1148667cde3d8d8e8aae082d40d60226fd1607dab114e746ecbd6f2d025baef7",
                OtpDeliveryClient.sign(SECRET, "1760000000", body));
    }

    @Test
    void relayBodyRefusesAnythingButDigits() {
        assertThrows(IllegalArgumentException.class, () ->
                OtpDeliveryClient.relayBody("62812\",\"x", "481702", OtpDeliveryClient.Purpose.VERIFY, "id"));
        assertThrows(IllegalArgumentException.class, () ->
                OtpDeliveryClient.relayBody("6281234567890", "48170", OtpDeliveryClient.Purpose.VERIFY, "id"));
    }

    @Test
    void postsSignedRequestAndTreats202AsSent() {
        Clock clock = Clock.fixed(Instant.ofEpochSecond(1_760_000_000L), ZoneOffset.UTC);
        OtpDeliveryClient client = new OtpDeliveryClient(HttpClient.newHttpClient(), relayUri(), SECRET, clock);

        assertEquals(OtpDeliveryClient.Result.SENT,
                client.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.VERIFY));

        assertEquals(1, received.size());
        String[] request = received.get(0);
        assertEquals("1760000000", request[0]);
        assertEquals(OtpDeliveryClient.sign(SECRET, request[0], request[3]), request[1]);
        assertEquals("application/json", request[2]);
        assertTrue(request[3].contains("\"purpose\":\"verify\""));
        assertTrue(request[3].matches(".*\"requestId\":\"[0-9a-f-]{36}\".*"));
    }

    @Test
    void mapsRelayRefusals() {
        OtpDeliveryClient client = new OtpDeliveryClient(HttpClient.newHttpClient(), relayUri(), SECRET, Clock.systemUTC());
        status.set(429);
        assertEquals(OtpDeliveryClient.Result.RATE_LIMITED,
                client.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.RESET));
        status.set(503);
        assertEquals(OtpDeliveryClient.Result.FAILED,
                client.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.RESET));
        status.set(401);
        assertEquals(OtpDeliveryClient.Result.FAILED,
                client.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.RESET));
    }

    @Test
    void unreachableOrUnconfiguredRelayFails() {
        server.stop(0);
        OtpDeliveryClient unreachable = new OtpDeliveryClient(HttpClient.newHttpClient(), relayUri(), SECRET, Clock.systemUTC());
        assertEquals(OtpDeliveryClient.Result.FAILED,
                unreachable.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.RESET));
        OtpDeliveryClient unconfigured = new OtpDeliveryClient(HttpClient.newHttpClient(), relayUri(), null, Clock.systemUTC());
        assertEquals(OtpDeliveryClient.Result.FAILED,
                unconfigured.sendWhatsApp("6281234567890", "123456", OtpDeliveryClient.Purpose.RESET));
    }

    @Test
    void emailTextNamesTheCodeButNothingElse() {
        String text = OtpDeliveryClient.emailText("123456");
        assertTrue(text.contains("123456"));
        assertFalse(text.toLowerCase().contains("password"));
    }

    private URI relayUri() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/internal/otp-deliveries");
    }
}
