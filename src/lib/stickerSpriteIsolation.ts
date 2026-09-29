const GRID_SIZE = 4;
const ROW_BOUNDARY_SHIFT = 0.08;
const ALPHA_THRESHOLD = 1;
const MIN_COMPONENT_PIXELS = 24;

type SpriteComponent = {
  id: number;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  owner: number;
};

const sheetPromises = new Map<string, Promise<Map<string, string>>>();

function clampIndex(value: number) {
  return Math.max(0, Math.min(GRID_SIZE - 1, value));
}

function cellKey(row: number, col: number) {
  return row + ':' + col;
}

function loadSpriteImage(sheet: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('STICKER_SPRITE_LOAD_FAILED'));
    image.src = sheet;
  });
}

function componentOwner(component: SpriteComponent, width: number, height: number) {
  const cellWidth = width / GRID_SIZE;
  const cellHeight = height / GRID_SIZE;
  const centerX = component.sumX / Math.max(1, component.count);
  const centerY = component.sumY / Math.max(1, component.count);
  const col = clampIndex(Math.floor(centerX / cellWidth));
  const shiftedY = centerY + cellHeight * ROW_BOUNDARY_SHIFT;
  const row = clampIndex(Math.floor(shiftedY / cellHeight));
  return row * GRID_SIZE + col;
}

function shouldKeepComponent(component: SpriteComponent) {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  if (component.count < MIN_COMPONENT_PIXELS) return false;
  if (width <= 4 && height <= 4) return false;

  const boxArea = width * height;
  const fillRatio = component.count / Math.max(1, boxArea);
  const looksLikeTinySquareArtifact = width <= 14
    && height <= 14
    && fillRatio >= 0.72;
  return !looksLikeTinySquareArtifact;
}

function analyseComponents(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const total = width * height;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const components: SpriteComponent[] = [];
  let nextId = 0;

  const isForeground = (index: number) => pixels[index * 4 + 3] >= ALPHA_THRESHOLD;

  for (let start = 0; start < total; start += 1) {
    if (labels[start] !== 0 || !isForeground(start)) continue;

    nextId += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = nextId;

    const startX = start % width;
    const startY = Math.floor(start / width);
    const component: SpriteComponent = {
      id: nextId,
      count: 0,
      minX: startX,
      minY: startY,
      maxX: startX,
      maxY: startY,
      sumX: 0,
      sumY: 0,
      owner: -1,
    };

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      component.count += 1;
      component.sumX += x;
      component.sumY += y;
      if (x < component.minX) component.minX = x;
      if (x > component.maxX) component.maxX = x;
      if (y < component.minY) component.minY = y;
      if (y > component.maxY) component.maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbor = ny * width + nx;
          if (labels[neighbor] !== 0 || !isForeground(neighbor)) continue;
          labels[neighbor] = nextId;
          queue[tail++] = neighbor;
        }
      }
    }

    component.owner = componentOwner(component, width, height);
    components.push(component);
  }

  return { labels, components };
}

function createIsolatedCell(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  labels: Int32Array,
  components: readonly SpriteComponent[],
  row: number,
  col: number,
) {
  const owner = row * GRID_SIZE + col;
  const kept = components.filter((component) => (
    component.owner === owner && shouldKeepComponent(component)
  ));
  if (!kept.length) return '';

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const component of kept) {
    minX = Math.min(minX, component.minX);
    minY = Math.min(minY, component.minY);
    maxX = Math.max(maxX, component.maxX);
    maxY = Math.max(maxY, component.maxY);
  }

  const cellWidth = width / GRID_SIZE;
  const cellHeight = height / GRID_SIZE;
  const padX = Math.round(cellWidth * 0.055);
  const padY = Math.round(cellHeight * 0.05);
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(width - 1, maxX + padX);
  maxY = Math.min(height - 1, maxY + padY);

  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const output = document.createElement('canvas');
  output.width = cropWidth;
  output.height = cropHeight;
  const context = output.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(cropWidth, cropHeight);
  const ownerByComponent = new Int16Array(components.length + 1);
  for (const component of kept) ownerByComponent[component.id] = owner + 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sourceIndex = y * width + x;
      const componentId = labels[sourceIndex];
      if (componentId === 0 || ownerByComponent[componentId] !== owner + 1) continue;

      const sourceOffset = sourceIndex * 4;
      const targetOffset = ((y - minY) * cropWidth + (x - minX)) * 4;
      image.data[targetOffset] = sourcePixels[sourceOffset];
      image.data[targetOffset + 1] = sourcePixels[sourceOffset + 1];
      image.data[targetOffset + 2] = sourcePixels[sourceOffset + 2];
      image.data[targetOffset + 3] = sourcePixels[sourceOffset + 3];
    }
  }

  context.putImageData(image, 0, 0);
  const webp = output.toDataURL('image/webp', 0.94);
  return webp.startsWith('data:image/webp')
    ? webp
    : output.toDataURL('image/png');
}

async function isolateSheet(sheet: string) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return new Map<string, string>();
  }

  const source = await loadSpriteImage(sheet);
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!width || !height) return new Map<string, string>();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return new Map<string, string>();

  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const sourceImage = context.getImageData(0, 0, width, height);
  const { labels, components } = analyseComponents(sourceImage.data, width, height);

  const isolated = new Map<string, string>();
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const url = createIsolatedCell(
        sourceImage.data,
        width,
        height,
        labels,
        components,
        row,
        col,
      );
      if (url) isolated.set(cellKey(row, col), url);
    }
  }
  return isolated;
}

export function isolatedStickerSprite(
  sheet: string,
  row: number,
  col: number,
) {
  let promise = sheetPromises.get(sheet);
  if (!promise) {
    promise = isolateSheet(sheet).catch(() => new Map<string, string>());
    sheetPromises.set(sheet, promise);
  }
  return promise.then((result) => result.get(cellKey(row, col)));
}
