package org.sabilulquran.keycloak.karir;

import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.sessions.AuthenticationSessionModel;

/** Shared parts of the code entry page {@code login-otp-code.ftl}, used by verification and reset. */
final class CodeForms {
    static final String TEMPLATE = "login-otp-code.ftl";
    static final String FIELD_CODE = "code";
    static final String ACTION_RESEND = "resend";
    static final String ACTION_CHANGE_CHANNEL = "changeChannel";

    private CodeForms() {
    }

    static OtpState state(AuthenticationSessionModel authSession, KarirRuntime runtime) {
        return new OtpState(new OtpState.Notes() {
            @Override
            public String get(String name) {
                return authSession.getAuthNote(name);
            }

            @Override
            public void set(String name, String value) {
                authSession.setAuthNote(name, value);
            }

            @Override
            public void remove(String name) {
                authSession.removeAuthNote(name);
            }
        }, runtime.clock());
    }

    static LoginFormsProvider codePage(LoginFormsProvider form, String purpose, String destination, OtpState otp,
                                       boolean canChangeChannel) {
        form.setAttribute("karirOtpPurpose", purpose);
        if (destination != null) {
            form.setAttribute("karirOtpDestination", destination);
        }
        form.setAttribute("karirOtpResendWait", otp.secondsUntilResend());
        form.setAttribute("karirOtpCanChangeChannel", canChangeChannel);
        return form;
    }

    static String messageFor(OtpState.Check check) {
        return switch (check) {
            case WRONG -> KarirForms.CODE_WRONG;
            case TOO_MANY_ATTEMPTS -> KarirForms.CODE_TOO_MANY_ATTEMPTS;
            case EXPIRED, NO_CODE -> KarirForms.CODE_EXPIRED;
            case VALID -> null;
        };
    }
}
