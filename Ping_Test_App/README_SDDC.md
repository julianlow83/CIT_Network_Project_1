# SKYNET: DEADLINK Diagnostic Core (SDDC)

A custom network validation and diagnostic platform built for the **CIT Network Project 1** environment.

SDDC was designed to turn repeatable network testing into a guided, evidence-based workflow. Instead of manually SSHing into devices, running commands, interpreting output, and recording results, SDDC executes the required checks, captures raw evidence, evaluates the result, and reports a clear **PASS / FAIL / ERROR** outcome.

The interface is branded as:

> **CYBERDYNE SYSTEMS — SKYNET: DEADLINK Diagnostic Core**

---

## Project Status

The current build is **functionally complete** for the Network Project 1 demonstration environment.

At the final development checkpoint:

- the active test suite was working
- the VPN evaluator had been corrected to avoid false failures caused by IOS XE counter-refresh behaviour
- the EtherChannel resilience test was working with a post-restoration convergence delay
- the 1 GB cross-site file-transfer test was working in both directions
- the original dedicated 802.1X tests were consolidated into the existing access-control tests
- NAT test prerequisites were clarified
- manual-assisted workflows were retained for tests that require operator interaction

Before making new changes, create or verify a backup of both the SDDC engine and interface folders.

---

# What SDDC Does

SDDC provides a single interface for validating network services, routing, security controls, resilience, authentication outcomes, and cross-site functionality.

The workflow is:

```text
Operator selects test
        ↓
SDDC loads test definition
        ↓
Commands are executed on the required devices
        ↓
Raw output is captured
        ↓
Evaluator interprets the evidence
        ↓
PASS / FAIL / ERROR is returned
```

Some tests are completely automated.

Other tests are **manual-assisted** because the operator must perform an action such as logging into a workstation, logging out, or initiating a controlled topology change.

---

# Result States

SDDC uses the following primary states:

| State | Meaning |
|---|---|
| `NOT_RUN` | Test has not yet been executed |
| `RUNNING` | Test is currently executing |
| `PASS` | Test executed successfully and the expected network behaviour was observed |
| `FAIL` | Test executed successfully but the network did not meet the expected condition |
| `ERROR` | SDDC could not execute or evaluate the test correctly |

A `FAIL` is therefore different from an `ERROR`.

A failed connectivity attempt may also form part of a successful test. For example, the Restricted VLAN test passes when prohibited destinations are correctly blocked.

---

# Architecture

SDDC is split into two main components.

## Engine

Location:

```bash
~/sddc
```

Important files include:

```text
~/sddc/
├── config/
│   ├── devices.yaml
│   └── tests.yaml
├── engine/
│   ├── config_validator.py
│   ├── evaluators.py
│   ├── result.py
│   ├── runner.py
│   └── ssh_manager.py
├── run_test.py
└── ...
```

The engine is responsible for:

- loading device and test definitions
- connecting to network devices
- executing commands
- handling Windows PowerShell and Cisco IOS output
- evaluating evidence
- returning structured test results

## Web Interface

Location:

```bash
~/sddc-interface-v2/sddc-interface-v2
```

Important files include:

```text
app_live.py
app.py
mock_catalog.json
static/
```

`app_live.py` connects the web interface to the real SDDC engine.

`app.py` is the older/mock backend and should not be used for the live demonstration.

---

# Python Environment

SDDC uses the virtual environment:

```bash
~/sddc-venv
```

Activate it with:

```bash
source ~/sddc-venv/bin/activate
```

The environment includes the packages required by the engine and interface, including FastAPI, Uvicorn, AsyncSSH, PyYAML, cryptography and cffi.

---

# Starting SDDC

From T1000:

```bash
cd ~/sddc-interface-v2/sddc-interface-v2
source ~/sddc-venv/bin/activate
python -m uvicorn app_live:app --host 127.0.0.1 --port 8001
```

Then open:

```text
http://127.0.0.1:8001
```

A future polish item is to expose the interface through internal DNS, for example:

```text
sddc.cyberdyne.com
```

Do not change the listening address or introduce a reverse proxy immediately before a demonstration unless the existing working configuration has been backed up.

---

# Core Test Suite

The current consolidated suite contains the following tests.

| Test ID | Purpose |
|---|---|
| `RESTRICTED-01` | 802.1X fallback / Restricted VLAN isolation |
| `STAFF-01` | 802.1X Staff VLAN access validation |
| `ITADMIN-01` | 802.1X IT Admin VLAN access validation |
| `EXEC-01` | 802.1X Executive VLAN access validation |
| `DHCP-01` | Core DHCP service and lease validation |
| `PORTSEC-01` | Cisco switch port-security validation |
| `DNS-01` | DNS service validation |
| `NTP-01` | NTP/time synchronisation validation |
| `OSPF-01` | OSPF routing validation |
| `VPN-01` | GRE over IPsec VPN validation |
| `NAT-01` | Sydney NAT/PAT validation |
| `NAT-02` | Canberra NAT/PAT validation |
| `ETHERCHANNEL-01` | EtherChannel link-resilience validation |
| `TRANSFER-01` | Bidirectional 1 GB cross-site file transfer |

The separate `DOT1X-*` tests were removed because their outcome was already demonstrated by the access-control tests. The access tests now represent the useful end-to-end result: the user authenticates into the expected role/VLAN and the resulting access policy is validated.

---

# 802.1X / Access-Control Workflow

The access tests are designed around the state of `WS-SYD`.

The normal demonstration sequence is:

```text
Logged out
   ↓
802.1X fallback / VLAN40 Restricted
   ↓
RESTRICTED-01

Login as test.staff
   ↓
VLAN10 Staff
   ↓
STAFF-01

Login as test.itadmin
   ↓
VLAN60 ITADMIN
   ↓
ITADMIN-01

Login as test.exec
   ↓
VLAN70 EXEC
   ↓
EXEC-01
```

Logging out returns the endpoint to the fallback/restricted state.

These tests require the operator to establish the correct login state before running the validation.

---

# NAT Prerequisites

The NAT tests depend on the appropriate workstation being logged into the Staff account.

## NAT-01

```text
WS-SYD is logged in as test.staff and has valid network connectivity.
```

## NAT-02

```text
WS-CBR is logged in as test.staff and has valid network connectivity.
```

---

# VPN-01 Notes

`VPN-01` validates the GRE over IPsec tunnel between the Sydney and Canberra gateways.

The test checks:

- `Tunnel0` is up/up
- IKEv2 SA status is `READY`
- AES-256 encryption is present
- SHA-256 integrity is present
- expected public peers are present
- the tunnel peer responds to a 100-packet ping
- IPsec send/receive error counters remain zero

The test still captures:

```text
show crypto ipsec sa
```

but it no longer requires the displayed packet counters to increase during the short test window.

This was intentional. IOS XE was observed to report a healthy, active tunnel with successful traffic while the displayed IPsec counters did not always update quickly enough for a reliable before/after comparison. Requiring a live delta produced false failures.

The final working configuration uses:

```yaml
counters_must_increase: []
```

The VPN remains strongly validated by tunnel state, IKEv2 state, crypto parameters, peer identity, successful tunnel traffic, and zero IPsec errors.

---

# EtherChannel Resilience Test

`ETHERCHANNEL-01` performs a controlled link-resilience test against Port-channel1.

The proven sequence is:

```text
Baseline
Both physical members bundled
        ↓
Disable SYD-SW1 Gi1/0/3
        ↓
Port-channel remains operational
        ↓
One member remains bundled
        ↓
100-packet connectivity test
        ↓
Restore Gi1/0/3
        ↓
Allow LACP to reconverge
        ↓
Both members bundled again
        ↓
PASS
```

The successful test produced:

```text
Ping success: 100/100
Required minimum: 95%

SYD-SW1:
baseline_bundled = 2
outage_bundled   = 1
restored_bundled = 2

SYD-SW2:
baseline_bundled = 2
outage_bundled   = 1
restored_bundled = 2
```

The SDDC runner was extended with a reusable per-step setting:

```yaml
settle_seconds:
```

The current known-good restoration delay for the EtherChannel test is:

```yaml
settle_seconds: 240
```

This is deliberately conservative to allow the EtherChannel/LACP state to fully return before final evaluation. It may be shortened later, but only after confirming that a shorter value is consistently reliable.

---

# Cross-Site File Transfer Test

`TRANSFER-01` performs a 1 GB SMB file-transfer test in both directions.

The test path is:

```text
CYBERDYNE-T800 → WS-CBR
WS-CBR → CYBERDYNE-T800
```

The test records direction, bytes transferred, duration and throughput in Kbps.

The test requires:

```text
1073741824 bytes
```

to be transferred in both directions.

A successful run completed each transfer in roughly 38 seconds at approximately 228,000 Kbps.

The SSH command timeout was increased during development because the original 30-second timeout terminated the transfer before completion.

---

# Important Network References

| Device | Address / Role |
|---|---|
| T1000-Monitoring | `10.10.4.20` |
| CYBERDYNE-T800 | `10.10.4.10` |
| SYD-SW1 | `10.10.6.65` |
| SYD-SW2 | `10.10.6.66` |
| CBR-SW1 | `10.20.15.253` |
| SYD-GW | `10.10.15.254` |
| CBR-GW | `10.20.15.254` |
| VPN Tunnel Peer | `10.255.255.2` |
| Simulated Internet | `17.155.127.65` |

Important Sydney VLAN gateways:

| VLAN | Purpose | Gateway |
|---|---|---|
| VLAN10 | STAFF | `10.10.0.1` |
| VLAN20 | SERVER | `10.10.4.1` |
| VLAN30 | GUEST | `10.10.4.129` |
| VLAN40 | RESTRICTED | `10.10.5.1` |
| VLAN60 | ITADMIN | `10.10.5.193` |
| VLAN70 | EXEC | `10.10.6.1` |

The 802.1X workstation is connected to:

```text
SYD-SW2 GigabitEthernet1/0/3
```

---

# Configuration Validation

After modifying SDDC configuration or evaluator code:

```bash
cd ~/sddc
source ~/sddc-venv/bin/activate
python -m engine.config_validator
```

For Python changes:

```bash
python -m py_compile engine/runner.py
python -m py_compile engine/evaluators.py
```

For the interface catalogue:

```bash
cd ~/sddc-interface-v2/sddc-interface-v2
python -m json.tool mock_catalog.json >/dev/null
```

A successful validation should be completed before restarting the live interface.

---

# Backup

The two important directories are:

```text
~/sddc
~/sddc-interface-v2
```

A full backup can be created with:

```bash
cd ~

mkdir -p SDDC_FINAL_BACKUP

cp -a ~/sddc ~/SDDC_FINAL_BACKUP/
cp -a ~/sddc-interface-v2 ~/SDDC_FINAL_BACKUP/

tar -czf SDDC_FINAL_BACKUP_$(date +%Y%m%d_%H%M).tar.gz SDDC_FINAL_BACKUP
```

Then verify:

```bash
ls -lh ~/SDDC_FINAL_BACKUP*.tar.gz
```

A final backup should be copied off the T1000 VM before further experimental changes.

---

# Optional Future Work

## SCAN-01 — ACL Exposure Validation

A possible Nmap-based test could scan selected infrastructure systems from T1000 and compare visible services against expected ACL policy.

Suggested ports:

```text
22
53
80
88
135
389
443
445
636
3389
```

The test should remain narrowly scoped and should not delay the working demonstration suite.

## Internal DNS Name

Potential address:

```text
sddc.cyberdyne.com
```

## Other Optional Enhancements

- reverse proxy to remove `:8001`
- result export
- topology visualisation
- additional Nmap/service exposure checks
- shortened EtherChannel convergence timer after reliability testing

---

# Demonstration Philosophy

The demonstration should show that SDDC is more than a collection of scripts.

It provides a repeatable validation process where:

- tests are defined centrally
- device interaction is automated
- evidence is retained
- expected behaviour is explicit
- network failures are distinguished from tool errors
- manual operator actions are guided where automation is inappropriate

For the final demonstration, the preferred approach is to allow the assessor/operator to run the tests through the interface rather than having the developer manually execute every command.

---

# Important Notes

- Do not modify a working test immediately before the demonstration without first making a backup.
- `TRANSFER-01`, `ETHERCHANNEL-01`, and `VPN-01` required significant troubleshooting and should be treated as stable unless a genuine regression appears.
- Keep the test network isolated from the public Internet unless the design explicitly requires otherwise.
- Do not store plain-text credentials in documentation intended for public release.
- If this project is published to GitHub later, sanitise device credentials, private keys, internal secrets, and any institution-specific information first.

---

## Summary

SDDC was built to provide an automated, repeatable and demonstrable way to validate the Network Project 1 environment.

At the final functional checkpoint, the active suite was working and the project had moved from development into demonstration preparation.

The safest next steps are:

```text
Final UI polish
        ↓
Optional internal DNS name
        ↓
Clean demonstration run
        ↓
Final backup
        ↓
Operator/demo runbook
```

Do not add new functionality unless the current working state is safely backed up first.
