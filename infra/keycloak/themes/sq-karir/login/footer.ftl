<#macro content>
  <div class="sq-account-brand sq-karir-brand" role="img" aria-label="${msg("karirAppName")}, Islamic Tahfizh School Sabilul Qur&apos;an">
    <picture>
      <source srcset="${url.resourcesPath}/img/logo-white.png" media="(prefers-color-scheme: dark)">
      <img class="sq-account-brand__logo" src="${url.resourcesPath}/img/logo.png" alt="" aria-hidden="true" width="2240" height="721">
    </picture>
  </div>
  <#-- Service name as a short description under the title, not as a heading (owner, 2026-10-21). -->
  <#assign ledeKey = ((pageId!"") == "register")?then("karirLedeRegister", ((pageId!"") == "login")?then("karirLede", "karirLedeOther"))>
  <p class="sq-karir-lede">${msg(ledeKey, msg("karirAppName"))}</p>
</#macro>
