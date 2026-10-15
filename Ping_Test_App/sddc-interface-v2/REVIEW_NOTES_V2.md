# SDDC Interface v2 Review Notes

This version implements the main P0 and high-value P1 findings from the V1 peer review.

## Please verify

1. Status and mode are separate and consistent.
2. ERROR is visually and functionally reachable.
3. Batch manual pauses resume rather than aborting the queue.
4. Manual and manual-assisted tests have different semantics.
5. Evidence rows represent structured command results rather than preformatted strings.
6. All 20 tests appear.
7. Keyboard navigation and visible focus work.
8. No external network dependencies exist.
9. Mock mode is unmistakably labelled.
10. The FastAPI/SSE contract is suitable to replace with the live TestRunner/SSHManager adapter.

## Intentional mock scenarios

- NTP-01 returns FAIL.
- DHCP-01 returns ERROR.
- Most automated tests return PASS.
- Restricted tests require operator PASS/FAIL/CANCEL.
- 802.1X and EtherChannel pause for operator action, then resume automated evidence collection.

These states exist to exercise the interface; they are not claims about current live network state.
