/**
 * 纯函数的吸附计算，不依赖 React/DOM，便于单测。
 * 所有几何量都以“舞台像素”为单位；图层的 x/y 仍然是画布百分比，
 * 由调用方负责在像素与百分比之间换算。
 */

export type Axis = "vertical" | "horizontal";

export type Guide = {
  axis: Axis;
  /** 参考线在舞台上的像素坐标（竖线为 x，横线为 y） */
  position: number;
  /** 线段在交叉轴上的起止像素（竖线沿 y，横线沿 x） */
  start: number;
  end: number;
  kind: "center" | "third" | "edge";
};

export type StageBox = {
  /** 图层中心，舞台像素 */
  cx: number;
  cy: number;
  /** 图层包围盒宽高（已含缩放，忽略旋转），舞台像素 */
  width: number;
  height: number;
};

export type SnapInput = {
  /** 未吸附时，拖动图层中心对应的像素坐标 */
  rawX: number;
  rawY: number;
  stageWidth: number;
  stageHeight: number;
  /** 其他图层的包围盒（不含正在拖动的图层） */
  others: StageBox[];
  /** 正在拖动图层的包围盒尺寸 */
  dragWidth: number;
  dragHeight: number;
  /** 吸附阈值，舞台像素 */
  threshold: number;
};

export type SnapResult = {
  /** 吸附后的图层中心像素坐标 */
  x: number;
  y: number;
  guides: Guide[];
};

type Candidate = {
  /** 候选参考线坐标（像素） */
  line: number;
  /** 拖动图层上参与对齐的锚点坐标（像素） */
  anchor: number;
  guide: Guide;
};

const AXIS_META = {
  vertical: { center: (box: StageBox) => box.cx, span: (box: StageBox) => box.width, crossCenter: (box: StageBox) => box.cy, crossSpan: (box: StageBox) => box.height, crossSize: (input: SnapInput) => input.stageHeight, dragCrossSize: (input: SnapInput) => input.dragHeight },
  horizontal: { center: (box: StageBox) => box.cy, span: (box: StageBox) => box.height, crossCenter: (box: StageBox) => box.cx, crossSpan: (box: StageBox) => box.width, crossSize: (input: SnapInput) => input.stageWidth, dragCrossSize: (input: SnapInput) => input.dragWidth }
} as const;

const buildCandidates = (axis: Axis, input: SnapInput): Candidate[] => {
  const { stageWidth, stageHeight, others, threshold } = input;
  const meta = AXIS_META[axis];
  const stageSize = axis === "vertical" ? stageWidth : stageHeight;
  const rawCenter = axis === "vertical" ? input.rawX : input.rawY;
  const dragSize = axis === "vertical" ? input.dragWidth : input.dragHeight;
  const rawCrossCenter = axis === "vertical" ? input.rawY : input.rawX;
  const dragCrossSize = meta.dragCrossSize(input);
  const candidates: Candidate[] = [];

  // —— 画布参考线：中心线（仅中心对齐）+ 两条三分线（三个锚点都可对齐）——
  const canvasLines: { position: number; kind: Guide["kind"] }[] = [
    { position: stageSize / 2, kind: "center" },
    { position: stageSize / 3, kind: "third" },
    { position: (stageSize * 2) / 3, kind: "third" }
  ];
  canvasLines.forEach(({ position, kind }) => {
    const anchors = kind === "center" ? [rawCenter] : [rawCenter - dragSize / 2, rawCenter, rawCenter + dragSize / 2];
    anchors.forEach((anchor) => {
      // 画布级参考线贯穿整个舞台
      candidates.push({ line: position, anchor, guide: { axis, position, start: 0, end: meta.crossSize(input), kind } });
    });
  });

  // —— 其他元素：左/上边缘、中心、右/下边缘，与拖动图层的三个锚点逐一配对 ——
  others.forEach((box) => {
    const center = meta.center(box);
    const half = meta.span(box) / 2;
    const edgePositions = [center - half, center, center + half];
    // 参考线在交叉轴上覆盖两个盒子的并集范围
    const dragCrossMin = rawCrossCenter - dragCrossSize / 2;
    const dragCrossMax = rawCrossCenter + dragCrossSize / 2;
    const otherCrossMin = meta.crossCenter(box) - meta.crossSpan(box) / 2;
    const otherCrossMax = meta.crossCenter(box) + meta.crossSpan(box) / 2;
    const start = Math.max(0, Math.min(dragCrossMin, otherCrossMin));
    const end = Math.min(meta.crossSize(input), Math.max(dragCrossMax, otherCrossMax));
    edgePositions.forEach((position) => {
      [rawCenter - dragSize / 2, rawCenter, rawCenter + dragSize / 2].forEach((anchor) => {
        candidates.push({ line: position, anchor, guide: { axis, position, start, end, kind: "edge" } });
      });
    });
  });

  return candidates.filter((candidate) => Math.abs(candidate.line - candidate.anchor) <= threshold);
};

const pickNearest = (candidates: Candidate[]): Candidate | null => {
  let nearest: Candidate | null = null;
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate.line - candidate.anchor);
    if (!nearest || distance < Math.abs(nearest.line - nearest.anchor)) {
      nearest = candidate;
    }
  });
  return nearest;
};

export function computeSnap(input: SnapInput): SnapResult {
  const { rawX, rawY } = input;
  let x = rawX;
  let y = rawY;
  const guides: Guide[] = [];

  // 垂直参考线（影响 x）：每帧重新挑选最近目标，连续拖动不会粘在旧目标上
  const vertical = pickNearest(buildCandidates("vertical", input));
  if (vertical) {
    x = rawX + (vertical.line - vertical.anchor);
    guides.push(vertical.guide);
  }

  // 水平参考线（影响 y）
  const horizontal = pickNearest(buildCandidates("horizontal", input));
  if (horizontal) {
    y = rawY + (horizontal.line - horizontal.anchor);
    guides.push(horizontal.guide);
  }

  return { x, y, guides };
}

/** 百分比坐标（0-100）夹在允许的画布范围内，避免元素被完全拖出画布 */
export const clampPercent = (value: number) => Math.min(94, Math.max(6, value));
