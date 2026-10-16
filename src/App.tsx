import { useEffect } from "react";
import { clearTracking, saveTracking } from "./lib/savedTracking";
import { useAppState } from "./state/AppStateContext";
import ImportPhase from "./phases/Import/ImportPhase";
import TrackPhase from "./phases/Track/TrackPhase";
import HaloPhase from "./phases/Halo/HaloPhase";
import PreviewPhase from "./phases/Preview/PreviewPhase";
import ExportPhase from "./phases/Export/ExportPhase";

export default function App() {
  const state = useAppState();
  const { project, keyframes } = state;

  useEffect(() => {
    if (!project) return;
    if (keyframes.length > 0) saveTracking(project.key, keyframes);
    else clearTracking(project.key);
  }, [project, keyframes]);

  switch (state.phase) {
    case "import":
      return <ImportPhase />;
    case "track":
      return <TrackPhase />;
    case "halo":
      return <HaloPhase />;
    case "preview":
      return <PreviewPhase />;
    case "export":
      return <ExportPhase />;
    default:
      return null;
  }
}
