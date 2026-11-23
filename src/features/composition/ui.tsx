import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Minus, Plus, RotateCcw, Type } from "lucide-react";
import { presets } from "@/shared/defaults";
import type { BackgroundAsset, CanvasSize, Layer, Preset } from "@/shared/types";
import { clampPercent, computeSnap, type Guide, type StageBox } from "./snapping";

type StageProps = { background: BackgroundAsset; canvas: CanvasSize; layers: Layer[]; selectedId: string | null; onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Layer>) => void };

const SNAP_THRESHOLD = 8;

export function CanvasStage({ background, canvas, layers, selectedId, onSelect, onChange }: StageProps) {
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const [guides, setGuides] = useState<Guide[]>([]);
  // 保存当前拖动的监听函数，便于组件卸载时兜底清理
  const activeDrag = useRef<{ cancel: () => void } | null>(null);

  // 预设/画布比例切换后，旧参考线立即失效，新参考线按新比例重新计算
  useEffect(() => {
    setGuides([]);
  }, [canvas.id, canvas.width, canvas.height]);

  // 卸载时保证不会残留 window 监听与参考线
  useEffect(() => () => {
    activeDrag.current?.cancel();
    activeDrag.current = null;
  }, []);

  const move = (event: React.PointerEvent<HTMLDivElement>, layer: Layer) => {
    if (layer.kind === "text" && event.button !== 0) return;
    const target = event.currentTarget.closest(".canvas-stage") as HTMLDivElement | null;
    if (!target) return;
    event.preventDefault();
    const stageRect = target.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { x: layer.x, y: layer.y };

    // 拖动开始时快照所有元素的包围盒（含缩放、忽略旋转）。
    // 吸附只改位置，缩放/旋转/层级在整个拖动过程中保持不变，因此快照始终有效。
    const measureBox = (item: Layer): StageBox => {
      const node = layerRefs.current.get(item.id);
      const width = (node?.offsetWidth ?? 0) * item.scale;
      const height = (node?.offsetHeight ?? 0) * item.scale;
      return { cx: (item.x / 100) * stageRect.width, cy: (item.y / 100) * stageRect.height, width, height };
    };
    const others = layers.filter((item) => item.id !== layer.id).map(measureBox);
    const dragBox = measureBox(layer);

    const handleMove = (moveEvent: PointerEvent) => {
      // 每帧重新读取尺寸：拖动过程中若画布比例变化（预设切换/窗口缩放），坐标映射仍正确
      const rect = target.getBoundingClientRect();
      // 未吸附的原始中心位置（像素）
      const rawX = (start.x / 100) * rect.width + (moveEvent.clientX - startX);
      const rawY = (start.y / 100) * rect.height + (moveEvent.clientY - startY);
      const result = computeSnap({
        rawX,
        rawY,
        stageWidth: rect.width,
        stageHeight: rect.height,
        others,
        dragWidth: dragBox.width,
        dragHeight: dragBox.height,
        threshold: SNAP_THRESHOLD
      });
      // 仅写回位置，缩放、旋转、层级一律不碰
      onChange(layer.id, {
        x: clampPercent((result.x / rect.width) * 100),
        y: clampPercent((result.y / rect.height) * 100)
      });
      setGuides(result.guides);
    };
    const finish = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      activeDrag.current = null;
      // 松开指针后清除全部辅助线，状态不会残留，也不会进入导出图
      setGuides([]);
    };
    activeDrag.current = { cancel: finish };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return <div className="canvas-stage" style={{ background: background.style, aspectRatio: `${canvas.width} / ${canvas.height}`, width: `min(100%, 620px, calc(min(78vh, 760px) * ${canvas.width} / ${canvas.height}))` }}>
    <div className="grain" />
    {layers.map((layer) => <div key={layer.id} ref={(node) => { if (node) layerRefs.current.set(layer.id, node); else layerRefs.current.delete(layer.id); }} className={`canvas-layer ${layer.kind} ${selectedId === layer.id ? "selected" : ""}`} onPointerDown={(event) => { onSelect(layer.id); move(event, layer); }} style={{ left: `${layer.x}%`, top: `${layer.y}%`, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`, color: layer.color, fontSize: `${layer.fontSize}px`, opacity: layer.opacity }}>{layer.content}<span className="layer-handle" /></div>)}
    <div className="snap-guide-layer" aria-hidden="true">
      {guides.map((guide, index) => <div key={`${guide.axis}-${guide.kind}-${index}`} className={`snap-guide ${guide.axis} ${guide.kind}`} style={guide.axis === "vertical" ? { left: guide.position, top: guide.start, height: Math.max(guide.end - guide.start, 1) } : { top: guide.position, left: guide.start, width: Math.max(guide.end - guide.start, 1) }} />)}
    </div>
    <div className="stage-caption"><span>LIVE CANVAS</span><span>{canvas.width} × {canvas.height}</span></div>
  </div>;
}

type LayerPanelProps = { layers: Layer[]; selectedId: string | null; onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Layer>) => void; onRemove: () => void; onAddText: () => void; onMove: (direction: "up" | "down") => void };

export function LayerPanel({ layers, selectedId, onSelect, onChange, onRemove, onAddText, onMove }: LayerPanelProps) {
  const selected = layers.find((layer) => layer.id === selectedId);
  return <aside className="side-panel layer-panel">
    <div className="panel-heading"><div><span className="eyebrow">02 / COMPOSITION</span><h2>图层</h2></div><GripVertical size={17} /></div>
    <div className="layer-list">{layers.map((layer, index) => <button key={layer.id} className={`layer-row ${selectedId === layer.id ? "active" : ""}`} onClick={() => onSelect(layer.id)}><span className="layer-index">{String(index + 1).padStart(2, "0")}</span><span className="layer-icon">{layer.kind === "text" ? <Type size={15} /> : <span>{layer.content}</span>}</span><span className="layer-name">{layer.name}</span><span className="layer-drag">⠿</span></button>)}</div>
    <button className="add-text" onClick={onAddText}><Plus size={15} />添加文字层</button>
    {selected && <div className="inspector">
      <div className="inspector-heading"><span>选中元素</span><button className="icon-button" onClick={onRemove} aria-label="删除选中层"><Minus size={16} /></button></div>
      {selected.kind === "text" && <label className="field-label">文案<input value={selected.content} onChange={(event) => onChange(selected.id, { content: event.target.value })} /></label>}
      <label className="field-label">缩放 <span>{Math.round(selected.scale * 100)}%</span><input type="range" min="0.5" max="2" step="0.05" value={selected.scale} onChange={(event) => onChange(selected.id, { scale: Number(event.target.value) })} /></label>
      <label className="field-label">旋转 <span>{selected.rotation}°</span><input type="range" min="-30" max="30" step="1" value={selected.rotation} onChange={(event) => onChange(selected.id, { rotation: Number(event.target.value) })} /></label>
      <div className="move-actions"><button className="small-button" onClick={() => onMove("up")}><ArrowUp size={14} />上移</button><button className="small-button" onClick={() => onMove("down")}><ArrowDown size={14} />下移</button><button className="small-button" onClick={() => onChange(selected.id, { rotation: 0 })}><RotateCcw size={14} />复位角度</button></div>
    </div>}
  </aside>;
}

type PresetStripProps = { activeId: string; onApply: (preset: Preset) => void };

export function PresetStrip({ activeId, onApply }: PresetStripProps) {
  return <section className="preset-strip"><div className="section-label"><span>版式预设</span><span className="muted">保留内容，更新构图</span></div><div className="preset-list">{presets.map((preset) => <button key={preset.id} className={`preset-card ${activeId === preset.id ? "active" : ""}`} onClick={() => onApply(preset)}><span className="preset-preview" style={{ background: preset.id === "headline" ? "linear-gradient(150deg,#42225f,#e17061)" : preset.id === "editorial" ? "linear-gradient(150deg,#604b38,#e4c58f)" : "linear-gradient(150deg,#1d6d68,#d5e9a2)" }}><span /><span /><span /></span><span className="preset-copy"><strong>{preset.label}</strong><small>{preset.description}</small></span><Copy size={14} /></button>)}</div></section>;
}

export function applyPreset(layers: Layer[], preset: Preset) {
  return layers.map((layer, index) => {
    const position = preset.positions[index % preset.positions.length];
    return { ...layer, ...position };
  });
}
