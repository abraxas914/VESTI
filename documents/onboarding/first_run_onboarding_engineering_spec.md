# VESTI First-Run Guided Tour Engineering Specification

Status: Active

Audience: Extension, UI, data, QA, and release engineers

## 1. Product contract

Fresh installs open `onboarding.html`. The welcome surface has exactly two
interactive paths:

- **Quick Start** seeds deterministic local demo conversations and starts the
  guided product tour.
- **Skip onboarding** completes onboarding immediately and opens the main
  side panel.

There is no full-setup branch, setup query route, login wall, or API-key gate.
Normal preferences remain available from the regular options dashboard after
onboarding.

## 2. Lifecycle and routing

The MV3 background worker owns installation and toolbar routing.

1. `chrome.runtime.onInstalled` with `reason === "install"` initializes fresh
   state, disables `openPanelOnActionClick`, and focuses or creates
   `onboarding.html`.
2. Quick Start opens the side panel in the original click gesture, seeds demo
   data through `CapturePipeline`, sends `ONBOARDING_TOUR_START`, and navigates
   the side panel to `/dashboard`.
3. Each real guided action sends `ONBOARDING_GUIDE_PROGRESS`.
4. When all five features are complete, background focuses or creates
   `onboarding.html`; state resolution renders the final cleanup dialog.
5. Clear and Keep both send `ONBOARDING_COMPLETE`, set
   `hasSeenOnboarding: true`, enable `openPanelOnActionClick`, and open
   `/dashboard`.
6. Subsequent toolbar clicks use Chrome's native side-panel behavior.

If the browser closes before final confirmation, a toolbar click resolves an
all-complete but unseen state to the final cleanup dialog. It does not replay
the welcome choice or completed coachmarks.

## 3. Storage contract

The canonical bundle is stored under `vesti_onboarding_state` with schema
version 2. The following compatibility keys are also written:

- `hasSeenOnboarding: boolean`
- `onboardingStepCompleted: { dashboard, explore, aiti, roundtable, deepseek }`
- `hasCleanedMockData: boolean`

The bundle also contains:

- an anonymous local user ID;
- `tourStarted`;
- per-feature `guideSteps`;
- installation, update, and completion timestamps;
- completion source (`quick_start`, `skip`, or legacy migration).

Progress is monotonic: a feature step cannot move backwards, and a completed
feature cannot become incomplete. `hasSeenOnboarding` is not set by Quick
Start; it is written only by global Skip or the final cleanup decision.

## 4. Demo data contract

`frontend/src/lib/mocks/seedData.ts` produces deterministic conversations from
2026-07-18 through 2026-07-25 spanning ChatGPT, DeepSeek, and Kimi.

`seedMockData()` writes them through the existing `CapturePipeline`. Every
seeded `ConversationDraft` carries `isMock: true`. Normal capture explicitly
uses `isMock: false`.

Idempotent reseeding upgrades an older matching demo record to
`isMock: true`, even when its messages are unchanged. Cleanup reads all
conversations, filters strictly on `isMock === true`, and deletes only those
conversation IDs through the normal storage service so dependent messages and
annotations follow existing deletion semantics.

## 5. Guided surfaces

All side-panel coachmarks render through a React portal. The DeepSeek
coachmarks render through an isolated absolute-positioned Shadow DOM layer.
Both implementations use:

- four blocking dim panes around a live target;
- an unobstructed target hit area;
- a translucent `rgba(0,0,0,.6)` bubble with `blur(20px)`;
- 20px corner radius, translucent white border, layered shadow, and pointer;
- a 400ms fade-and-rise transition;
- a per-step Skip link;
- `prefers-reduced-motion` fallbacks with no transition.

Progress is action-gated; timers never advance a guide step.

### Dashboard (`/dashboard`)

1. First conversation checkbox.
2. Merge Summary after at least two conversations are selected.
3. Continue from Summary after a summary is generated.

Successful continuation completes Dashboard and navigates to Explore.

### Explore (`/explore`)

1. After **Open Library Panel**, an animated spotlight targets the visible
   **Explore** tab beside **Conversation Library**.
2. Knowledge-base input.
3. Ask button after non-empty input.

A successful answer completes Explore and navigates to AITI.

### AITI (`/aiti`)

The coachmark points to the resolved persona card. Acknowledge or per-step Skip
completes AITI and navigates to Roundtable.

### Roundtable (`/roundtable`)

1. Topic input.
2. Send button after non-empty input.

A successful three-role response completes Roundtable.

### DeepSeek content surface

1. Collapsed VESTI Capsule.
2. Expert Mentor action after the Capsule opens.
3. Optimize action after Expert Mentor succeeds or its coachmark is skipped.

The prompt optimizer remains background-only. Content scripts communicate
through typed runtime messages and never read an API key.

## 6. Final cleanup dialog

The final dialog appears only when all five completion booleans are true. It
uses a full-screen frosted overlay and visually matches the coachmarks.

- **Clear demo and restart** deletes only `isMock: true` records, then stores
  `hasCleanedMockData: true`.
- **Keep demo and continue** deletes nothing and stores
  `hasCleanedMockData: false`.

If cleanup fails, onboarding remains incomplete, the dialog stays available,
and no completion state is committed.

## 7. Verification gates

Required automated checks:

- state normalization, migration, monotonic progress, and final resolution;
- install, toolbar, fifth-feature, Skip, and cleanup background behavior;
- full Vitest suite;
- production MV3 build and stable `onboarding.html` entry verification.

Manual browser acceptance:

- install opens the welcome page;
- Quick Start seeds and opens `/dashboard`;
- every target remains clickable through its spotlight;
- steps advance only after their real action;
- reduced-motion removes transitions;
- DeepSeek actions preserve the background API boundary;
- closing and reopening before final confirmation returns to the final dialog;
- Clear removes demo records only; Keep preserves them;
- the toolbar opens the native side panel after completion.
