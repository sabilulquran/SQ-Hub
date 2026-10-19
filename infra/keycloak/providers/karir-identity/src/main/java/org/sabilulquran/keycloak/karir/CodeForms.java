package org.sabilulquran.keycloak.karir;

import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.sessions.AuthenticationSessionModel;

/** Shared parts of the code entry page {@code login-otp-code.ftl}, used by verification and reset. */
final class CodeForms {
    static final String TEMPLATE = "login-otp-code.ftl";
    static final String FIELD_CODE = "code";
    static final String FIELD_WA = "wa";
    static final String ACTION_RESEND = "resend";
    static final String ACTION_CHANGE_CHANNEL = "changeChannel";
    static final String ACTION_CHANGE_NUMBER = "changeNumber";

    /** Remembers that the last code went nowhere, so the page keeps saying so while the family stays on it. */
    private static final String NOTE_DRY_RUN = "karir.otp.dryRun";

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

    static void setDryRun(AuthenticationSessionModel authSession, boolean dryRun) {
        if (dryRun) {
            authSession.setAuthNote(NOTE_DRY_RUN, "true");
        } else {
            authSession.removeAuthNote(NOTE_DRY_RUN);
        }
    }

    static boolean dryRun(AuthenticationSessionModel authSession) {
        return "true".equals(authSession.getAuthNote(NOTE_DRY_RUN));
    }

    /**
     * Says plainly that the relay ran in dry run, so the page never claims a code was sent while the app runs with
     * the {@code log} WhatsApp adapter.
     */
    static LoginFormsProvider dryRunNotice(LoginFormsProvider form, boolean dryRun) {
        form.setAttribute("karirOtpDryRun", dryRun);
        if (dryRun) {
            form.addError(new FormMessage(FormMessage.GLOBAL, KarirForms.CODE_DRY_RUN));
        }
        return form;
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
