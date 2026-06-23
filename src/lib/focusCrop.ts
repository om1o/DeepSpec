type NormalizedTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const CROP_PADDING = 0.06;
const MIN_CROP_SIZE = 48;

export function createFocusedScanCrop(imageBase64: string, target: NormalizedTarget) {
  if (!isUsableTarget(target)) {
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = getImageWidth(image);
      const height = getImageHeight(image);
      if (width < MIN_CROP_SIZE || height < MIN_CROP_SIZE) {
        resolve(null);
        return;
      }

      const crop = getCropRect(target, width, height);
      if (crop.width < MIN_CROP_SIZE || crop.height < MIN_CROP_SIZE) {
        resolve(null);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = crop.width;
      canvas.height = crop.height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    image.onerror = () => resolve(null);
    image.src = imageBase64;
  });
}

function isUsableTarget(target: NormalizedTarget) {
  return (
    Number.isFinite(target.x)
    && Number.isFinite(target.y)
    && Number.isFinite(target.width)
    && Number.isFinite(target.height)
    && target.width > 0
    && target.height > 0
  );
}

function getCropRect(target: NormalizedTarget, imageWidth: number, imageHeight: number) {
  const paddedWidth = target.width * (1 + CROP_PADDING * 2);
  const paddedHeight = target.height * (1 + CROP_PADDING * 2);
  const normalizedX = clamp(target.x - target.width * CROP_PADDING, 0, 1);
  const normalizedY = clamp(target.y - target.height * CROP_PADDING, 0, 1);
  const normalizedRight = clamp(normalizedX + paddedWidth, 0, 1);
  const normalizedBottom = clamp(normalizedY + paddedHeight, 0, 1);
  const x = Math.round(normalizedX * imageWidth);
  const y = Math.round(normalizedY * imageHeight);
  const width = Math.round((normalizedRight - normalizedX) * imageWidth);
  const height = Math.round((normalizedBottom - normalizedY) * imageHeight);

  return { x, y, width, height };
}

function getImageWidth(image: HTMLImageElement) {
  return image.naturalWidth || image.width;
}

function getImageHeight(image: HTMLImageElement) {
  return image.naturalHeight || image.height;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
