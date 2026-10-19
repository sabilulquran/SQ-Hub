package org.sabilulquran.keycloak.karir;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.keycloak.models.UserModel;

/**
 * What differs between the external realms that use this provider (ADR-0008, ADR-0010; KEL-IMPL-001 §4.5).
 * The profile is chosen from the realm name; every other realm gets no profile and fails closed.
 *
 * <ul>
 *   <li>{@link #KARIR}: realm {@code sq-karir}, login by NIK, one WhatsApp number with {@code wa_verified=true|false}.
 *   Behaviour is unchanged from REC-IMPL-001.</li>
 *   <li>{@link #KELUARGA}: realm {@code sq-keluarga}, login by nomor KK, several WhatsApp numbers in
 *   {@code wa_numbers}; {@code wa_verified} lists the numbers that passed a code.</li>
 * </ul>
 */
public enum IdentityProfile {
    KARIR("sq-karir", "SQ_KARIR_", "NIK_PEPPER", "nik:v1:", "nik", "nik_hmac",
            "wa_number", false, "karir_source", "k_",
            URI.create("http://127.0.0.1:3304/internal/otp-deliveries"), "X-Karir", "Karir"),
    KELUARGA("sq-keluarga", "SQ_KELUARGA_", "KK_PEPPER", "kk:v1:", "kk", "kk_hmac",
            "wa_numbers", true, "keluarga_source", "f_",
            URI.create("http://127.0.0.1:3306/internal/otp-deliveries"), "X-Keluarga", "Keluarga");

    public static final String WA_VERIFIED = "wa_verified";
    public static final String SOURCE_SELF = "self";
    /** Event detail with the HMAC of the WhatsApp number a code went to (KEL-IMPL-001 §4.5); never the number. */
    public static final String DETAIL_WA_HASH = "wa_hash";

    private final String realmName;
    private final String envPrefix;
    private final String pepperVariable;
    private final String hmacPrefix;
    private final String formField;
    private final String identifierAttribute;
    private final String waAttribute;
    private final boolean multipleNumbers;
    private final String sourceAttribute;
    private final String usernamePrefix;
    private final URI defaultRelayUrl;
    private final String relayHeaderPrefix;
    private final String appName;

    IdentityProfile(String realmName, String envPrefix, String pepperVariable, String hmacPrefix, String formField,
                    String identifierAttribute, String waAttribute, boolean multipleNumbers, String sourceAttribute,
                    String usernamePrefix, URI defaultRelayUrl, String relayHeaderPrefix, String appName) {
        this.realmName = realmName;
        this.envPrefix = envPrefix;
        this.pepperVariable = pepperVariable;
        this.hmacPrefix = hmacPrefix;
        this.formField = formField;
        this.identifierAttribute = identifierAttribute;
        this.waAttribute = waAttribute;
        this.multipleNumbers = multipleNumbers;
        this.sourceAttribute = sourceAttribute;
        this.usernamePrefix = usernamePrefix;
        this.defaultRelayUrl = defaultRelayUrl;
        this.relayHeaderPrefix = relayHeaderPrefix;
        this.appName = appName;
    }

    /** The profile for a realm name, or {@code null} when this provider must not serve the realm. */
    public static IdentityProfile forRealm(String realmName) {
        for (IdentityProfile profile : values()) {
            if (profile.realmName.equals(realmName)) {
                return profile;
            }
        }
        return null;
    }

    public String realmName() {
        return realmName;
    }

    public String envPrefix() {
        return envPrefix;
    }

    /** Full name of the pepper variable, e.g. {@code SQ_KARIR_NIK_PEPPER} or {@code SQ_KELUARGA_KK_PEPPER}. */
    public String pepperVariable() {
        return envPrefix + pepperVariable;
    }

    /** Name of the identifier field in the sign-in, registration and reset forms. */
    public String formField() {
        return formField;
    }

    public String identifierAttribute() {
        return identifierAttribute;
    }

    public String waAttribute() {
        return waAttribute;
    }

    public boolean multipleNumbers() {
        return multipleNumbers;
    }

    public String sourceAttribute() {
        return sourceAttribute;
    }

    public String usernamePrefix() {
        return usernamePrefix;
    }

    public URI defaultRelayUrl() {
        return defaultRelayUrl;
    }

    public String relayHeaderPrefix() {
        return relayHeaderPrefix;
    }

    public String emailSubject() {
        return "Kode Akun SQ " + appName;
    }

    public String emailText(String code) {
        return "Kode Akun SQ " + appName + " Anda: " + code + ". Jangan berikan kode ini kepada siapa pun. Kode berlaku 10 menit.";
    }

    /** The 16-digit identifier (NIK or nomor KK), or {@code null}. Both use the same national number rules. */
    public String normalize(String input) {
        return Nik.normalize(input);
    }

    /** HMAC-SHA256 of the normalised identifier with this realm's domain prefix, lowercase hex. */
    public String hmac(String pepper, String normalizedIdentifier) {
        return hmacHex(pepper, hmacPrefix + normalizedIdentifier);
    }

    /** HMAC of a WhatsApp number for events: {@code "wa:v1:+628…"}, the same as Keluarga SQ {@code wa_hmac}. */
    public static String waHash(String pepper, String waDigits) {
        return hmacHex(pepper, "wa:v1:+" + waDigits);
    }

    /** Stored WhatsApp numbers, normalised to {@code 628…} digits, in stored order, without duplicates. */
    public List<String> waNumbers(UserModel user) {
        Set<String> numbers = new LinkedHashSet<>();
        if (multipleNumbers) {
            user.getAttributeStream(waAttribute).map(Contact::normalizeWaNumber)
                    .filter(java.util.Objects::nonNull).forEach(numbers::add);
        } else {
            String value = user.getFirstAttribute(waAttribute);
            String normalized = value == null ? null : Contact.normalizeWaNumber(value);
            if (normalized != null) {
                numbers.add(normalized);
            }
        }
        return List.copyOf(numbers);
    }

    public boolean isVerified(UserModel user, String waDigits) {
        if (!multipleNumbers) {
            return "true".equals(user.getFirstAttribute(WA_VERIFIED));
        }
        return user.getAttributeStream(WA_VERIFIED).map(Contact::normalizeWaNumber)
                .anyMatch(waDigits::equals);
    }

    public void markVerified(UserModel user, String waDigits) {
        if (!multipleNumbers) {
            user.setSingleAttribute(WA_VERIFIED, "true");
            return;
        }
        List<String> verified = new ArrayList<>(user.getAttributeStream(WA_VERIFIED).toList());
        if (verified.stream().map(Contact::normalizeWaNumber).noneMatch(waDigits::equals)) {
            verified.add(waDigits);
            user.setAttribute(WA_VERIFIED, verified);
        }
    }

    /** Contact attributes of a newly registered account: the one number, not yet verified. */
    public void setRegisteredContact(UserModel user, String waDigits) {
        if (multipleNumbers) {
            user.setAttribute(waAttribute, List.of(waDigits));
            user.removeAttribute(WA_VERIFIED);
        } else {
            user.setSingleAttribute(waAttribute, waDigits);
            user.setSingleAttribute(WA_VERIFIED, "false");
        }
    }

    /** The first stored number that has not passed a code yet, or {@code null}. */
    public String numberToVerify(UserModel user) {
        for (String number : waNumbers(user)) {
            if (!isVerified(user, number)) {
                return number;
            }
        }
        return null;
    }

    /**
     * Whether the sign-in verify screen may offer "Ganti nomor". Keluarga SQ keeps several numbers, so a family that
     * typed the wrong one corrects it themselves (KEL-IMPL-001 §4.5). Karir SQ keeps the one contact of the account
     * and changes it in Karir SQ, not here.
     */
    public boolean allowsNumberChangeAtVerify() {
        return multipleNumbers;
    }

    /**
     * Replaces one not-yet-verified number with another, keeping the other numbers and their order, and without
     * adding a duplicate. Verified numbers are never touched, because only an unverified number is offered here.
     */
    public void replaceNumber(UserModel user, String oldDigits, String newDigits) {
        List<String> numbers = new ArrayList<>();
        for (String number : waNumbers(user)) {
            String kept = number.equals(oldDigits) ? newDigits : number;
            if (!numbers.contains(kept)) {
                numbers.add(kept);
            }
        }
        if (!numbers.contains(newDigits)) {
            numbers.add(newDigits);
        }
        if (multipleNumbers) {
            user.setAttribute(waAttribute, numbers);
        } else {
            user.setSingleAttribute(waAttribute, numbers.get(0));
        }
    }

    /**
     * Numbers offered on the "Lupa kata sandi" channel page. Karir: its one number. Keluarga: the verified numbers;
     * when none is verified yet (migrated family), the numbers on record (ADR-0010 decision).
     */
    public List<String> resetNumbers(UserModel user) {
        List<String> all = waNumbers(user);
        if (!multipleNumbers) {
            return all;
        }
        List<String> verified = all.stream().filter(number -> isVerified(user, number)).toList();
        return verified.isEmpty() ? all : verified;
    }

    private static String hmacHex(String pepper, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HmacSHA256 is unavailable", failure);
        }
    }
}
