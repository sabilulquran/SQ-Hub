# MI8_TAILSCALE_MANAGEMENT_PLANE_INCIDENT

**Status:** follow-up required after stable production operation.  
**Opened:** 6 October 2026 WIB.  
**Scope:** Mi8 management-plane availability during SQ Core cutover.

## Incident evidence

- Mi8 Tailscale management connectivity became unavailable during the cutover although the device already had Tailscale Autostart enabled, Battery set to No restrictions, and Always-on VPN enabled.
- The normal Mi8 management SSH paths became unavailable while application ingress remained healthy.
- Connectivity recovered after the Tailscale application was opened manually on Mi8.
- A later pre-closure observation also recorded a transient management SSH error. It was not used as clean-gate evidence.
- After recovery, both `ssh mi8vps` and `ssh mi8vps-root` passed repeatedly. The final short verification also confirmed one SQ Core supervisor, 8/8 service processes, three Cloudflare connectors, healthy application services, and fresh Organization Directory.

## Diagnosis

Root cause is **UNRESOLVED**. The observed recovery behavior indicates a Tailscale management-plane liveness failure that is not explained solely by the three already-enabled settings above.

No Tailscale hardening, configuration change, architecture change, or new management path was made during the cutover.

## Required post-stability investigation

1. Preserve and review Android/Tailscale service, VPN, power-management, and network-transition logs around the outage window.
2. Establish the exact outage start/end, whether the daemon, VPN tunnel, DNS, or device network lost liveness, and whether opening the app restarted or merely foregrounded the service.
3. Compare Tailscale client version, Android version, device uptime, battery state, and network changes with known vendor issues.
4. Reproduce only in a separately approved maintenance window after SQ Core stability is accepted.
5. Propose any remediation as a reviewed change with a rollback plan. Do not change the production management-plane architecture as an outcome of this incident record alone.
