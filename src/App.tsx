import { useEffect } from "react";
import { saveTracking } from "./lib/savedTracking";
import { useAppState } from "./state/AppStateContext";
import LibraryPhase from "./phases/Library/LibraryPhase";
import RecordPhase from "./phases/Record/RecordPhase";
import TrackPhase from "./phases/Track/TrackPhase";
import HaloPhase from "./phases/Halo/HaloPhase";
import PreviewPhase from "./phases/Preview/PreviewPhase";
import ExportPhase from "./phases/Export/ExportPhase";

export default function App() {
  const state = useAppState();
  const { project, keyframes } = state;

  useEffect(() => {
    if (project && keyframes.length > 0) saveTracking(project.key, keyframes);
  }, [project, keyframes]);

  switch (state.phase) {
    case "library":
      return <LibraryPhase />;
    case "record":
      return <RecordPhase />;
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
