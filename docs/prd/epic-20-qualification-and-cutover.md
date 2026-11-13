# Epic 20: Qualification, pilot and cutover

**Goal.** Turn the finished Electron preview into evidence the owner can decide on: a full-flow parity matrix on every OS, measured start-up and memory against the unchanged limits, an opt-in pilot, a rehearsed rollback, and separate cutover and retirement decision records. Nothing in this epic deletes or edits the Tauri app.

**MFRs covered.** MFR-2, MFR-5, MFR-6, MFR-8. Baseline requirements: NFR-1, NFR-2, NFR-3, NFR-7, NFR-9.

**Stories.**
- [20.1 Full-flow parity matrix run](../stories/20.1-full-flow-parity-matrix.md)
- [20.2 Start-up and memory measurement](../stories/20.2-startup-and-memory-measurement.md)
- [20.3 Opt-in pilot](../stories/20.3-opt-in-pilot.md)
- [20.4 Rollback rehearsal and decision records](../stories/20.4-rollback-and-decision-records.md)

**Dependency order.** 20.1 needs 14.2, 16.x, 17.x, 18.4 and 19.3. 20.2 needs 19.3 and may run beside 20.1. 20.3 needs 20.1 and 20.2 with no FAIL. 20.4 needs 20.1 to 20.3.

**Authority.** The reviewer records PASS, CONCERNS or FAIL with evidence. The owner alone decides cutover and, as a separate later decision, retirement (AD-31). Neither decision is made by a document in this repository; 20.4 prepares the records, it does not sign them.

**Exit evidence.** A parity report with zero unexplained differences on macOS, Windows and Linux; measured cold start ≤ 3 s and idle memory ≤ 300 MB (whole process tree) on each OS, or a recorded FAIL; pilot findings; a rehearsed rollback; two blank-but-ready decision records for the owner.
