<#-- Fields shared by the Keluarga pages (realm sq-keluarga): the identifier is the nomor KK, field "kk". Values are escaped by FreeMarker's HTML output format. -->
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
