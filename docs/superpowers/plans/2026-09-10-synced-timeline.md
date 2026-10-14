# Synced Timeline Implementation Plan

**Goal:** Replace the footer's fixed-width clip boxes with a real time-proportional timeline: a time ruler, a vertical playhead that stays in sync with the preview and can be dragged to scrub, a transcript track aligned to the clips it narrates, and the ability to split a clip at the playhead.

**Architecture:** Time drives layout. Every clip's position and width come from its `start`/`duration` at a `pixelsPerSecond` scale the user can zoom, so the strip scrolls horizontally instead of squashing to fit. The playhead is driven by the Player's `frameupdate` event in one direction and `seekTo` in the other, which is what keeps the ruler, the clips, the transcript track and the preview on the same time. Transcript segments stop being a stack of cards in the side panel: they become blocks on a second track under the clip they belong to, and the side panel becomes an editor for whichever one is selected.

**Decisions taken with the project owner (2026-09-10):** horizontal layout with a transcript track (not a vertical Descript-style script view); splitting clips is in scope; dragging the playhead scrubs the preview live.

**Tech Stack:** No new dependencies. Uses the existing the preview player ref API (`seekTo`, `addEventListener('frameupdate')`), the existing `@dnd-kit` reordering, and the byte-range seeking the asset server gained in the previous change (without it, live scrubbing of a recording could not work).

## Global Constraints

- Semantic colour tokens only (`bg`, `surface`, `surface-hover`, `border`, `text`, `text-muted`, `accent`, `accent-hover`, `danger`, `danger-bg`), never raw palette classes. The one exception already in the tree is the clip label's fixed dark scrim, which sits on arbitrary footage.
- Dragging a clip still reorders it (dnd-kit); dragging the ruler or the playhead scrubs. These must not fight each other, so scrub gestures bind to the ruler strip and the playhead handle, never to a clip block.
- Splitting must preserve what each half should show: for a video the second half's `trimBefore` advances by the first half's length, so neither half repeats footage. The first half keeps the original item id so transcript segments stay linked to it.
- `withSequentialStarts` remains the single owner of `start` values — split, reorder and duration changes all go through it.
- Layout maths (tick interval, frame-from-pixel) goes in `src/renderer/src/lib/` with unit tests. Drag, scrub and dnd interactions are verified by running the app, matching how the Editor has been treated since Phase C.
- No comments explaining what code does — only where a non-obvious constraint needs flagging.
- Committing directly to `main`, as with the previous rounds.

---

## File Structure

```
src/main/project/
  projectApi.ts                        # modified — splitTimelineItem
  projectApi.test.ts                   # modified
src/main/ipc/
  timelineHandlers.ts                  # modified — project:timeline:split
src/preload/index.ts                   # modified — timeline.split
src/renderer/src/
  api/projectClient.ts                 # modified — timelineClient.split
  lib/
    timelineLayout.ts                  # new — tick interval + frame/pixel maths
    timelineLayout.test.ts             # new
  components/
    Timeline.tsx                       # new — ruler, clips, transcript track, playhead
    TranscriptPanel.tsx                # modified — editor for the selected segment
    TranscriptPanel.test.tsx           # modified — new contract
  screens/Editor.tsx                   # modified — owns segments, frame, selection
```

---

### Task 1: `splitTimelineItem` backend + IPC + client

**Produces:** `splitTimelineItem(id, timelineItemId, atFrame, baseDir?): TimelineItem[]`, exposed as `project:timeline:split` and `timelineClient.split(projectId, itemId, atFrame)`.

`atFrame` is an absolute timeline frame and must fall strictly inside the item, so neither half can be empty. The first half keeps the item's id and `trimBefore`; the second gets a fresh id and `trimBefore + firstDuration` when the kind carries a trim. Both halves then go through `withSequentialStarts`.

Tests: splits durations at the right point; advances the second half's `trimBefore`; keeps the first half's id; leaves an image's data untouched; rejects a frame at or outside the item's bounds; rejects an unknown item id.

### Task 2: Time-proportional timeline with ruler and zoom

`timelineLayout.ts` provides `chooseTickIntervalSeconds(pixelsPerSecond)` (picks from a fixed ladder so ticks stay ≥ 60px apart) and `frameAtOffset(offsetPx, pixelsPerSecond, fps, totalFrames)` (clamped), both unit-tested.

`Timeline.tsx` renders a horizontally scrollable strip at `pixelsPerSecond` (default 60, zoom buttons × / ÷ 1.5, clamped 10–400): a ruler row of ticks with `m:ss` labels, then the clip track with each clip absolutely positioned from its `start`/`duration`, keeping the existing thumbnails, labels, selection ring and dnd reordering.

### Task 3: Playhead and live scrubbing

Editor owns `currentFrame`, updated from the Player's `frameupdate`, and passes it down; the playhead is a vertical line across ruler, clip track and transcript track. A pointerdown on the ruler (or the playhead handle) captures the pointer, converts x to a frame via `frameAtOffset` and calls `seekTo`, repeating on pointermove until release — so the preview scrubs live.

### Task 4: Transcript track and selection

Editor lifts `segments` out of `TranscriptPanel` and owns them. Each segment renders as a block spanning its linked clip's range; segments sharing a clip divide that clip's width evenly so they never overlap. Clicking a block selects the segment and seeks to its start; the block carries a narrated/edited marker. The block containing the playhead reads as active.

### Task 5: `TranscriptPanel` becomes an editor

Instead of stacking every segment, the panel edits the selected one — text, status, narrate — and keeps the "Add Segment" form. With nothing selected it shows an empty state pointing at the transcript track. Its tests move to this contract, keeping coverage of the disabled-while-adding and disabled-while-narrating guards.

### Task 6: Split in the UI

A scissors button in the timeline header splits the clip under the playhead, disabled unless the playhead sits strictly inside a clip. On success the timeline refreshes and the playhead stays put.

### Task 7: Verification

Full suite, typecheck, build, then in the running app: scrub the ruler and watch the preview follow; confirm the playhead lines up with the clip and transcript blocks; split a clip and confirm both halves play the right footage without repeating; reorder by dragging a clip; select a transcript block and edit it; check both themes.
