/**
 * Opens the share sheet for `files`, which is where iOS offers "Save Video" /
 * "Save N Videos" to Photos. Resolves true once the user completes a share and
 * false if they dismiss the sheet. Where files can't be shared (desktop
 * browsers), downloads them instead and resolves true.
 *
 * Call it synchronously inside the tap: share() is refused once the gesture has
 * passed, so the files must already be loaded.
 */
export async function shareFiles(files: File[]): Promise<boolean> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      throw err;
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return true;
}
