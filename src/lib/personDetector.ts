import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import modelUrl from "../assets/models/efficientdet_lite2_int8.tflite?url";

/** A detected person, in pixels of the image passed to `detect`. */
export interface PersonBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface PersonDetector {
  detect(source: HTMLCanvasElement): PersonBox[];
  close(): void;
}

/**
 * Loads the on-device person detector. The library is imported dynamically so
 * it's only downloaded and parsed when auto-tracking is used. Its wasm and the
 * model are self-hosted (precached by the service worker) so this works offline.
 */
export async function loadPersonDetector(): Promise<PersonDetector> {
  const { ObjectDetector } = await import("@mediapipe/tasks-vision");
  const detector = await ObjectDetector.createFromOptions(
    // Only the SIMD build is shipped; WebKit has supported wasm SIMD since 16.4.
    { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
    {
      baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
      // Without an explicit canvas MediaPipe creates its own WebGL context, which
      // has been reported to fail on iOS even with the CPU delegate (mediapipe#4499).
      canvas: document.createElement("canvas"),
      runningMode: "IMAGE",
      categoryAllowlist: ["person"],
      scoreThreshold: 0.25,
      maxResults: 20,
    },
  );
  return {
    detect(source) {
      return detector.detect(source).detections.flatMap((d) =>
        d.boundingBox
          ? [
              {
                x: d.boundingBox.originX,
                y: d.boundingBox.originY,
                w: d.boundingBox.width,
                h: d.boundingBox.height,
                score: d.categories[0]?.score ?? 0,
              },
            ]
          : [],
      );
    },
    close() {
      detector.close();
    },
  };
}
