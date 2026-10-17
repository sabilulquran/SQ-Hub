package org.sabilulquran.keycloak.karir.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Stand-ins for the Karir SQ OTP relay ({@code /relay}) and Cloudflare Turnstile ({@code /turnstile}).
 * The relay checks the HMAC signature exactly like Karir SQ and records the delivered codes.
 */
final class FakeServices implements AutoCloseable {
    static final String TURNSTILE_PASS = "turnstile-pass";
    private static final ObjectMapper JSON = new ObjectMapper();

    record Delivery(String to, String code, String purpose, String requestId, boolean signatureValid) {
    }

    private final HttpServer server;
    private final String relaySecret;
    private final String headerPrefix;
    private final List<Delivery> deliveries = new ArrayList<>();
    private final AtomicInteger relayStatus = new AtomicInteger(202);
    private final AtomicInteger turnstileChecks = new AtomicInteger();

    FakeServices(int port, String relaySecret) throws IOException {
        this(port, relaySecret, "X-Karir");
    }

    /** {@code headerPrefix} is {@code X-Karir} for the Karir SQ relay and {@code X-Keluarga} for Keluarga SQ. */
    FakeServices(int port, String relaySecret, String headerPrefix) throws IOException {
        this.relaySecret = relaySecret;
        this.headerPrefix = headerPrefix;
        server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/relay", this::relay);
        server.createContext("/turnstile", this::turnstile);
        server.start();
    }

    int port() {
        return server.getAddress().getPort();
    }

    void relayAnswers(int status) {
        relayStatus.set(status);
    }

    int turnstileChecks() {
        return turnstileChecks.get();
    }

    synchronized List<Delivery> deliveriesTo(String to) {
        return deliveries.stream().filter(d -> d.to().equals(to)).toList();
    }

    synchronized Optional<Delivery> lastDeliveryTo(String to) {
        List<Delivery> matching = deliveriesTo(to);
        return matching.isEmpty() ? Optional.empty() : Optional.of(matching.get(matching.size() - 1));
    }

    synchronized List<Delivery> all() {
        return List.copyOf(deliveries);
    }

    private void relay(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String timestamp = exchange.getRequestHeaders().getFirst(headerPrefix + "-Timestamp");
        String signature = exchange.getRequestHeaders().getFirst(headerPrefix + "-Signature");
        boolean valid = timestamp != null && signature != null && timestamp.matches("\\d{10}")
                && Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(timestamp)) <= 60
                && MessageDigest.isEqual(sign(timestamp + "." + body).getBytes(StandardCharsets.US_ASCII),
                        signature.getBytes(StandardCharsets.US_ASCII));
        JsonNode json = JSON.readTree(body);
        int status = valid ? relayStatus.get() : 401;
        synchronized (this) {
            if (status == 202) {
                deliveries.add(new Delivery(json.path("to").asText(), json.path("code").asText(),
                        json.path("purpose").asText(), json.path("requestId").asText(), valid));
            }
        }
        exchange.sendResponseHeaders(status, -1);
        exchange.close();
    }

    private void turnstile(HttpExchange exchange) throws IOException {
        turnstileChecks.incrementAndGet();
        String body = URLDecoder.decode(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8),
                StandardCharsets.UTF_8);
        boolean success = body.contains("response=" + TURNSTILE_PASS);
        byte[] answer = ("{\"success\":" + success + "}").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, answer.length);
        exchange.getResponseBody().write(answer);
        exchange.close();
    }

    private String sign(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(relaySecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
