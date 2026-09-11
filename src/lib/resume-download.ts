type ResumePayload = {
  base64: string;
  contentType: string;
  filename: string;
};

/** Save server-delivered private CV bytes without navigating to the vault host. */
export function downloadResume(payload: ResumePayload) {
  const binary = window.atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: payload.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
