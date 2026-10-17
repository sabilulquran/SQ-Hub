package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.events.Errors;
import org.keycloak.events.EventBuilder;
import org.keycloak.events.EventType;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * "Lupa kata sandi" by one-time code (REC-IMPL-001 §4.3): NIK + Turnstile, then the masked WhatsApp number and/or
 * email, then the code. After a valid code the built-in {@code reset-password} step asks for the new kata sandi.
 *
 * <p>An unknown or disabled NIK continues to a code page that says a code was sent if the NIK is registered; nothing
 * is sent and no code is ever accepted.
 */
final class ResetByCodeAuthenticator implements Authenticator {
    static final String TEMPLATE_NIK = "login-reset-password.ftl";
    static final String TEMPLATE_CHANNEL = "login-choose-channel.ftl";
    static final String FIELD_CHANNEL = "channel";
    static final String CHANNEL_WHATSAPP = "whatsapp";
    static final String CHANNEL_EMAIL = "email";
    static final String PURPOSE = "reset";

    private static final String NOTE_STEP = "karir.reset.step";
    private static final String NOTE_USER = "karir.reset.user";
    private static final String NOTE_NIK_HMAC = "karir.reset.nikHmac";
    private static final String NOTE_DECOY = "karir.reset.decoy";
    private static final String STEP_CHANNEL = "channel";
    private static final String STEP_CODE = "code";
    private static final Logger LOG = Logger.getLogger(ResetByCodeAuthenticator.class);

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        clearState(context);
        context.challenge(nikPage(context, null));
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        String step = context.getAuthenticationSession().getAuthNote(NOTE_STEP);
        if (STEP_CHANNEL.equals(step)) {
            chooseChannel(context);
        } else if (STEP_CODE.equals(step)) {
            enterCode(context);
        } else {
            enterNik(context);
        }
    }

    private void enterNik(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.get();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        String ip = KarirForms.clientIp(context.getConnection());
        String abuse = KarirForms.checkAbuse(runtime, AbuseGuard.NikForm.RESET, ip, input.getFirst(TurnstileVerifier.FORM_FIELD));
        if (abuse != null) {
            context.getEvent().error(KarirForms.IP_BLOCKED.equals(abuse) ? KarirEvents.IP_BLOCKED : KarirEvents.TURNSTILE_FAILED);
            context.forceChallenge(nikPage(context, abuse));
            return;
        }
        if (!runtime.config().nikLookupAvailable()) {
            LOG.warn("SQ_KARIR_NIK_PEPPER is not configured; candidate password reset is unavailable");
            context.getEvent().error(Errors.INVALID_CONFIG);
            context.forceChallenge(nikPage(context, KarirForms.SERVICE_UNAVAILABLE));
            return;
        }
        String nik = Nik.normalize(input.getFirst(KarirForms.FIELD_NIK));
        if (nik == null) {
            context.forceChallenge(nikPage(context, KarirForms.INVALID_NIK));
            return;
        }

        String nikHmac = Nik.hmac(runtime.config().nikPepper(), nik);
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        authSession.setAuthNote(NOTE_NIK_HMAC, nikHmac);
        UserModel user = Candidates.findByNikHmac(context.getSession(), context.getRealm(), nikHmac);
        if (user == null || !user.isEnabled()) {
            startDecoy(context, runtime, user);
            return;
        }
        if (Candidates.waNumber(user) == null && user.getEmail() == null) {
            context.getEvent().user(user).error(KarirEvents.CODE_NOT_SENT);
            context.forceChallenge(nikPage(context, KarirForms.NO_CONTACT));
            return;
        }
        authSession.setAuthNote(NOTE_USER, user.getId());
        authSession.setAuthNote(NOTE_STEP, STEP_CHANNEL);
        context.challenge(channelPage(context, user, null));
    }

    private void chooseChannel(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.get();
        UserModel user = currentUser(context);
        if (user == null) {
            startDecoy(context, runtime, null);
            return;
        }
        String channel = context.getHttpRequest().getDecodedFormParameters().getFirst(FIELD_CHANNEL);
        if (!availableChannels(user).containsKey(channel)) {
            context.challenge(channelPage(context, user, KarirForms.CHOOSE_CHANNEL));
            return;
        }
        String failure = send(context, runtime, user, channel);
        if (failure != null) {
            context.challenge(channelPage(context, user, failure));
            return;
        }
        context.getAuthenticationSession().setAuthNote(NOTE_STEP, STEP_CODE);
        context.challenge(codePage(context, runtime, user, KarirForms.CODE_SENT, true));
    }

    private void enterCode(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.get();
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        OtpState otp = CodeForms.state(authSession, runtime);
        boolean decoy = "true".equals(authSession.getAuthNote(NOTE_DECOY));
        UserModel user = decoy ? null : currentUser(context);
        if (!decoy && user == null) {
            startDecoy(context, runtime, null);
            return;
        }

        if (!decoy && input.containsKey(CodeForms.ACTION_CHANGE_CHANNEL)) {
            authSession.setAuthNote(NOTE_STEP, STEP_CHANNEL);
            context.challenge(channelPage(context, user, null));
            return;
        }
        if (input.containsKey(CodeForms.ACTION_RESEND)) {
            long wait = otp.secondsUntilResend();
            if (wait > 0) {
                context.challenge(codePage(context, runtime, user, null, false,
                        new FormMessage(CodeForms.FIELD_CODE, KarirForms.CODE_RESEND_WAIT, wait)));
                return;
            }
            if (decoy) {
                String nikHmac = authSession.getAuthNote(NOTE_NIK_HMAC);
                if (!runtime.abuseGuard().tryCodeRequest(nikHmac)) {
                    context.challenge(codePage(context, runtime, null, KarirForms.CODE_LIMIT, false));
                    return;
                }
                otp.issue("none");
                context.challenge(codePage(context, runtime, null, KarirForms.CODE_SENT_GENERIC, true));
                return;
            }
            String failure = send(context, runtime, user, otp.channel());
            if (failure != null) {
                context.challenge(codePage(context, runtime, user, failure, false));
                return;
            }
            context.challenge(codePage(context, runtime, user, KarirForms.CODE_SENT, true));
            return;
        }

        String channel = otp.channel();
        OtpState.Check check = otp.verify(input.getFirst(CodeForms.FIELD_CODE));
        if (decoy && check == OtpState.Check.VALID) {
            check = OtpState.Check.WRONG;
        }
        if (check != OtpState.Check.VALID) {
            EventBuilder event = context.getEvent().detail(KarirEvents.DETAIL_CHANNEL, decoy ? "none" : channel);
            if (user != null) {
                event.user(user);
            }
            event.error(check == OtpState.Check.EXPIRED || check == OtpState.Check.NO_CODE
                    ? KarirEvents.CODE_EXPIRED : KarirEvents.CODE_INVALID);
            context.challenge(codePage(context, runtime, user, CodeForms.messageFor(check), false));
            return;
        }

        if (CHANNEL_WHATSAPP.equals(channel)) {
            user.setSingleAttribute(Candidates.WA_VERIFIED, "true");
        } else if (CHANNEL_EMAIL.equals(channel)) {
            user.setEmailVerified(true);
        }
        clearState(context);
        context.getEvent().user(user).detail(KarirEvents.DETAIL_CHANNEL, channel);
        context.setUser(user);
        context.success();
    }

    /** Unknown or disabled NIK: show the "code sent" page, send nothing, accept no code. */
    private void startDecoy(AuthenticationFlowContext context, KarirRuntime runtime, UserModel disabledUser) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        EventBuilder event = context.getEvent().clone().event(EventType.SEND_RESET_PASSWORD);
        if (disabledUser != null) {
            event.user(disabledUser).error(Errors.USER_DISABLED);
        } else {
            event.error(Errors.USER_NOT_FOUND);
        }
        authSession.removeAuthNote(NOTE_USER);
        authSession.setAuthNote(NOTE_DECOY, "true");
        authSession.setAuthNote(NOTE_STEP, STEP_CODE);
        String nikHmac = authSession.getAuthNote(NOTE_NIK_HMAC);
        OtpState otp = CodeForms.state(authSession, runtime);
        if (nikHmac != null && !runtime.abuseGuard().tryCodeRequest(nikHmac)) {
            context.challenge(codePage(context, runtime, null, KarirForms.CODE_LIMIT, false));
            return;
        }
        otp.issue("none");
        context.challenge(codePage(context, runtime, null, KarirForms.CODE_SENT_GENERIC, true));
    }

    /** Sends a code on the channel; returns a message key on failure, {@code null} when sent. */
    private String send(AuthenticationFlowContext context, KarirRuntime runtime, UserModel user, String channel) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        EventBuilder event = context.getEvent().clone()
                .event(EventType.SEND_RESET_PASSWORD)
                .user(user)
                .detail(KarirEvents.DETAIL_CHANNEL, channel);
        if (!runtime.abuseGuard().tryCodeRequest(authSession.getAuthNote(NOTE_NIK_HMAC))) {
            event.error(KarirEvents.CODE_LIMIT);
            return KarirForms.CODE_LIMIT;
        }
        OtpState otp = CodeForms.state(authSession, runtime);
        String code = otp.issue(channel);
        OtpDeliveryClient.Result result = CHANNEL_WHATSAPP.equals(channel)
                ? runtime.delivery().sendWhatsApp(Candidates.waNumber(user), code, OtpDeliveryClient.Purpose.RESET)
                : runtime.delivery().sendEmail(context.getSession(), context.getRealm(), user, code);
        if (result != OtpDeliveryClient.Result.SENT) {
            otp.clear();
            event.error(KarirEvents.CODE_NOT_SENT);
            return CHANNEL_WHATSAPP.equals(channel) && user.getEmail() != null
                    ? KarirForms.CODE_NOT_SENT : KarirForms.CODE_NOT_SENT_TRY_LATER;
        }
        event.success();
        return null;
    }

    private UserModel currentUser(AuthenticationFlowContext context) {
        String id = context.getAuthenticationSession().getAuthNote(NOTE_USER);
        UserModel user = id == null ? null : context.getSession().users().getUserById(context.getRealm(), id);
        return user != null && user.isEnabled() ? user : null;
    }

    private static Map<String, String> availableChannels(UserModel user) {
        Map<String, String> channels = new LinkedHashMap<>();
        String wa = Candidates.waNumber(user);
        if (wa != null) {
            channels.put(CHANNEL_WHATSAPP, Contact.maskWaNumber(wa));
        }
        if (user.getEmail() != null) {
            channels.put(CHANNEL_EMAIL, Contact.maskEmail(user.getEmail()));
        }
        return channels;
    }

    private static String destination(UserModel user, String channel) {
        return user == null || channel == null ? null : availableChannels(user).get(channel);
    }

    private Response nikPage(AuthenticationFlowContext context, String error) {
        KarirRuntime runtime = KarirRuntime.get();
        LoginFormsProvider form = context.form();
        KarirForms.turnstile(form, runtime.config(), runtime.abuseGuard()
                .turnstileRequired(AbuseGuard.NikForm.RESET, KarirForms.clientIp(context.getConnection())));
        if (error != null) {
            form.addError(new FormMessage(KarirForms.FIELD_NIK, error));
        }
        return form.createForm(TEMPLATE_NIK);
    }

    private Response channelPage(AuthenticationFlowContext context, UserModel user, String error) {
        LoginFormsProvider form = context.form();
        List<Map<String, String>> options = new ArrayList<>();
        availableChannels(user).forEach((id, masked) -> options.add(Map.of("id", id, "destination", masked)));
        form.setAttribute("karirChannels", options);
        if (error != null) {
            form.addError(new FormMessage(FIELD_CHANNEL, error));
        }
        return form.createForm(TEMPLATE_CHANNEL);
    }

    private Response codePage(AuthenticationFlowContext context, KarirRuntime runtime, UserModel user, String message,
                              boolean success, FormMessage... extraErrors) {
        OtpState otp = CodeForms.state(context.getAuthenticationSession(), runtime);
        String destination = destination(user, otp.channel());
        LoginFormsProvider form = context.form();
        if (message != null) {
            if (success) {
                form.setSuccess(message, destination == null ? "" : destination);
            } else {
                form.addError(new FormMessage(CodeForms.FIELD_CODE, message));
            }
        }
        for (FormMessage extra : extraErrors) {
            form.addError(extra);
        }
        return CodeForms.codePage(form, PURPOSE, destination, otp, user != null).createForm(CodeForms.TEMPLATE);
    }

    private static void clearState(AuthenticationFlowContext context) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        authSession.removeAuthNote(NOTE_STEP);
        authSession.removeAuthNote(NOTE_USER);
        authSession.removeAuthNote(NOTE_NIK_HMAC);
        authSession.removeAuthNote(NOTE_DECOY);
        CodeForms.state(authSession, KarirRuntime.get()).clear();
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }
}
