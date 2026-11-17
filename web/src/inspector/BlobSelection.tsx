import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { type BlobActivity, sameActivity } from "./inspectorModel.ts";

export type { BlobActivity };

/** A separate request lets a portrait recenter an already selected blob. */
export type BlobFocusRequest = { id: number; serial: number };

type BlobSelection = {
  selectedId: number | null;
  selectBlob: (id: number | null) => void;
  focusBlob: (id: number) => void;
  focusRequest: BlobFocusRequest | null;
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
  const [focusRequest, setFocusRequest] = useState<BlobFocusRequest | null>(null);
  const focusSerial = useRef(0);
  const [activities, setActivities] = useState<Readonly<Record<number, BlobActivity>>>({});

  // A canvas selection should not move the camera; explicit portrait navigation should.
  const selectBlob = useCallback((id: number | null) => {
    setSelectedId(id);
    setFocusRequest(null);
  }, []);
  const focusBlob = useCallback((id: number) => {
    setSelectedId(id);
    setFocusRequest({ id, serial: ++focusSerial.current });
  }, []);

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
    () => ({ selectedId, selectBlob, focusBlob, focusRequest, activities, updateActivities }),
    [selectedId, selectBlob, focusBlob, focusRequest, activities, updateActivities],
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
