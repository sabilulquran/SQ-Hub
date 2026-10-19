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
 * "Lupa kata sandi" by one-time code (REC-IMPL-001 §4.3, KEL-IMPL-001 §4.3): NIK or nomor KK + Turnstile, then the
 * masked WhatsApp number(s) and/or email, then the code. After a valid code the built-in {@code reset-password} step
 * asks for the new kata sandi.
 *
 * <p>Channel ids are {@code whatsapp} for the first number, {@code whatsapp-2}, {@code whatsapp-3} … for more numbers
 * ({@code sq-keluarga} only) and {@code email}. The number behind an id is looked up again from the account on every
 * send, so a number removed in the meantime is never used.
 *
 * <p>An unknown or disabled identifier continues to a code page that says a code was sent if the account exists;
 * nothing is sent and no code is ever accepted.
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

    /** One choice on the channel page. {@code waDigits} is set for WhatsApp and never leaves the server. */
    record Channel(String kind, String destination, String waDigits) {
    }

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
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        IdentityProfile profile = runtime.profile();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        String ip = KarirForms.clientIp(context.getConnection());
        String abuse = KarirForms.checkAbuse(runtime, AbuseGuard.NikForm.RESET, ip, input.getFirst(TurnstileVerifier.FORM_FIELD));
        if (abuse != null) {
            context.getEvent().error(KarirForms.IP_BLOCKED.equals(abuse) ? KarirEvents.IP_BLOCKED : KarirEvents.TURNSTILE_FAILED);
            context.forceChallenge(nikPage(context, abuse));
            return;
        }
        if (!runtime.config().nikLookupAvailable()) {
            LOG.warnf("%s is not configured; password reset in realm %s is unavailable",
                    profile.pepperVariable(), context.getRealm().getName());
            context.getEvent().error(Errors.INVALID_CONFIG);
            context.forceChallenge(nikPage(context, KarirForms.SERVICE_UNAVAILABLE));
            return;
        }
        String identifier = profile.normalize(input.getFirst(profile.formField()));
        if (identifier == null) {
            context.forceChallenge(nikPage(context, KarirForms.INVALID_NIK));
            return;
        }

        String identifierHmac = profile.hmac(runtime.config().nikPepper(), identifier);
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        authSession.setAuthNote(NOTE_NIK_HMAC, identifierHmac);
        UserModel user = Candidates.findByIdentifierHmac(context.getSession(), context.getRealm(), profile, identifierHmac);
        if (user == null || !user.isEnabled()) {
            startDecoy(context, runtime, user);
            return;
        }
        if (availableChannels(profile, user).isEmpty()) {
            context.getEvent().user(user).error(KarirEvents.CODE_NOT_SENT);
            context.forceChallenge(nikPage(context, KarirForms.NO_CONTACT));
            return;
        }
        authSession.setAuthNote(NOTE_USER, user.getId());
        authSession.setAuthNote(NOTE_STEP, STEP_CHANNEL);
        context.challenge(channelPage(context, runtime, user, null));
    }

    private void chooseChannel(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        UserModel user = currentUser(context);
        if (user == null) {
            startDecoy(context, runtime, null);
            return;
        }
        String channel = context.getHttpRequest().getDecodedFormParameters().getFirst(FIELD_CHANNEL);
        if (channel == null || !availableChannels(runtime.profile(), user).containsKey(channel)) {
            context.challenge(channelPage(context, runtime, user, KarirForms.CHOOSE_CHANNEL));
            return;
        }
        String failure = send(context, runtime, user, channel);
        if (failure != null) {
            context.challenge(channelPage(context, runtime, user, failure));
            return;
        }
        context.getAuthenticationSession().setAuthNote(NOTE_STEP, STEP_CODE);
        context.challenge(codePage(context, runtime, user, KarirForms.CODE_SENT, true));
    }

    private void enterCode(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        IdentityProfile profile = runtime.profile();
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
            context.challenge(channelPage(context, runtime, user, null));
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

        String channelId = otp.channel();
        OtpState.Check check = otp.verify(input.getFirst(CodeForms.FIELD_CODE));
        if (decoy && check == OtpState.Check.VALID) {
            check = OtpState.Check.WRONG;
        }
        if (check != OtpState.Check.VALID) {
            EventBuilder event = context.getEvent().detail(KarirEvents.DETAIL_CHANNEL, decoy ? "none" : kind(channelId));
            if (user != null) {
                event.user(user);
            }
            event.error(check == OtpState.Check.EXPIRED || check == OtpState.Check.NO_CODE
                    ? KarirEvents.CODE_EXPIRED : KarirEvents.CODE_INVALID);
            context.challenge(codePage(context, runtime, user, CodeForms.messageFor(check), false));
            return;
        }

        Channel channel = availableChannels(profile, user).get(channelId);
        EventBuilder event = context.getEvent().user(user).detail(KarirEvents.DETAIL_CHANNEL, kind(channelId));
        if (channel != null && channel.waDigits() != null) {
            profile.markVerified(user, channel.waDigits());
            addWaHash(event, runtime, channel.waDigits());
        } else if (CHANNEL_EMAIL.equals(channelId)) {
            user.setEmailVerified(true);
        }
        clearState(context);
        context.setUser(user);
        context.success();
    }

    /** Unknown or disabled identifier: show the "code sent" page, send nothing, accept no code. */
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
    private String send(AuthenticationFlowContext context, KarirRuntime runtime, UserModel user, String channelId) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        Channel channel = availableChannels(runtime.profile(), user).get(channelId);
        EventBuilder event = context.getEvent().clone()
                .event(EventType.SEND_RESET_PASSWORD)
                .user(user)
                .detail(KarirEvents.DETAIL_CHANNEL, kind(channelId));
        if (channel == null) {
            // The number behind this id was removed since the page was shown.
            event.error(KarirEvents.CODE_NOT_SENT);
            return KarirForms.CHOOSE_CHANNEL;
        }
        if (channel.waDigits() != null) {
            addWaHash(event, runtime, channel.waDigits());
        }
        if (!runtime.abuseGuard().tryCodeRequest(authSession.getAuthNote(NOTE_NIK_HMAC))) {
            event.error(KarirEvents.CODE_LIMIT);
            return KarirForms.CODE_LIMIT;
        }
        OtpState otp = CodeForms.state(authSession, runtime);
        String code = otp.issue(channelId);
        OtpDeliveryClient.Result result = channel.waDigits() != null
                ? runtime.delivery().sendWhatsApp(channel.waDigits(), code, OtpDeliveryClient.Purpose.RESET)
                : runtime.delivery().sendEmail(context.getSession(), context.getRealm(), user, code);
        if (!result.accepted()) {
            otp.clear();
            CodeForms.setDryRun(authSession, false);
            event.error(KarirEvents.CODE_NOT_SENT);
            return channel.waDigits() != null && user.getEmail() != null
                    ? KarirForms.CODE_NOT_SENT : KarirForms.CODE_NOT_SENT_TRY_LATER;
        }
        boolean dryRun = result == OtpDeliveryClient.Result.SENT_DRY_RUN;
        CodeForms.setDryRun(authSession, dryRun);
        if (dryRun) {
            event.detail(KarirEvents.DETAIL_DRY_RUN, "true");
        }
        event.success();
        return null;
    }

    /**
     * Adds the {@code wa_hash} detail in realms with several numbers, so Keluarga SQ can tell which parent's number
     * received the code. Karir events are unchanged.
     */
    static void addWaHash(EventBuilder event, KarirRuntime runtime, String waDigits) {
        if (runtime.profile().multipleNumbers() && runtime.config().nikPepper() != null && waDigits != null) {
            event.detail(IdentityProfile.DETAIL_WA_HASH, IdentityProfile.waHash(runtime.config().nikPepper(), waDigits));
        }
    }

    private UserModel currentUser(AuthenticationFlowContext context) {
        String id = context.getAuthenticationSession().getAuthNote(NOTE_USER);
        UserModel user = id == null ? null : context.getSession().users().getUserById(context.getRealm(), id);
        return user != null && user.isEnabled() ? user : null;
    }

    /** Channel id → channel, in display order. */
    static Map<String, Channel> availableChannels(IdentityProfile profile, UserModel user) {
        Map<String, Channel> channels = new LinkedHashMap<>();
        List<String> numbers = profile.resetNumbers(user);
        for (int index = 0; index < numbers.size(); index++) {
            String id = index == 0 ? CHANNEL_WHATSAPP : CHANNEL_WHATSAPP + "-" + (index + 1);
            channels.put(id, new Channel(CHANNEL_WHATSAPP, Contact.maskWaNumber(numbers.get(index)), numbers.get(index)));
        }
        if (user.getEmail() != null) {
            channels.put(CHANNEL_EMAIL, new Channel(CHANNEL_EMAIL, Contact.maskEmail(user.getEmail()), null));
        }
        return channels;
    }

    /** {@code whatsapp-2} → {@code whatsapp}; used for event details so they keep the REC-IMPL-001 values. */
    static String kind(String channelId) {
        return channelId != null && channelId.startsWith(CHANNEL_WHATSAPP) ? CHANNEL_WHATSAPP : channelId;
    }

    private static String destination(IdentityProfile profile, UserModel user, String channelId) {
        if (user == null || channelId == null) {
            return null;
        }
        Channel channel = availableChannels(profile, user).get(channelId);
        return channel == null ? null : channel.destination();
    }

    private Response nikPage(AuthenticationFlowContext context, String error) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        LoginFormsProvider form = context.form();
        KarirForms.turnstile(form, runtime.config(), runtime.abuseGuard()
                .turnstileRequired(AbuseGuard.NikForm.RESET, KarirForms.clientIp(context.getConnection())));
        if (error != null) {
            form.addError(new FormMessage(runtime.profile().formField(), error));
        }
        return form.createForm(TEMPLATE_NIK);
    }

    private Response channelPage(AuthenticationFlowContext context, KarirRuntime runtime, UserModel user, String error) {
        LoginFormsProvider form = context.form();
        List<Map<String, String>> options = new ArrayList<>();
        availableChannels(runtime.profile(), user).forEach((id, channel) ->
                options.add(Map.of("id", id, "kind", channel.kind(), "destination", channel.destination())));
        form.setAttribute("karirChannels", options);
        if (error != null) {
            form.addError(new FormMessage(FIELD_CHANNEL, error));
        }
        return form.createForm(TEMPLATE_CHANNEL);
    }

    private Response codePage(AuthenticationFlowContext context, KarirRuntime runtime, UserModel user, String message,
                              boolean success, FormMessage... extraErrors) {
        OtpState otp = CodeForms.state(context.getAuthenticationSession(), runtime);
        String destination = destination(runtime.profile(), user, otp.channel());
        LoginFormsProvider form = context.form();
        boolean dryRun = CodeForms.dryRun(context.getAuthenticationSession());
        if (message != null) {
            if (success) {
                // In dry run the notice below is the whole truth, so the page does not also claim a code was sent.
                if (!dryRun) {
                    form.setSuccess(message, destination == null ? "" : destination);
                }
            } else {
                form.addError(new FormMessage(CodeForms.FIELD_CODE, message));
            }
        }
        for (FormMessage extra : extraErrors) {
            form.addError(extra);
        }
        CodeForms.dryRunNotice(form, dryRun);
        return CodeForms.codePage(form, PURPOSE, destination, otp, user != null).createForm(CodeForms.TEMPLATE);
    }

    private static void clearState(AuthenticationFlowContext context) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        authSession.removeAuthNote(NOTE_STEP);
        authSession.removeAuthNote(NOTE_USER);
        authSession.removeAuthNote(NOTE_NIK_HMAC);
        authSession.removeAuthNote(NOTE_DECOY);
        CodeForms.state(authSession, KarirRuntime.forRealm(context.getRealm())).clear();
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
