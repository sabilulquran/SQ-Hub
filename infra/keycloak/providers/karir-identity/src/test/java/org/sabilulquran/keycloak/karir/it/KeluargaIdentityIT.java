package org.sabilulquran.keycloak.karir.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.sabilulquran.keycloak.karir.it.Browser.fields;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.jsoup.nodes.Element;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * KEL-IMPL-001 §12, provider bullet, for realm {@code sq-keluarga}: nomor KK sign-in, duplicate KK registration,
 * several WhatsApp numbers on reset (fake relay with {@code X-Keluarga-*} signature), verified-number bookkeeping,
 * the SPMB title for client {@code spmb-keluarga}, and no KK in tokens or the server log. The sq-karir behaviour is
 * covered unchanged by {@link KarirIdentityIT}. Every KK, name and number here is synthetic.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class KeluargaIdentityIT {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final AtomicInteger IP_COUNTER = new AtomicInteger(RANDOM.nextInt(1 << 22));
    private static final String REALM = "sq-keluarga";

    private static final String MSG_INVALID = "Nomor KK atau kata sandi salah";
    private static final String MSG_REGISTERED = "Nomor KK ini sudah terdaftar. Silakan masuk.";

    private KarirKeycloak keycloak;
    private final List<String> kks = new ArrayList<>();

    @BeforeAll
    void startKeycloak() throws Exception {
        keycloak = KarirKeycloak.start(KarirKeycloak.Target.KELUARGA);
    }

    @AfterAll
    void stopKeycloak() {
        if (keycloak != null) {
            keycloak.close();
        }
    }

    @Test
    @Order(1)
    void realmIsConfiguredAsSpecified() throws Exception {
        for (String output : keycloak.reconcileOutputs) {
            assertTrue(output.contains("KELUARGA_REALM_RECONCILE_IDEMPOTENT_PASS"), output);
            assertTrue(output.contains("KELUARGA_STAFF_BROKER_SKIPPED"), output);
        }
        assertFalse(keycloak.reconcileOutputs.get(1).contains("CREATED"), "second run must not create anything");
        JsonNode realm = keycloak.admin("GET", "/admin/realms/" + REALM, null).json();
        assertEquals("keluarga-browser", realm.path("browserFlow").asText());
        assertEquals("keluarga-registration", realm.path("registrationFlow").asText());
        assertEquals("keluarga-reset-credentials", realm.path("resetCredentialsFlow").asText());
        assertEquals("sq-keluarga", realm.path("loginTheme").asText());
        for (String clientId : List.of("keluarga-web", "spmb-keluarga")) {
            JsonNode client = keycloak.admin("GET", "/admin/realms/" + REALM + "/clients?clientId=" + clientId, null).json().get(0);
            assertEquals("S256", client.path("attributes").path("pkce.code.challenge.method").asText(), clientId);
            assertFalse(client.path("fullScopeAllowed").asBoolean(), clientId);
            assertEquals(0, client.path("protocolMappers").size(), clientId);
        }
    }

    @Test
    @Order(10)
    void registerWithKkVerifyWhatsAppThenSignIn() throws Exception {
        String kk = kk();
        String wa = waLocal();
        Browser browser = browser();
        String verifier = verifier();
        Browser.Page form = page(browser, authUrl(verifier, "registrations", "keluarga-web", keycloak.publicBaseUrl), "#kc-register-form");
        assertTrue(form.has("input[name=kk]"), "KK field");
        assertTrue(form.text().contains("Buat akun keluarga"), form.text());
        Browser.Page page = browser.follow(browser.submit(form, "#kc-register-form", fields(
                "kk", kk, "firstName", "Ibu Uji Sintetis", "waNumber", wa, "password", "Sandi-Uji-2026",
                "password-confirm", "Sandi-Uji-2026", "consent", "on", "cf-turnstile-response", FakeServices.TURNSTILE_PASS)),
                keycloak.baseUrl);
        assertTrue(page.has("#kc-otp-code-form"), page.text());
        FakeServices.Delivery delivery = keycloak.fakes.lastDeliveryTo(e164(wa)).orElseThrow();
        assertTrue(delivery.signatureValid(), "X-Keluarga signature");
        assertEquals("verify", delivery.purpose());

        Browser.Page done = browser.follow(browser.submit(page, "#kc-otp-code-form", fields("code", delivery.code())), keycloak.baseUrl);
        assertTokensCarryNoKk(keycloak.exchangeCode(callbackCode(done, keycloak.publicBaseUrl), verifier), kk);

        JsonNode user = userByKk(kk);
        assertTrue(user.path("username").asText().matches("f_[a-z2-7]{20}"), user.path("username").asText());
        assertEquals(List.of(e164(wa)), values(user, "wa_numbers"));
        assertEquals(List.of(e164(wa)), values(user, "wa_verified"));
        assertEquals(List.of("self"), values(user, "keluarga_source"));
        assertTrue(values(user, "nik_hmac").isEmpty(), "no Karir attribute in sq-keluarga");

        Browser second = browser();
        String verifier2 = verifier();
        Browser.Page login = page(second, authUrl(verifier2, "auth", "keluarga-web", keycloak.publicBaseUrl), "#kc-form-login");
        assertTrue(login.text().contains("Masuk ke Keluarga"), login.text());
        Browser.Page wrong = second.submit(login, "#kc-form-login", fields("kk", kk, "password", "salah-sekali-2026"));
        assertTrue(wrong.text().contains(MSG_INVALID), wrong.text());
        Browser.Page signedIn = second.follow(second.submit(wrong, "#kc-form-login",
                fields("kk", kk.substring(0, 4) + "-" + kk.substring(4), "password", "Sandi-Uji-2026")), keycloak.baseUrl);
        assertNotNull(callbackCode(signedIn, keycloak.publicBaseUrl));
    }

    @Test
    @Order(20)
    void duplicateKkOnlySaysAlreadyRegistered() throws Exception {
        String kk = kk();
        createMigratedFamily(kk, List.of(e164(waLocal())));
        Browser browser = browser();
        Browser.Page form = page(browser, authUrl(verifier(), "registrations", "keluarga-web", keycloak.publicBaseUrl), "#kc-register-form");
        Browser.Page result = browser.submit(form, "#kc-register-form", fields(
                "kk", kk, "firstName", "Ayah Uji Sintetis", "waNumber", waLocal(), "password", "Sandi-Uji-2026",
                "password-confirm", "Sandi-Uji-2026", "consent", "on", "cf-turnstile-response", FakeServices.TURNSTILE_PASS));
        assertTrue(result.text().contains(MSG_REGISTERED), result.text());
    }

    @Test
    @Order(30)
    void resetOffersEveryNumberUntilOneIsVerified() throws Exception {
        String kk = kk();
        String father = waLocal();
        String mother = waLocal();
        createMigratedFamily(kk, List.of(e164(father), e164(mother)));

        Browser browser = browser();
        String verifier = verifier();
        Browser.Page channels = startReset(browser, verifier, kk);
        List<String> ids = channelIds(channels);
        assertEquals(List.of("whatsapp", "whatsapp-2"), ids, channels.text());
        assertTrue(channels.text().contains(maskWa(father)) && channels.text().contains(maskWa(mother)), channels.text());

        Browser.Page codePage = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "whatsapp-2"));
        assertTrue(codePage.has("#kc-otp-code-form"), codePage.text());
        assertTrue(keycloak.fakes.deliveriesTo(e164(father)).isEmpty(), "nothing to the first number");
        FakeServices.Delivery delivery = keycloak.fakes.lastDeliveryTo(e164(mother)).orElseThrow();
        assertTrue(delivery.signatureValid());
        assertEquals("reset", delivery.purpose());
        Browser.Page update = browser.follow(browser.submit(codePage, "#kc-otp-code-form", fields("code", delivery.code())), keycloak.baseUrl);
        Browser.Page done = browser.follow(browser.submit(update, "#kc-passwd-update-form",
                fields("password-new", "Sandi-Baru-2026", "password-confirm", "Sandi-Baru-2026")), keycloak.baseUrl);
        assertNotNull(callbackCode(done, keycloak.publicBaseUrl));

        JsonNode user = userByKk(kk);
        assertEquals(List.of(e164(mother)), values(user, "wa_verified"));

        // Now only the verified number is offered.
        Browser again = browser();
        Browser.Page next = startReset(again, verifier(), kk);
        assertEquals(List.of("whatsapp"), channelIds(next), next.text());
        assertTrue(next.text().contains(maskWa(mother)) && !next.text().contains(maskWa(father)), next.text());
    }

    @Test
    @Order(40)
    void spmbClientShowsTheSpmbTitle() throws Exception {
        Browser.Page login = page(browser(), authUrl(verifier(), "auth", "spmb-keluarga", "http://spmb.test"), "#kc-form-login");
        assertTrue(login.text().contains("Masuk ke SPMB"), login.text());
        assertTrue(login.html().contains("sq-keluarga login.ftl"), "sq-keluarga theme");
        assertFalse(login.text().toLowerCase().contains("password"), "always 'kata sandi'");
    }

    @Test
    @Order(90)
    void noKkInTheServerLog() throws Exception {
        String log = keycloak.serverLog();
        for (String kk : kks) {
            assertFalse(log.contains(kk), "the server log contains a KK");
        }
        assertFalse(log.contains("NIK-like value"), "the event listener reported an identifier-like value");
    }

    // ------------------------------------------------------------------------------------------------------------

    private Browser browser() {
        int n = IP_COUNTER.incrementAndGet();
        return new Browser("10." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255));
    }

    private Browser.Page page(Browser browser, String url, String selector) {
        Browser.Page page = browser.get(url);
        assertTrue(page.has(selector), page.text());
        return page;
    }

    private Browser.Page startReset(Browser browser, String verifier, String kk) {
        Browser.Page login = page(browser, authUrl(verifier, "auth", "keluarga-web", keycloak.publicBaseUrl), "#kc-form-login");
        String href = login.document().selectFirst("a[href*=login-actions/reset-credentials]").absUrl("href");
        Browser.Page form = page(browser, href, "#kc-reset-password-form");
        Browser.Page channels = browser.submit(form, "#kc-reset-password-form",
                fields("kk", kk, "cf-turnstile-response", FakeServices.TURNSTILE_PASS));
        assertTrue(channels.has("#kc-choose-channel-form"), channels.text());
        return channels;
    }

    private static List<String> channelIds(Browser.Page page) {
        List<String> ids = new ArrayList<>();
        for (Element input : page.document().select("#kc-choose-channel-form input[name=channel]")) {
            ids.add(input.attr("value"));
        }
        return ids;
    }

    private String kk() {
        String kk;
        do {
            StringBuilder digits = new StringBuilder("32");
            for (int i = 0; i < 14; i++) {
                digits.append(RANDOM.nextInt(10));
            }
            kk = digits.toString();
        } while (kk.chars().distinct().count() == 1);
        kks.add(kk);
        return kk;
    }

    private static String waLocal() {
        StringBuilder digits = new StringBuilder("0857");
        for (int i = 0; i < 8; i++) {
            digits.append(RANDOM.nextInt(10));
        }
        return digits.toString();
    }

    private static String e164(String local) {
        return "62" + local.substring(1);
    }

    private static String maskWa(String local) {
        return local.substring(0, 4) + "•".repeat(Math.max(local.length() - 7, 3)) + local.substring(local.length() - 3);
    }

    private String kkHmac(String kk) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(keycloak.pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(("kk:v1:" + kk).getBytes(StandardCharsets.UTF_8)));
    }

    private static String verifier() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String authUrl(String verifier, String endpoint, String clientId, String publicBase) {
        try {
            String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
            return keycloak.baseUrl + "/realms/" + REALM + "/protocol/openid-connect/" + endpoint
                    + "?client_id=" + clientId + "&response_type=code&scope=openid"
                    + "&redirect_uri=" + KarirKeycloak.encode(publicBase + "/api/auth/callback")
                    + "&code_challenge=" + challenge + "&code_challenge_method=S256"
                    + "&state=" + verifier.substring(0, 12) + "&nonce=" + verifier.substring(12, 24);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static String callbackCode(Browser.Page page, String publicBase) {
        assertNotNull(page.location(), "expected a redirect to the app, got: " + page.text());
        assertTrue(page.location().startsWith(publicBase + "/api/auth/callback"), page.location());
        for (String pair : URI.create(page.location()).getRawQuery().split("&")) {
            if (pair.startsWith("code=")) {
                return java.net.URLDecoder.decode(pair.substring(5), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("no code in " + page.location());
    }

    private static void assertTokensCarryNoKk(JsonNode tokens, String kk) throws Exception {
        for (String name : List.of("id_token", "access_token")) {
            String token = tokens.path(name).asText();
            assertFalse(token.isEmpty(), name);
            JsonNode claims = JSON.readTree(Base64.getUrlDecoder().decode(token.split("\\.")[1]));
            assertFalse(claims.toString().contains(kk), name + " carries the KK");
            for (String claim : List.of("preferred_username", "email", "phone_number", "kk", "kk_hmac")) {
                assertFalse(claims.has(claim), name + " has " + claim);
            }
        }
    }

    private JsonNode userByKk(String kk) throws Exception {
        JsonNode users = keycloak.admin("GET", "/admin/realms/" + REALM + "/users?briefRepresentation=false&q="
                + KarirKeycloak.encode("kk_hmac:" + kkHmac(kk)), null).json();
        assertEquals(1, users.size());
        return users.get(0);
    }

    private static List<String> values(JsonNode user, String name) {
        List<String> values = new ArrayList<>();
        user.path("attributes").path(name).forEach(value -> values.add(value.asText()));
        return values;
    }

    /** The request Keluarga SQ's PPDB importer sends with keluarga-identity-admin (KEL-IMPL-001 §9). */
    private void createMigratedFamily(String kk, List<String> numbers) throws Exception {
        StringBuilder username = new StringBuilder("f_");
        for (int i = 0; i < 20; i++) {
            username.append("abcdefghijklmnopqrstuvwxyz234567".charAt(RANDOM.nextInt(32)));
        }
        Map<String, Object> attributes = new LinkedHashMap<>();
        attributes.put("kk_hmac", List.of(kkHmac(kk)));
        attributes.put("keluarga_source", List.of("ppdb"));
        attributes.put("wa_numbers", numbers);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username.toString());
        body.put("enabled", true);
        body.put("firstName", "Keluarga PPDB Sintetis");
        body.put("attributes", attributes);
        KarirKeycloak.Response response = keycloak.serviceAccount("POST", "/admin/realms/" + REALM + "/users",
                JSON.writeValueAsString(body));
        assertEquals(201, response.status(), response.body());
    }
}
