# Blob inspector

On **Shapes**, click or tap any blob to open its bottom-left profile. A ring marks the selection. Click another blob to switch; click empty ground, press Escape, or use the close button to dismiss. Orbit/pan gestures do not change the selection, even when the pointer returns to where it started.

The translucent grey panel shows the selected blob's actual 3D model, name, shape, age and life stage, traits, family links, perception and interest meters, current activity, and conversation partner. Family and partner names are selectable links.

## Keyboard and small screens

- **Browse blobs** offers every sandbox blob without requiring canvas interaction.
- Enter/Space opens the picker; Up/Down and Home/End navigate its buttons. Enter/Space selects.
- **Done** or Escape closes the picker and restores the profile. Escape again dismisses the profile.
- Previous/next buttons cycle through all 31 blobs.
- Keyboard focus returns to a stable heading when a selected family/partner link disappears.
- The picker replaces the profile while browsing. Both scroll within the available viewport height, keeping the toolbar, close button, and app navigation reachable.
- Reduced-motion preferences apply to the scene and panel transitions.

## Data boundary

**This is a Shapes sandbox, not a live simulation run.** The screen and profile are labeled SIMULATED, Sandbox profile, and Demo data. The authored names, traits, parent/child relationships, and numeric scores live in `web/src/inspector/blobProfiles.ts` and are fictional fixtures. Relationships are explicitly authored, never inferred from age.

The scene reports its current scripted activity, mood, and conversation partner once per animation beat. Those reports update the portrait and activity fields, **not the numeric scores**. The card explains this distinction. Walking activity describes the movement beat, including its brief settling period.

`BlobSelectionProvider` is scoped to `ShapesPage`; navigating away clears selection. `Blob` accepts optional selection props so other scenes do not need the provider. The portrait reuses the scene's geometry in a demand-rendered canvas with capped pixel ratio and no shadows or controls.

A future RunLog-backed inspector must read scores and family/conversation records from the Go-generated contract instead of these sandbox fixtures. This feature adds no simulation rules, backend changes, generated contract types, or dependencies.

## Validation

```sh
make check
npm --prefix web test
make build
```

Browser smoke coverage: canvas select/switch/dismiss, away-and-back orbit gestures, all 31 profiles, close/Escape, keyboard picker and family navigation, focus recovery when a live partner disappears, navigation reset, and touch selection. Layout checked at 1440×960, 1280×800, 390×844, 320×568, and 844×390. Both normal and reduced motion were exercised. Screenshots are in `docs/screenshots/`.
