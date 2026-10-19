package org.sabilulquran.keycloak.karir;

/** Event error values and details added by the provider. None of them carries an NIK, a code or a contact. */
final class KarirEvents {
    static final String DETAIL_CHANNEL = "channel";
    static final String DETAIL_PURPOSE = "purpose";
    static final String DETAIL_DRY_RUN = "dry_run";

    static final String IP_BLOCKED = "karir_ip_blocked";
    static final String TURNSTILE_FAILED = "karir_turnstile_failed";
    static final String PASSWORD_NOT_SET = "karir_password_not_set";
    static final String NIK_ALREADY_REGISTERED = "karir_nik_already_registered";
    static final String CODE_LIMIT = "karir_code_limit";
    static final String CODE_NOT_SENT = "karir_code_not_sent";
    static final String CODE_INVALID = "karir_code_invalid";
    static final String CODE_EXPIRED = "karir_code_expired";
    static final String WA_INVALID = "karir_wa_invalid";

    private KarirEvents() {
    }
}
