export type ObjectTargetBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type DetectionCell = {
  column: number;
  row: number;
  saliency: number;
};

type Component = {
  cells: DetectionCell[];
  maxColumn: number;
  maxRow: number;
  minColumn: number;
  minRow: number;
  saliency: number;
};

const GRID_COLUMNS = 24;
const GRID_ROWS = 18;
const MIN_COMPONENT_CELLS = 3;
const MIN_CONFIDENCE = 0.22;

export function detectObjectTargetFromImageData(imageData: ImageData): ObjectTargetBox | null {
  const cells = buildSaliencyGrid(imageData);
  if (cells.length === 0) {
    return null;
  }

  const threshold = getSaliencyThreshold(cells);
  const activeCells = cells.filter((cell) => isTargetCandidate(cell, threshold));
  const components = getComponents(activeCells);
  const best = components
    .map(scoreComponent)
    .filter((component) => component.target.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score)[0];

  return best?.target ?? null;
}

function buildSaliencyGrid(imageData: ImageData) {
  const cellWidth = Math.max(1, Math.floor(imageData.width / GRID_COLUMNS));
  const cellHeight = Math.max(1, Math.floor(imageData.height / GRID_ROWS));
  const brightness = new Array<number>(GRID_COLUMNS * GRID_ROWS).fill(0);
  const variance = new Array<number>(GRID_COLUMNS * GRID_ROWS).fill(0);
  const saturation = new Array<number>(GRID_COLUMNS * GRID_ROWS).fill(0);

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const stats = getCellStats(imageData, column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      const index = getIndex(column, row);
      brightness[index] = stats.mean;
      variance[index] = stats.variance;
      saturation[index] = stats.saturation;
    }
  }

  return brightness.map((mean, index) => {
    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const gradient = getCellGradient(brightness, column, row);
    const texture = Math.min(1, variance[index] / 1800);
    const color = Math.min(1, saturation[index] / 0.32);

    return {
      column,
      row,
      saliency: texture * 0.55 + gradient * 0.35 + color * 0.1 + mean / 255 * 0.02,
    };
  });
}

function getCellStats(imageData: ImageData, startX: number, startY: number, width: number, height: number) {
  let count = 0;
  let sum = 0;
  let sumSquared = 0;
  let saturation = 0;
  const stepX = Math.max(1, Math.floor(width / 4));
  const stepY = Math.max(1, Math.floor(height / 4));

  for (let y = startY; y < Math.min(imageData.height, startY + height); y += stepY) {
    for (let x = startX; x < Math.min(imageData.width, startX + width); x += stepX) {
      const index = (y * imageData.width + x) * 4;
      const red = imageData.data[index] ?? 0;
      const green = imageData.data[index + 1] ?? 0;
      const blue = imageData.data[index + 2] ?? 0;
      const value = red * 0.299 + green * 0.587 + blue * 0.114;
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);

      sum += value;
      sumSquared += value * value;
      saturation += high === 0 ? 0 : (high - low) / high;
      count += 1;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  return {
    mean,
    saturation: count > 0 ? saturation / count : 0,
    variance: count > 0 ? sumSquared / count - mean * mean : 0,
  };
}

function getCellGradient(brightness: number[], column: number, row: number) {
  const current = brightness[getIndex(column, row)] ?? 0;
  const neighbors = [
    getBrightness(brightness, column - 1, row),
    getBrightness(brightness, column + 1, row),
    getBrightness(brightness, column, row - 1),
    getBrightness(brightness, column, row + 1),
  ].filter((value): value is number => typeof value === "number");

  if (neighbors.length === 0) {
    return 0;
  }

  const gradient = neighbors.reduce((sum, value) => sum + Math.abs(current - value), 0) / neighbors.length;
  return Math.min(1, gradient / 90);
}

function getBrightness(brightness: number[], column: number, row: number) {
  if (column < 0 || column >= GRID_COLUMNS || row < 0 || row >= GRID_ROWS) {
    return undefined;
  }

  return brightness[getIndex(column, row)];
}

function getSaliencyThreshold(cells: DetectionCell[]) {
  const values = cells.map((cell) => cell.saliency);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.max(0.12, mean + Math.sqrt(variance) * 0.45);
}

function isTargetCandidate(cell: DetectionCell, threshold: number) {
  const normalizedY = (cell.row + 0.5) / GRID_ROWS;
  return cell.saliency >= threshold && normalizedY > 0.14 && normalizedY < 0.9;
}

function getComponents(activeCells: DetectionCell[]) {
  const byKey = new Map(activeCells.map((cell) => [getKey(cell.column, cell.row), cell]));
  const visited = new Set<string>();
  const components: Component[] = [];

  for (const cell of activeCells) {
    const startKey = getKey(cell.column, cell.row);
    if (visited.has(startKey)) continue;

    const queue = [cell];
    const cells: DetectionCell[] = [];
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      cells.push(current);

      for (const [column, row] of getNeighbors(current.column, current.row)) {
        const key = getKey(column, row);
        const next = byKey.get(key);
        if (next && !visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }

    if (cells.length >= MIN_COMPONENT_CELLS) {
      components.push(toComponent(cells));
    }
  }

  return components;
}

function toComponent(cells: DetectionCell[]): Component {
  return cells.reduce<Component>(
    (component, cell) => ({
      cells: component.cells.concat(cell),
      maxColumn: Math.max(component.maxColumn, cell.column),
      maxRow: Math.max(component.maxRow, cell.row),
      minColumn: Math.min(component.minColumn, cell.column),
      minRow: Math.min(component.minRow, cell.row),
      saliency: component.saliency + cell.saliency,
    }),
    {
      cells: [],
      maxColumn: 0,
      maxRow: 0,
      minColumn: GRID_COLUMNS - 1,
      minRow: GRID_ROWS - 1,
      saliency: 0,
    },
  );
}

function scoreComponent(component: Component) {
  const paddingColumns = 1;
  const paddingRows = 1;
  const minColumn = Math.max(0, component.minColumn - paddingColumns);
  const minRow = Math.max(0, component.minRow - paddingRows);
  const maxColumn = Math.min(GRID_COLUMNS - 1, component.maxColumn + paddingColumns);
  const maxRow = Math.min(GRID_ROWS - 1, component.maxRow + paddingRows);
  const width = (maxColumn - minColumn + 1) / GRID_COLUMNS;
  const height = (maxRow - minRow + 1) / GRID_ROWS;
  const centerX = minColumn / GRID_COLUMNS + width / 2;
  const centerY = minRow / GRID_ROWS + height / 2;
  const distanceFromCenter = Math.hypot(centerX - 0.5, centerY - 0.5);
  const centerScore = 1 - Math.min(1, distanceFromCenter / 0.58);
  const sizeScore = Math.min(1, Math.sqrt(component.cells.length) / 7);
  const saliencyScore = Math.min(1, component.saliency / component.cells.length);
  const confidence = clamp(sizeScore * 0.35 + centerScore * 0.3 + saliencyScore * 0.35);

  return {
    score: confidence + centerScore * 0.12,
    target: {
      x: minColumn / GRID_COLUMNS,
      y: minRow / GRID_ROWS,
      width: Math.max(0.16, width),
      height: Math.max(0.16, height),
      confidence,
    },
  };
}

function getNeighbors(column: number, row: number) {
  return [
    [column - 1, row],
    [column + 1, row],
    [column, row - 1],
    [column, row + 1],
  ];
}

function getIndex(column: number, row: number) {
  return row * GRID_COLUMNS + column;
}

function getKey(column: number, row: number) {
  return `${column}:${row}`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
