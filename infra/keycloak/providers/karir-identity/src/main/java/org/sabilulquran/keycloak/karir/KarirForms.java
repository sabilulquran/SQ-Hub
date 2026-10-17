package org.sabilulquran.keycloak.karir;

import org.keycloak.common.ClientConnection;
import org.keycloak.forms.login.LoginFormsProvider;

/** Message keys (theme {@code sq-karir} {@code messages_id}) and attributes shared by the Karir forms. */
final class KarirForms {
    static final String FIELD_NIK = "nik";
    static final String FIELD_PASSWORD = "password";

    static final String INVALID_CREDENTIALS = "karirInvalidCredentials";
    static final String ACCOUNT_DISABLED = "karirAccountDisabled";
    static final String NO_PASSWORD = "karirNoPassword";
    static final String NIK_REGISTERED = "karirNikRegistered";
    static final String INVALID_NIK = "karirInvalidNik";
    static final String NAME_REQUIRED = "karirNameRequired";
    static final String INVALID_WA = "karirInvalidWa";
    static final String PASSWORD_REQUIRED = "karirPasswordRequired";
    static final String PASSWORD_MISMATCH = "karirPasswordMismatch";
    static final String CONSENT_REQUIRED = "karirConsentRequired";
    static final String CODE_NOT_SENT = "karirCodeNotSent";
    static final String CODE_NOT_SENT_TRY_LATER = "karirCodeNotSentTryLater";
    static final String CODE_LIMIT = "karirCodeLimit";
    static final String CODE_WRONG = "karirCodeWrong";
    static final String CODE_EXPIRED = "karirCodeExpired";
    static final String CODE_TOO_MANY_ATTEMPTS = "karirCodeTooManyAttempts";
    static final String CODE_RESEND_WAIT = "karirCodeResendWait";
    static final String CODE_SENT = "karirCodeSent";
    static final String CODE_SENT_GENERIC = "karirCodeSentGeneric";
    static final String NO_CONTACT = "karirNoContact";
    static final String CHOOSE_CHANNEL = "karirChooseChannelRequired";
    static final String IP_BLOCKED = "karirIpBlocked";
    static final String TURNSTILE_FAILED = "karirTurnstileFailed";
    static final String SERVICE_UNAVAILABLE = "karirServiceUnavailable";

    private KarirForms() {
    }

    static String clientIp(ClientConnection connection) {
        return connection == null ? null : connection.getRemoteAddr();
    }

    static LoginFormsProvider turnstile(LoginFormsProvider form, KarirConfig config, boolean required) {
        form.setAttribute("karirTurnstileRequired", required);
        if (config.turnstileSiteKey() != null) {
            form.setAttribute("karirTurnstileSiteKey", config.turnstileSiteKey());
        }
        return form;
    }

    /**
     * Applies the per-IP rules for one submit of a NIK form. Returns the message key to show, or {@code null} when
     * the submit may continue.
     */
    static String checkAbuse(KarirRuntime runtime, AbuseGuard.NikForm form, String ip, String turnstileToken) {
        AbuseGuard guard = runtime.abuseGuard();
        if (guard.isBlocked(ip)) {
            return IP_BLOCKED;
        }
        boolean turnstileRequired = guard.turnstileRequired(form, ip);
        guard.recordAttempt(ip);
        if (turnstileRequired && !runtime.turnstile().verify(turnstileToken, ip)) {
            guard.turnstileFailed(ip);
            return guard.isBlocked(ip) ? IP_BLOCKED : TURNSTILE_FAILED;
        }
        return null;
    }
}
