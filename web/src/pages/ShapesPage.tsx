import { useCallback, useState } from "react";
import BlobInspector from "../inspector/BlobInspector.tsx";
import { BlobSelectionProvider } from "../inspector/BlobSelection.tsx";
import ShapesScene from "../scene/ShapesScene.tsx";

// The provider lives here, so leaving the page drops the selection.
export default function ShapesPage() {
  const [focusInset, setFocusInset] = useState({ top: 112, bottom: 0 });
  const reportInset = useCallback((next: { top: number; bottom: number }) => {
    setFocusInset((previous) =>
      previous.top === next.top && previous.bottom === next.bottom ? previous : next,
    );
  }, []);

  return (
    <BlobSelectionProvider>
      <div style={{ position: "relative", height: "100%" }}>
        <ShapesScene focusInset={focusInset} />
        <BlobInspector onFocusInsetChange={reportInset} />
      </div>
    </BlobSelectionProvider>
  );
}
