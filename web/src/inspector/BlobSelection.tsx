import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { type BlobActivity, sameActivity } from "./inspectorModel.ts";

export type { BlobActivity };

type BlobSelection = {
  selectedId: number | null;
  selectBlob: (id: number | null) => void;
  activities: Readonly<Record<number, BlobActivity>>;
  updateActivities: (updates: Record<number, BlobActivity>) => void;
};

const SelectionContext = createContext<BlobSelection | null>(null);

/**
 * Shares the selected blob and what each blob is doing between the scene (which selects and
 * reports) and the inspector UI (which shows). Own one per page so it resets on navigation.
 */
export function BlobSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activities, setActivities] = useState<Readonly<Record<number, BlobActivity>>>({});

  // Both callbacks are stable, so the scene can list them as effect dependencies.
  const selectBlob = useCallback((id: number | null) => setSelectedId(id), []);

  // Merges updates in, and keeps the same object when nothing changed so a repeated report from
  // the scene doesn't re-render every consumer.
  const updateActivities = useCallback((updates: Record<number, BlobActivity>) => {
    setActivities((previous) => {
      let next: Record<number, BlobActivity> | null = null;
      for (const [key, activity] of Object.entries(updates)) {
        const id = Number(key);
        if (sameActivity(previous[id], activity)) continue;
        next ??= { ...previous };
        next[id] = activity;
      }
      return next ?? previous;
    });
  }, []);

  const value = useMemo(
    () => ({ selectedId, selectBlob, activities, updateActivities }),
    [selectedId, selectBlob, activities, updateActivities],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

// The provider and its hook share a file by agreement with the scene, which imports the hook here.
// oxlint-disable-next-line react/only-export-components
export function useBlobSelection(): BlobSelection {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useBlobSelection needs a <BlobSelectionProvider> above it");
  return value;
}
