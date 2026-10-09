import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { useForceVideoFirstFrame } from "../hooks/useForceVideoFirstFrame";
import { computeContentBox, type ContentBox } from "../lib/geometry";

interface VideoStageProps {
  src: string;
  initialTime?: number;
  children?: (box: ContentBox) => ReactNode;
  onTimeUpdate?: (t: number) => void;
}

const VideoStage = forwardRef<HTMLVideoElement, VideoStageProps>(function VideoStage(
  { src, initialTime, children, onTimeUpdate },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState<ContentBox | null>(null);
  const diagnostic = useForceVideoFirstFrame(localVideoRef, src, initialTime);

  useEffect(() => {
    const container = containerRef.current;
    const video = localVideoRef.current;
    if (!container || !video) return;

    function recompute() {
      if (!container || !video || !video.videoWidth || !video.videoHeight) return;
      const containerRect = container.getBoundingClientRect();
      setBox(computeContentBox(containerRect, video.videoWidth, video.videoHeight));
    }

    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    video.addEventListener("loadedmetadata", recompute);
    recompute();

    return () => {
      resizeObserver.disconnect();
      video.removeEventListener("loadedmetadata", recompute);
    };
  }, [src]);

  return (
    <div ref={containerRef} className="video-stage">
      <video
        ref={(node) => {
          (localVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        src={src}
        playsInline
        muted
        preload="auto"
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        className="video-stage-el"
      />
      {diagnostic && <div className="video-diagnostic">{diagnostic}</div>}
      {box && containerRef.current && (
        <div
          className="video-stage-overlay"
          style={{
            position: "absolute",
            left: box.left - containerRef.current.getBoundingClientRect().left,
            top: box.top - containerRef.current.getBoundingClientRect().top,
            width: box.width,
            height: box.height,
          }}
        >
          {children?.(box)}
        </div>
      )}
    </div>
  );
});

export default VideoStage;
