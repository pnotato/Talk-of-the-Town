# Blob inspector

On **Shapes**, click or tap any blob to open its bottom-left profile. A ring marks the selection. Click another blob to switch; click empty ground, press Escape, or use the close button to dismiss. Orbit/pan gestures do not change the selection, even when the pointer returns to where it started.

The profile is a compact 340px card on the HUD's frosted sheet, the same card the game shows top left. A 64px circular portrait sits beside the name, which is set in the theme's display face; under the name are age, life stage and shape, then the mood in words. Previous/next and close buttons sit top right. Below come family, the Interest and Perception meters in a soft well, trait pills, and a divided **Current action** row with the conversation partner's portrait. **Special tags** (Leader, Recluse, Family-oriented and explicit Parent / Child roles) and personality tags share one visual row but keep separate accessible lists. On phones the card spans the width; on short windows the portrait shrinks to 52px and the card scrolls. The browse controls and blob directory float on the same glass.

Colours, radii and faces come from the theme tokens in `web/src/index.css` (Sherbet, Midnight, Tabloid or Matcha, chosen in the game's settings). The fonts are Fraunces (soft cut, display) and Bricolage Grotesque (interface), self-hosted from `web/public/fonts/` with their SIL Open Font Licences alongside. There are no third-party font requests or new package dependencies.

The scene fills the window. A floating bar at the top says which sandbox this is, carries a SIMULATED tag and links back to the game. Scene labels use compact pinned notes: cream column and section labels, warm age-group tags and small item annotations. Labels are hidden on short screens so they never collide.

Meters show their label and a few words ("Mildly interested") over the bar, with no visible numbers. Screen readers get the underlying values and descriptions. Inline family/partner portraits are 20px, with native button targets at least 24px high. The card has no repeated SIMULATED badge; the sandbox bar carries it.

Click the main portrait to recenter the selected blob. Click a relative's or partner's portrait/name to select that blob and move the camera to where it currently stands. Repeated clicks recenter the same blob, even after panning away. Navigation preserves the camera angle, gently adjusts distance, and accounts for the measured panel height so the destination stays above it. A walking blob is located from its actual scene position, not its next animation destination; this is one-shot navigation, not continuous tracking. Manual orbit, pan, zoom or touch interrupts the camera flight.

## Keyboard and small screens

- **Browse blobs** opens the blob directory, which groups Shapes, Moods and Scenes without requiring canvas interaction.
- Enter/Space opens the picker; Up/Down and Home/End navigate its buttons. Enter/Space selects, closes the list, moves keyboard focus to the name, and navigates to that blob.
- **Done** or Escape closes the picker and restores the profile. Escape again dismisses the profile.
- Previous/next buttons cycle through all 31 blobs and navigate the camera.
- Keyboard focus returns to a stable heading when a selected family/partner link disappears.
- The picker replaces the profile while browsing. Selecting a blob dismisses it before navigating. Compact cards scroll within a height limit that leaves part of the scene exposed, keeping the toolbar, close button, and app navigation reachable.
- Reduced-motion preferences apply to the scene and panel transitions; camera navigation snaps instead of flying.

## Data boundary

**This is a Shapes sandbox, not a live simulation run.** The sandbox bar identifies the screen as simulated; an accessible profile description identifies the sandbox/demo source without repeating a visible footer in every card. The authored names, traits, parent/child relationships, and numeric scores live in `web/src/inspector/blobProfiles.ts` and are fictional fixtures. Relationships are explicitly authored, never inferred from age.

The scene reports its current scripted activity, mood, and conversation partner once per animation beat. Those reports update the portrait and activity fields, **not the numeric scores**. The accessible profile description explains this distinction. Walking activity describes the movement beat, including its brief settling period.

`BlobSelectionProvider` is scoped to `ShapesPage`; navigating away clears selection. `Blob` accepts optional selection props so other scenes do not need the provider. Portraits reuse the scene's geometry in demand-rendered canvases with capped pixel ratio and no shadows or controls. The picker has no WebGL canvases; family thumbnails are capped at two, with extra relatives rendered as name buttons.

A future RunLog-backed inspector must read scores and family/conversation records from the Go-generated contract instead of these sandbox fixtures. This feature adds no simulation rules, backend changes, generated contract types, or dependencies.

## Validation

```sh
make check
npm --prefix web test
make build
```

Browser smoke coverage includes canvas select/switch/dismiss, away-and-back orbit gestures, all 31 profiles, close/Escape, keyboard picker and family navigation, focus recovery when a live partner disappears, navigation reset, and touch selection. Portrait-navigation checks verify actual camera targets, repeated recentering after a pan, family and partner portraits, early requests during scene mount, normal-motion flight interruption, and unobstructed framing against measured HUD bounds. Layout checked at 1440×960, 1280×800, 390×844, 320×568, 320×480, 844×390, and 568×320. Both normal and reduced motion were exercised, including coarse-pointer hit targets. Screenshots are in `docs/screenshots/`.
