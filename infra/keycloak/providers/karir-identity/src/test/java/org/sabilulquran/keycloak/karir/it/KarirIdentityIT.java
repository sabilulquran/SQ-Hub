package org.sabilulquran.keycloak.karir.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.sabilulquran.keycloak.karir.it.Browser.fields;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.icegreen.greenmail.util.GreenMailUtil;
import jakarta.mail.internet.MimeMessage;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * REC-IMPL-001 §12, provider bullet: NIK sign-in, duplicate NIK registration, account without kata sandi, reset by
 * WhatsApp code (fake relay) and email code (fake SMTP), frozen account, rate limits, and no NIK in tokens, events,
 * URLs or the server log. Every NIK, name, number and address here is synthetic.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class KarirIdentityIT {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final AtomicInteger IP_COUNTER = new AtomicInteger(RANDOM.nextInt(1 << 22));
    private static final Pattern EMAIL_CODE = Pattern.compile("Anda: (\\d{6})");

    private static final String MSG_INVALID = "NIK atau kata sandi salah";
    private static final String MSG_DISABLED = "Akun tidak dapat digunakan. Hubungi HC Yayasan Sabilul Qur'an.";
    private static final String MSG_NO_PASSWORD = "Akun Anda belum punya kata sandi. Gunakan Lupa kata sandi.";
    private static final String MSG_REGISTERED = "NIK ini sudah terdaftar. Silakan masuk.";
    private static final String MSG_NOT_SENT = "Kode belum terkirim. Coba lagi atau pilih email.";
    private static final String MSG_TRY_LATER = "Coba lagi nanti";
    private static final String MSG_TURNSTILE = "Verifikasi keamanan belum berhasil. Coba lagi.";
    private static final String MSG_IP_BLOCKED = "Terlalu banyak percobaan dari jaringan ini. Coba lagi dalam 15 menit.";
    private static final String MSG_CODE_WRONG = "Kode salah. Periksa lagi kode Anda.";
    private static final String MSG_SENT_GENERIC = "Jika NIK terdaftar, kode sudah dikirim ke nomor WhatsApp atau email yang tercatat.";

    private KarirKeycloak keycloak;
    private final List<String> niks = new ArrayList<>();
    private final List<Browser.Page> visited = new ArrayList<>();

    @BeforeAll
    void startKeycloak() throws Exception {
        keycloak = KarirKeycloak.start();
    }

    @AfterAll
    void stopKeycloak() {
        if (keycloak != null) {
            keycloak.close();
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Reconcile script
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(1)
    void realmIsConfiguredAsSpecified() throws Exception {
        for (String output : keycloak.reconcileOutputs) {
            assertTrue(output.contains("KARIR_REALM_RECONCILE_IDEMPOTENT_PASS"), output);
        }
        if (keycloak.reconcileOutputs.size() == 2) {
            assertFalse(keycloak.reconcileOutputs.get(1).contains("CREATED"), "second run must not create anything");
        }
        JsonNode realm = keycloak.admin("GET", "/admin/realms/sq-karir", null).json();
        assertEquals("karir-browser", realm.path("browserFlow").asText());
        assertEquals("karir-registration", realm.path("registrationFlow").asText());
        assertEquals("karir-reset-credentials", realm.path("resetCredentialsFlow").asText());
        assertTrue(realm.path("bruteForceProtected").asBoolean());
        assertEquals(5, realm.path("failureFactor").asInt());
        assertEquals(900, realm.path("waitIncrementSeconds").asInt());
        assertTrue(realm.path("eventsEnabled").asBoolean());
        assertEquals(7_776_000, realm.path("eventsExpiration").asLong());
        assertEquals("[\"karir-event-listener\"]", realm.path("eventsListeners").toString());
        assertEquals("sq-karir", realm.path("loginTheme").asText());

        JsonNode portal = keycloak.admin("GET", "/admin/realms/sq-karir/clients?clientId=karir-portal", null).json().get(0);
        assertEquals("S256", portal.path("attributes").path("pkce.code.challenge.method").asText());
        assertFalse(portal.path("fullScopeAllowed").asBoolean());
        assertFalse(portal.path("directAccessGrantsEnabled").asBoolean());
        assertEquals(0, portal.path("protocolMappers").size());
        JsonNode scopes = keycloak.admin("GET", "/admin/realms/sq-karir/clients/" + portal.path("id").asText()
                + "/default-client-scopes", null).json();
        List<String> names = new ArrayList<>();
        scopes.forEach(scope -> names.add(scope.path("name").asText()));
        assertFalse(names.contains("profile") || names.contains("email") || names.contains("phone"), names.toString());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Registration and NIK sign-in
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(10)
    void registerVerifyWhatsAppThenSignInWithNik() throws Exception {
        String nik = nik();
        String wa = waLocal();
        Browser browser = browser();
        String verifier = verifier();
        Browser.Page page = register(browser, verifier, nik, "Rina Uji Sintetis", wa, "Sandi-Uji-2026");

        // Registered, but the sign-in does not complete before the WhatsApp number is verified.
        assertTrue(page.has("#kc-otp-code-form"), page.text());
        assertTrue(page.text().contains(maskWa(wa)), page.text());
        assertTrue(page.text().contains("Verifikasi nomor WhatsApp"), page.text());
        FakeServices.Delivery delivery = keycloak.fakes.lastDeliveryTo(e164(wa)).orElseThrow();
        assertEquals("verify", delivery.purpose());
        assertTrue(delivery.signatureValid());

        Browser.Page wrong = browser.submit(page, "#kc-otp-code-form", fields("code", otherCode(delivery.code())));
        assertTrue(wrong.text().contains(MSG_CODE_WRONG), wrong.text());

        Browser.Page done = browser.follow(browser.submit(wrong, "#kc-otp-code-form", fields("code", delivery.code())), keycloak.baseUrl);
        JsonNode tokens = keycloak.exchangeCode(callbackCode(done), verifier);
        assertTokensCarryNoIdentityData(tokens, nik, wa);

        JsonNode user = userByNikHmac(nik);
        assertTrue(user.path("username").asText().matches("k_[a-z2-7]{20}"));
        assertEquals("Rina Uji Sintetis", user.path("firstName").asText());
        assertEquals("self", attribute(user, "karir_source"));
        assertEquals("true", attribute(user, "wa_verified"));
        assertEquals(e164(wa), attribute(user, "wa_number"));
        assertFalse(user.toString().contains(nik));

        // Sign in again with the NIK typed with separators.
        String typed = nik.substring(0, 4) + " " + nik.substring(4, 8) + "." + nik.substring(8, 12) + "-" + nik.substring(12);
        Browser second = browser();
        String verifier2 = verifier();
        Browser.Page signedIn = second.follow(login(second, verifier2, typed, "Sandi-Uji-2026"), keycloak.baseUrl);
        assertTokensCarryNoIdentityData(keycloak.exchangeCode(callbackCode(signedIn), verifier2), nik, wa);
    }

    @Test
    @Order(11)
    void wrongPasswordAndUnknownNikShowTheSameMessage() throws Exception {
        String nik = nik();
        registerAndVerify(nik, waLocal(), "Sandi-Uji-2026");

        Browser.Page wrongPassword = login(browser(), verifier(), nik, "bukan-sandinya");
        Browser.Page unknownNik = login(browser(), verifier(), nik(), "Sandi-Uji-2026");
        Browser.Page badFormat = login(browser(), verifier(), "1234", "Sandi-Uji-2026");
        for (Browser.Page page : List.of(wrongPassword, unknownNik, badFormat)) {
            assertTrue(page.has("#kc-form-login"), page.text());
            assertTrue(page.text().contains(MSG_INVALID), page.text());
        }
        assertFalse(wrongPassword.html().contains(nik), "the NIK is not echoed back");
    }

    @Test
    @Order(12)
    void duplicateNikRegistrationOnlySaysRegistered() throws Exception {
        String nik = nik();
        String firstWa = waLocal();
        registerAndVerify(nik, firstWa, "Sandi-Uji-2026");

        String otherWa = waLocal();
        Browser.Page page = register(browser(), verifier(), nik, "Nama Lain Sintetis", otherWa, "Sandi-Lain-2026");
        assertTrue(page.text().contains(MSG_REGISTERED), page.text());
        assertTrue(page.has("#kc-registered-login"), "offers the Masuk button");
        assertFalse(page.text().contains(maskWa(firstWa)), "nothing about the existing account");
        assertFalse(page.text().contains("Rina"), "nothing about the existing account");
        assertTrue(keycloak.fakes.deliveriesTo(e164(otherWa)).isEmpty(), "no code to the new number");
        assertEquals(1, usersByNikHmac(nik).size());
    }

    @Test
    @Order(13)
    void registrationAlwaysRequiresTurnstile() throws Exception {
        String nik = nik();
        Browser browser = browser();
        Browser.Page form = registrationPage(browser, verifier());
        assertTrue(form.has(".cf-turnstile"), "Turnstile widget on Daftar");
        Browser.Page page = browser.submit(form, "#kc-register-form", fields(
                "nik", nik, "firstName", "Tanpa Turnstile", "waNumber", waLocal(),
                "password", "Sandi-Uji-2026", "password-confirm", "Sandi-Uji-2026", "consent", "on"));
        assertTrue(page.text().contains(MSG_TURNSTILE), page.text());
        assertTrue(usersByNikHmac(nik).isEmpty());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Migrated (SIRE) accounts and reset by code
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(20)
    void migratedAccountWithoutPasswordIsToldToUseReset() throws Exception {
        String nik = nik();
        createMigratedUser(nik, waLocal(), null, true);
        Browser.Page page = login(browser(), verifier(), nik, "apa-saja-2026");
        assertTrue(page.text().contains(MSG_NO_PASSWORD), page.text());
    }

    @Test
    @Order(21)
    void resetByWhatsAppCodeCreatesThePasswordOfAMigratedAccount() throws Exception {
        String nik = nik();
        String wa = waLocal();
        String email = "pelamar." + RANDOM.nextInt(1_000_000) + "@example.test";
        String userId = createMigratedUser(nik, wa, email, true);

        Browser browser = browser();
        String verifier = verifier();
        Browser.Page channels = startReset(browser, verifier, nik, false);
        assertTrue(channels.has("#kc-choose-channel-form"), channels.text());
        assertTrue(channels.text().contains(maskWa(wa)), channels.text());
        assertFalse(channels.html().contains(wa.substring(4)), "full number never shown");
        assertFalse(channels.html().contains(email), "full email never shown");

        Browser.Page codePage = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "whatsapp"));
        assertTrue(codePage.has("#kc-otp-code-form"), codePage.text());
        FakeServices.Delivery delivery = keycloak.fakes.lastDeliveryTo(e164(wa)).orElseThrow();
        assertEquals("reset", delivery.purpose());
        assertTrue(delivery.signatureValid());

        Browser.Page wrong = browser.submit(codePage, "#kc-otp-code-form", fields("code", otherCode(delivery.code())));
        assertTrue(wrong.text().contains(MSG_CODE_WRONG), wrong.text());
        Browser.Page update = browser.follow(browser.submit(wrong, "#kc-otp-code-form", fields("code", delivery.code())), keycloak.baseUrl);
        assertTrue(update.has("#kc-passwd-update-form"), update.text());
        Browser.Page done = browser.follow(browser.submit(update, "#kc-passwd-update-form",
                fields("password-new", "Sandi-Baru-2026", "password-confirm", "Sandi-Baru-2026")), keycloak.baseUrl);
        assertTokensCarryNoIdentityData(keycloak.exchangeCode(callbackCode(done), verifier), nik, wa);

        JsonNode user = keycloak.admin("GET", "/admin/realms/sq-karir/users/" + userId, null).json();
        assertEquals("true", attribute(user, "wa_verified"));

        Browser again = browser();
        Browser.Page signedIn = again.follow(login(again, verifier(), nik, "Sandi-Baru-2026"), keycloak.baseUrl);
        assertNotNull(callbackCode(signedIn));
    }

    @Test
    @Order(22)
    void resetByEmailCodeUsesTheRealmSmtp() throws Exception {
        String nik = nik();
        String email = "surel." + RANDOM.nextInt(1_000_000) + "@example.test";
        String userId = createMigratedUser(nik, null, email, true);

        Browser browser = browser();
        String verifier = verifier();
        Browser.Page channels = startReset(browser, verifier, nik, false);
        assertTrue(channels.text().contains(email.charAt(0) + "•••••@example.test"), channels.text());
        Browser.Page codePage = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "email"));
        assertTrue(codePage.has("#kc-otp-code-form"), codePage.text());

        String code = emailCodeFor(email);
        Browser.Page update = browser.follow(browser.submit(codePage, "#kc-otp-code-form", fields("code", code)), keycloak.baseUrl);
        Browser.Page done = browser.follow(browser.submit(update, "#kc-passwd-update-form",
                fields("password-new", "Sandi-Surel-2026", "password-confirm", "Sandi-Surel-2026")), keycloak.baseUrl);
        assertNotNull(keycloak.exchangeCode(callbackCode(done), verifier).path("id_token").asText(null));
        assertTrue(keycloak.admin("GET", "/admin/realms/sq-karir/users/" + userId, null).json().path("emailVerified").asBoolean());
    }

    @Test
    @Order(23)
    void relayFailureOffersEmail() throws Exception {
        String nik = nik();
        String wa = waLocal();
        createMigratedUser(nik, wa, "cadangan." + RANDOM.nextInt(1_000_000) + "@example.test", true);
        Browser browser = browser();
        Browser.Page channels = startReset(browser, verifier(), nik, false);
        keycloak.fakes.relayAnswers(503);
        try {
            Browser.Page page = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "whatsapp"));
            assertTrue(page.text().contains(MSG_NOT_SENT), page.text());
            assertTrue(page.has("#kc-choose-channel-form"), "the email choice is still there");
        } finally {
            keycloak.fakes.relayAnswers(202);
        }
    }

    @Test
    @Order(24)
    void unknownNikResetLooksSentButSendsNothing() throws Exception {
        int before = keycloak.fakes.all().size();
        Browser browser = browser();
        Browser.Page page = startReset(browser, verifier(), nik(), false);
        assertTrue(page.has("#kc-otp-code-form"), page.text());
        assertTrue(page.text().contains(MSG_SENT_GENERIC), page.text());
        assertEquals(before, keycloak.fakes.all().size(), "no code was sent");
        Browser.Page wrong = browser.submit(page, "#kc-otp-code-form", fields("code", "123456"));
        assertTrue(wrong.text().contains(MSG_CODE_WRONG), wrong.text());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Frozen accounts
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(30)
    void frozenAccountGetsTheNeutralMessageAndNoResetCode() throws Exception {
        String nik = nik();
        String wa = waLocal();
        String userId = createMigratedUser(nik, wa, null, true);
        setPassword(userId, "Sandi-Beku-2026");

        // Karir SQ freezes the candidate with the identity-admin service account (PUT {enabled:false}).
        assertEquals(204, keycloak.serviceAccount("PUT", "/admin/realms/sq-karir/users/" + userId, "{\"enabled\":false}").status());

        Browser.Page correct = login(browser(), verifier(), nik, "Sandi-Beku-2026");
        assertTrue(correct.text().contains(MSG_DISABLED), correct.text());
        Browser.Page wrong = login(browser(), verifier(), nik, "salah-sandi-2026");
        assertTrue(wrong.text().contains(MSG_INVALID), wrong.text());

        Browser.Page reset = startReset(browser(), verifier(), nik, false);
        assertTrue(reset.text().contains(MSG_SENT_GENERIC), reset.text());
        assertTrue(keycloak.fakes.deliveriesTo(e164(wa)).isEmpty(), "no code for a frozen account");

        assertEquals(204, keycloak.serviceAccount("PUT", "/admin/realms/sq-karir/users/" + userId, "{\"enabled\":true}").status());
        String verifier = verifier();
        Browser browser = browser();
        assertNotNull(callbackCode(browser.follow(login(browser, verifier, nik, "Sandi-Beku-2026"), keycloak.baseUrl)));
    }

    // ------------------------------------------------------------------------------------------------------------
    // Rate limits
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(40)
    void bruteForceLockKeepsTheGenericMessage() throws Exception {
        String nik = nik();
        String userId = createMigratedUser(nik, waLocal(), null, true);
        setPassword(userId, "Sandi-Kunci-2026");
        for (int i = 0; i < 5; i++) {
            assertTrue(login(browser(), verifier(), nik, "salah-" + i).text().contains(MSG_INVALID));
        }
        Browser.Page locked = login(browser(), verifier(), nik, "Sandi-Kunci-2026");
        assertTrue(locked.text().contains(MSG_INVALID), "locked account looks like a wrong kata sandi: " + locked.text());
        assertTrue(keycloak.admin("GET", "/admin/realms/sq-karir/attack-detection/brute-force/users/" + userId, null)
                .json().path("disabled").asBoolean());
    }

    @Test
    @Order(41)
    void fiveCodesPerAccountPerHour() throws Exception {
        String nik = nik();
        String wa = waLocal();
        createMigratedUser(nik, wa, null, true);
        for (int i = 0; i < 5; i++) {
            Browser browser = browser();
            Browser.Page channels = startReset(browser, verifier(), nik, false);
            Browser.Page page = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "whatsapp"));
            assertTrue(page.has("#kc-otp-code-form"), "code " + (i + 1) + ": " + page.text());
        }
        Browser browser = browser();
        Browser.Page channels = startReset(browser, verifier(), nik, false);
        Browser.Page sixth = browser.submit(channels, "#kc-choose-channel-form", fields("channel", "whatsapp"));
        assertTrue(sixth.text().contains(MSG_TRY_LATER), sixth.text());
        assertEquals(5, keycloak.fakes.deliveriesTo(e164(wa)).size());
    }

    @Test
    @Order(42)
    void resetAsksForTurnstileAfterThreeAttemptsPerIp() throws Exception {
        String ip = nextIp();
        for (int i = 0; i < 3; i++) {
            Browser.Page page = startResetFrom(new Browser(ip), verifier(), nik(), null);
            assertTrue(page.has("#kc-otp-code-form"), page.text());
        }
        Browser browser = new Browser(ip);
        Browser.Page nikPage = resetNikPage(browser, verifier());
        assertTrue(nikPage.has(".cf-turnstile"), "the fourth attempt shows Turnstile");
        Browser.Page refused = browser.submit(nikPage, "#kc-reset-password-form", fields("nik", nik()));
        assertTrue(refused.text().contains(MSG_TURNSTILE), refused.text());
        Browser.Page accepted = browser.submit(refused, "#kc-reset-password-form",
                fields("nik", nik(), "cf-turnstile-response", FakeServices.TURNSTILE_PASS));
        assertTrue(accepted.has("#kc-otp-code-form"), accepted.text());
    }

    @Test
    @Order(43)
    void ipIsBlockedAfterTwentyAttemptsWhenTurnstileFails() throws Exception {
        String ip = nextIp();
        for (int i = 0; i < 20; i++) {
            Browser.Page page = login(new Browser(ip), verifier(), nik(), "acak-" + i);
            assertTrue(page.text().contains(MSG_INVALID), page.text());
        }
        Browser browser = new Browser(ip);
        Browser.Page form = loginPage(browser, verifier());
        assertTrue(form.has(".cf-turnstile"), "Turnstile after 20 attempts");
        Browser.Page blocked = browser.submit(form, "#kc-form-login", fields("nik", nik(), "password", "x"));
        assertTrue(blocked.text().contains(MSG_IP_BLOCKED), blocked.text());
        Browser.Page stillBlocked = browser.submit(blocked, "#kc-form-login",
                fields("nik", nik(), "password", "x", "cf-turnstile-response", FakeServices.TURNSTILE_PASS));
        assertTrue(stillBlocked.text().contains(MSG_IP_BLOCKED), stillBlocked.text());
        Browser.Page otherIp = login(browser(), verifier(), nik(), "acak");
        assertTrue(otherIp.text().contains(MSG_INVALID), otherIp.text());
    }

    // ------------------------------------------------------------------------------------------------------------
    // karir-identity-admin least privilege
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(50)
    void identityAdminServiceAccountCanDoWhatKarirNeedsAndNothingMore() throws Exception {
        String nik = nik();
        String userId = createMigratedUser(nik, waLocal(), "admin.uji@example.test", true);
        String base = "/admin/realms/sq-karir/users/" + userId;

        JsonNode user = keycloak.serviceAccount("GET", base + "?userProfileMetadata=false", null).json();
        assertEquals(hmac(nik), attribute(user, "nik_hmac"));

        // replaceContact: the whole attribute map with a new number and an empty email. With the declarative user
        // profile, a PUT that carries "attributes" must also carry firstName, or Keycloak answers 400 (required).
        JsonNode attributes = user.path("attributes").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) attributes).set("wa_number", JSON.createArrayNode().add(e164(waLocal())));
        ((com.fasterxml.jackson.databind.node.ObjectNode) attributes).set("wa_verified", JSON.createArrayNode().add("false"));
        String withoutName = JSON.writeValueAsString(Map.of("attributes", attributes, "email", "", "emailVerified", false));
        assertEquals(400, keycloak.serviceAccount("PUT", base, withoutName).status());
        String contact = JSON.writeValueAsString(Map.of("firstName", user.path("firstName").asText(),
                "attributes", attributes, "email", "", "emailVerified", false));
        assertEquals(204, keycloak.serviceAccount("PUT", base, contact).status());
        JsonNode updated = keycloak.serviceAccount("GET", base, null).json();
        assertEquals("Pelamar SIRE Sintetis", updated.path("firstName").asText());
        assertTrue(updated.path("email").isMissingNode() || updated.path("email").isNull());
        assertEquals(hmac(nik), attribute(updated, "nik_hmac"));
        assertEquals(204, keycloak.serviceAccount("PUT", base, "{\"enabled\":false}").status());
        assertEquals(204, keycloak.serviceAccount("PUT", base, "{\"enabled\":true}").status());

        assertEquals(403, keycloak.serviceAccount("POST", base + "/impersonation", null).status());
        assertEquals(403, keycloak.serviceAccount("GET", "/admin/realms/sq-karir/clients", null).status());
        assertEquals(403, keycloak.serviceAccount("GET", "/admin/realms/sq-karir/roles", null).status());
        assertEquals(403, keycloak.serviceAccount("PUT", "/admin/realms/sq-karir", "{\"enabled\":false}").status());
        int otherRealm = keycloak.serviceAccount("GET", "/admin/realms/master/users", null).status();
        assertTrue(otherRealm == 401 || otherRealm == 403, "other realm: " + otherRealm);
        JsonNode realmManagement = keycloak.admin("GET", "/admin/realms/sq-karir/clients?clientId=realm-management", null).json().get(0);
        JsonNode realmAdmin = keycloak.admin("GET", "/admin/realms/sq-karir/clients/" + realmManagement.path("id").asText()
                + "/roles/realm-admin", null).json();
        assertEquals(403, keycloak.serviceAccount("POST", base + "/role-mappings/clients/" + realmManagement.path("id").asText(),
                "[" + realmAdmin + "]").status());

        // Keycloak 26.7.2 FGAP v2: "manage" also allows reset-password and no deny can be layered on top (see
        // reconcile-karir-realm.sh §6). Karir SQ never calls it; the realm audits it with an admin event instead.
        keycloak.serviceAccount("PUT", base + "/reset-password",
                "{\"type\":\"password\",\"value\":\"Sandi-Audit-2026\",\"temporary\":false}");
        JsonNode adminEvents = keycloak.admin("GET", "/admin/realms/sq-karir/admin-events?max=200&resourceTypes=USER", null).json();
        boolean audited = false;
        for (JsonNode event : adminEvents) {
            if (("users/" + userId + "/reset-password").equals(event.path("resourcePath").asText())) {
                audited = true;
                assertFalse(event.has("representation") && !event.path("representation").isNull(), "no representation stored");
            }
        }
        assertTrue(audited, "service-account password change is in the admin events");
    }

    // ------------------------------------------------------------------------------------------------------------
    // NIK never leaves the browser form
    // ------------------------------------------------------------------------------------------------------------

    @Test
    @Order(100)
    void nikIsNotInEventsUrlsOrTheServerLog() throws Exception {
        assertFalse(niks.isEmpty());
        JsonNode events = keycloak.admin("GET", "/admin/realms/sq-karir/events?max=5000", null).json();
        assertTrue(events.size() > 0, "login events are stored");
        String eventText = events.toString();
        String log = keycloak.serverLog();
        for (String nik : niks) {
            assertFalse(eventText.contains(nik), "NIK in Keycloak events");
            assertFalse(log.contains(nik), "NIK in the Keycloak log");
            for (Browser.Page page : visited) {
                assertFalse(page.uri().toString().contains(nik), "NIK in a URL");
                assertFalse(page.location() != null && page.location().contains(nik), "NIK in a redirect");
            }
        }
        boolean channelDetail = false;
        for (JsonNode event : events) {
            if ("SEND_RESET_PASSWORD".equals(event.path("type").asText()) && event.path("details").has("channel")) {
                channelDetail = true;
            }
            assertFalse(event.path("details").has("username") && !event.path("details").path("username").asText().startsWith("k_"),
                    "only the opaque k_ username may appear: " + event);
        }
        assertTrue(channelDetail, "code events carry the channel");
        assertFalse(log.contains("NIK-like value"), "the event listener reported an NIK-like value");
    }

    // ------------------------------------------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------------------------------------------

    private Browser browser() {
        return new Browser(nextIp());
    }

    private static String nextIp() {
        int n = IP_COUNTER.incrementAndGet();
        return "10." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255);
    }

    private String nik() {
        String nik;
        do {
            StringBuilder digits = new StringBuilder("32");
            for (int i = 0; i < 14; i++) {
                digits.append(RANDOM.nextInt(10));
            }
            nik = digits.toString();
        } while (nik.chars().distinct().count() == 1);
        niks.add(nik);
        return nik;
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

    private static String otherCode(String code) {
        return code.equals("000000") ? "111111" : "000000";
    }

    private String hmac(String nik) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(keycloak.pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(("nik:v1:" + nik).getBytes(StandardCharsets.UTF_8)));
    }

    private static String verifier() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String authUrl(String verifier, String endpoint) throws Exception {
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        return keycloak.baseUrl + "/realms/sq-karir/protocol/openid-connect/" + endpoint
                + "?client_id=karir-portal&response_type=code&scope=openid"
                + "&redirect_uri=" + KarirKeycloak.encode(keycloak.publicBaseUrl + "/api/auth/callback")
                + "&code_challenge=" + challenge + "&code_challenge_method=S256"
                + "&state=" + verifier.substring(0, 12) + "&nonce=" + verifier.substring(12, 24);
    }

    private Browser.Page track(Browser.Page page) {
        visited.add(page);
        return page;
    }

    private Browser.Page loginPage(Browser browser, String verifier) throws Exception {
        Browser.Page page = track(browser.get(authUrl(verifier, "auth")));
        assertTrue(page.has("#kc-form-login"), page.text());
        assertTrue(page.text().contains("Karir"), "Karir lockup");
        assertFalse(page.text().toLowerCase().contains("password"), "always 'kata sandi', never 'password'");
        return page;
    }

    private Browser.Page login(Browser browser, String verifier, String nik, String password) throws Exception {
        Browser.Page form = loginPage(browser, verifier);
        return track(browser.submit(form, "#kc-form-login", fields("nik", nik, "password", password)));
    }

    private Browser.Page registrationPage(Browser browser, String verifier) throws Exception {
        Browser.Page page = track(browser.get(authUrl(verifier, "registrations")));
        assertTrue(page.has("#kc-register-form"), page.text());
        return page;
    }

    private Browser.Page register(Browser browser, String verifier, String nik, String name, String wa, String password)
            throws Exception {
        Browser.Page form = registrationPage(browser, verifier);
        Browser.Page result = track(browser.submit(form, "#kc-register-form", fields(
                "nik", nik, "firstName", name, "waNumber", wa, "password", password, "password-confirm", password,
                "consent", "on", "cf-turnstile-response", FakeServices.TURNSTILE_PASS)));
        return track(browser.follow(result, keycloak.baseUrl));
    }

    private void registerAndVerify(String nik, String wa, String password) throws Exception {
        Browser browser = browser();
        String verifier = verifier();
        Browser.Page page = register(browser, verifier, nik, "Rina Uji Sintetis", wa, password);
        String code = keycloak.fakes.lastDeliveryTo(e164(wa)).orElseThrow().code();
        Browser.Page done = browser.follow(browser.submit(page, "#kc-otp-code-form", fields("code", code)), keycloak.baseUrl);
        assertNotNull(callbackCode(done));
    }

    private Browser.Page resetNikPage(Browser browser, String verifier) throws Exception {
        Browser.Page login = loginPage(browser, verifier);
        String href = login.document().selectFirst("a[href*=login-actions/reset-credentials]").absUrl("href");
        Browser.Page page = track(browser.get(href));
        assertTrue(page.has("#kc-reset-password-form"), page.text());
        return page;
    }

    private Browser.Page startReset(Browser browser, String verifier, String nik, boolean turnstile) throws Exception {
        return startResetFrom(browser, verifier, nik, turnstile ? FakeServices.TURNSTILE_PASS : null);
    }

    private Browser.Page startResetFrom(Browser browser, String verifier, String nik, String turnstileToken) throws Exception {
        Browser.Page page = resetNikPage(browser, verifier);
        Map<String, String> form = fields("nik", nik);
        if (turnstileToken != null) {
            form.put("cf-turnstile-response", turnstileToken);
        }
        return track(browser.submit(page, "#kc-reset-password-form", form));
    }

    private String callbackCode(Browser.Page page) {
        assertNotNull(page.location(), "expected a redirect to the portal, got: " + page.text());
        URI location = URI.create(page.location());
        assertTrue(page.location().startsWith(keycloak.publicBaseUrl + "/api/auth/callback"), page.location());
        for (String pair : location.getRawQuery().split("&")) {
            if (pair.startsWith("code=")) {
                return java.net.URLDecoder.decode(pair.substring(5), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("no code in " + page.location());
    }

    private void assertTokensCarryNoIdentityData(JsonNode tokens, String nik, String waLocal) throws Exception {
        for (String name : List.of("id_token", "access_token")) {
            String token = tokens.path(name).asText();
            assertFalse(token.isEmpty(), name);
            JsonNode claims = JSON.readTree(Base64.getUrlDecoder().decode(token.split("\\.")[1]));
            String text = claims.toString();
            assertFalse(text.contains(nik), name + " carries the NIK");
            assertFalse(text.contains(e164(waLocal)) || text.contains(waLocal), name + " carries the WhatsApp number");
            for (String claim : List.of("preferred_username", "email", "phone_number", "name", "given_name", "nik", "nik_hmac")) {
                assertFalse(claims.has(claim), name + " has " + claim + ": " + text);
            }
            assertTrue(claims.path("sub").asText().length() > 0, name + " has sub");
        }
    }

    private List<JsonNode> usersByNikHmac(String nik) throws Exception {
        JsonNode users = keycloak.admin("GET", "/admin/realms/sq-karir/users?briefRepresentation=false&q="
                + KarirKeycloak.encode("nik_hmac:" + hmac(nik)), null).json();
        List<JsonNode> list = new ArrayList<>();
        users.forEach(list::add);
        return list;
    }

    private JsonNode userByNikHmac(String nik) throws Exception {
        List<JsonNode> users = usersByNikHmac(nik);
        assertEquals(1, users.size());
        return users.get(0);
    }

    private static String attribute(JsonNode user, String name) {
        JsonNode values = user.path("attributes").path(name);
        return values.isArray() && values.size() > 0 ? values.get(0).asText() : null;
    }

    /** The same request Karir SQ's createMigratedUser sends, with the karir-identity-admin service account. */
    private String createMigratedUser(String nik, String waLocal, String email, boolean enabled) throws Exception {
        StringBuilder username = new StringBuilder("k_");
        for (int i = 0; i < 20; i++) {
            username.append("abcdefghijklmnopqrstuvwxyz234567".charAt(RANDOM.nextInt(32)));
        }
        Map<String, Object> attributes = new java.util.LinkedHashMap<>();
        attributes.put("nik_hmac", List.of(hmac(nik)));
        attributes.put("karir_source", List.of("sire"));
        attributes.put("wa_verified", List.of("false"));
        if (waLocal != null) {
            attributes.put("wa_number", List.of(e164(waLocal)));
        }
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("username", username.toString());
        body.put("enabled", enabled);
        body.put("firstName", "Pelamar SIRE Sintetis");
        if (email != null) {
            body.put("email", email);
            body.put("emailVerified", false);
        }
        body.put("attributes", attributes);
        KarirKeycloak.Response response = keycloak.serviceAccount("POST", "/admin/realms/sq-karir/users", JSON.writeValueAsString(body));
        assertEquals(201, response.status(), response.body());
        String location = response.raw().headers().firstValue("Location").orElseThrow();
        return location.substring(location.lastIndexOf('/') + 1);
    }

    private void setPassword(String userId, String password) throws Exception {
        assertEquals(204, keycloak.admin("PUT", "/admin/realms/sq-karir/users/" + userId + "/reset-password",
                JSON.writeValueAsString(Map.of("type", "password", "value", password, "temporary", false))).status());
    }

    private String emailCodeFor(String email) throws Exception {
        for (int i = 0; i < 50; i++) {
            for (MimeMessage message : keycloak.mail.getReceivedMessages()) {
                if (message.getAllRecipients()[0].toString().equals(email)) {
                    Matcher matcher = EMAIL_CODE.matcher(GreenMailUtil.getBody(message));
                    if (matcher.find()) {
                        return matcher.group(1);
                    }
                }
            }
            Thread.sleep(200);
        }
        throw new AssertionError("no email code for " + email);
    }
}
