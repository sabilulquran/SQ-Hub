package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ConfigTurnstileAndEventsTest {
    private static final String SECRET32 = "s".repeat(32);

    @Test
    void configFailsClosedOnShortOrMissingSecrets() {
        KarirConfig config = KarirConfig.fromEnvironment(Map.of(
                "SQ_KARIR_NIK_PEPPER", "too-short",
                "SQ_KARIR_OTP_RELAY_SECRET", SECRET32));
        assertFalse(config.nikLookupAvailable());
        assertTrue(config.whatsAppRelayAvailable());
        assertFalse(config.turnstileAvailable());
        assertEquals(KarirConfig.DEFAULT_RELAY_URL, config.relayUrl());
        assertEquals(KarirConfig.DEFAULT_TURNSTILE_VERIFY_URL, config.turnstileVerifyUrl());
        assertFalse(config.toString().contains(SECRET32));
    }

    @Test
    void configRejectsNonHttpUrls() {
        KarirConfig config = KarirConfig.fromEnvironment(Map.of("SQ_KARIR_OTP_RELAY_URL", "file:///etc/passwd"));
        assertNull(config.relayUrl());
        assertFalse(config.whatsAppRelayAvailable());
    }

    @Test
    void turnstileChecksTokenWithTheServer() throws IOException {
        AtomicReference<String> seen = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/siteverify", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            seen.set(URLDecoder.decode(body, StandardCharsets.UTF_8));
            byte[] answer = (body.contains("response=good") ? "{\"success\":true}" : "{\"success\":false}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, answer.length);
            exchange.getResponseBody().write(answer);
            exchange.close();
        });
        server.start();
        try {
            URI url = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/siteverify");
            TurnstileVerifier verifier = new TurnstileVerifier(HttpClient.newHttpClient(), url, "turnstile-secret");
            assertTrue(verifier.verify("good", "198.51.100.7"));
            assertTrue(seen.get().contains("secret=turnstile-secret"));
            assertTrue(seen.get().contains("remoteip=198.51.100.7"));
            assertFalse(verifier.verify("bad", "198.51.100.7"));
            assertFalse(verifier.verify("", "198.51.100.7"));
            assertFalse(verifier.verify(null, "198.51.100.7"));
            assertFalse(new TurnstileVerifier(HttpClient.newHttpClient(), url, null).verify("good", null));
        } finally {
            server.stop(0);
        }
        assertFalse(new TurnstileVerifier(HttpClient.newHttpClient(),
                URI.create("http://127.0.0.1:9/unreachable"), "secret").verify("good", null));
    }

    @Test
    void eventListenerRecognisesNikLikeValues() {
        assertTrue(KarirEventListener.looksLikeNik("3201234567890123"));
        assertTrue(KarirEventListener.looksLikeNik("nik=3201234567890123;"));
        assertFalse(KarirEventListener.looksLikeNik("k_abcdefghijklmnopqrst"));
        assertFalse(KarirEventListener.looksLikeNik("0001234567890123"), "not a valid province code");
        assertFalse(KarirEventListener.looksLikeNik("abc3201234567890123def"), "part of a longer token, e.g. a hash");
        assertFalse(KarirEventListener.looksLikeNik(null));
    }
}
