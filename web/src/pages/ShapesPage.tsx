import BlobInspector from "../inspector/BlobInspector.tsx";
import { BlobSelectionProvider } from "../inspector/BlobSelection.tsx";
import ShapesScene from "../scene/ShapesScene.tsx";

// The provider lives here, so leaving the page drops the selection.
export default function ShapesPage() {
  return (
    <BlobSelectionProvider>
      <div style={{ position: "relative", height: "100%" }}>
        <ShapesScene />
        <BlobInspector />
      </div>
    </BlobSelectionProvider>
  );
}
