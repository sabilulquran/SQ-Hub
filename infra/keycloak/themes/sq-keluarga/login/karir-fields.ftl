<#-- Fields shared by the Keluarga pages (realm sq-keluarga). Sign-in and "Lupa kata sandi" take a WhatsApp number or an email, field "identifier"; registration asks for the nomor KK, field "kk" (ADR-0010 as amended 2026-11-06). Values are escaped by FreeMarker's HTML output format. -->
<#import "field.ftl" as field>

<#macro nik value="" autofocus=true>
  <@field.group name="kk" label=msg("karirNikLabel") error=messagesPerField.get('kk')>
    <span class="${properties.kcInputClass} <#if messagesPerField.existsError('kk')>${properties.kcError}</#if>">
      <input id="kk" name="kk" value="${value}" type="text" inputmode="numeric" maxlength="24"
             autocomplete="username" spellcheck="false" <#if autofocus>autofocus</#if>
             aria-describedby="kk-help" aria-invalid="<#if messagesPerField.existsError('kk')>true</#if>"/>
    </span>
    <p id="kk-help" class="sq-karir-help">${msg("karirNikHelp")}</p>
  </@field.group>
</#macro>

<#macro identifier value="" autofocus=true>
  <@field.group name="identifier" label=msg("keluargaIdentifierLabel") error=messagesPerField.get('identifier')>
    <span class="${properties.kcInputClass} <#if messagesPerField.existsError('identifier')>${properties.kcError}</#if>">
      <input id="identifier" name="identifier" value="${value}" type="text" maxlength="255"
             autocomplete="username" autocapitalize="none" spellcheck="false" <#if autofocus>autofocus</#if>
             aria-describedby="identifier-help" aria-invalid="<#if messagesPerField.existsError('identifier')>true</#if>"/>
    </span>
    <p id="identifier-help" class="sq-karir-help">${msg("keluargaIdentifierHelp")}</p>
  </@field.group>
</#macro>

<#macro turnstile>
  <#if karirTurnstileRequired?? && karirTurnstileRequired>
    <#if karirTurnstileSiteKey??>
      <div class="sq-karir-turnstile">
        <div class="cf-turnstile" data-sitekey="${karirTurnstileSiteKey}" data-language="id" data-theme="auto" data-size="flexible"></div>
      </div>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <#else>
      <p class="sq-karir-help">${msg("karirTurnstileUnavailable")}</p>
    </#if>
  </#if>
</#macro>
