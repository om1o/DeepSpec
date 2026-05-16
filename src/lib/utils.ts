export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export async function compressImageDataUrl(
  dataUrl: string,
  maxLongestEdge = 1024,
  quality = 0.8,
): Promise<string> {
  const image = await loadImage(dataUrl);
  const { width, height } = getScaledDimensions(image.width, image.height, maxLongestEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image compression.");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function getScaledDimensions(width: number, height: number, maxLongestEdge: number) {
  const scale = Math.min(1, maxLongestEdge / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read captured image."));
    image.src = dataUrl;
  });
}
