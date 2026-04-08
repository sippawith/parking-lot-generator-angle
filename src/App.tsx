/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { generateParkingLayout, ParkingConfig, ParkingSpot } from './lib/parking-algo';
import { MousePointer2, Square, Hexagon, Trash2, Settings, Play, Hand, Ruler, ZoomIn, ZoomOut, Save, CheckCircle2, X, Globe } from 'lucide-react';
import { cn } from './lib/utils';

type DrawMode = 'idle' | 'polygon' | 'rectangle' | 'pan' | 'ruler';
type Language = 'en' | 'th';

const t = {
  en: {
    title: 'ParkOptima',
    subtitle: 'Generate optimized parking layouts',
    autoOptimize: 'Auto-Optimize',
    maxCapacity: 'Max Capacity',
    easiestToPark: 'Easiest to Park',
    applyLayout: 'Apply Layout',
    spots: 'spots',
    drawingTools: 'Drawing Tools',
    pan: 'Pan',
    freeform: 'Freeform',
    rectangle: 'Rectangle',
    measure: 'Measure',
    panDesc: 'Click and drag to pan. Scroll to zoom.',
    freeformDesc: 'Click to add points. Double-click to finish.',
    rectDesc: 'Click anywhere on canvas to place rectangle.',
    measureDesc: 'Click to measure. Snaps to corners. Press Esc to cancel.',
    config: 'Configuration',
    angle: 'Angle',
    layoutType: 'Layout Type',
    perimeterAisle: 'Perimeter Aisle',
    deadEnd: 'One-way In/Out',
    partialTurnaround: 'Partial Turnaround',
    spotWidth: 'Spot Width (m)',
    spotLength: 'Spot Length (m)',
    aisleWidth: 'Aisle Width (m)',
    savedVersions: 'Saved Versions',
    versionName: 'Version name...',
    totalSpots: 'Total Spots:',
    clearCanvas: 'Clear Canvas',
    readyToDraw: 'Ready to Draw',
    selectTool: 'Select a drawing tool from the sidebar to begin',
  },
  th: {
    title: 'ParkOptima',
    subtitle: 'สร้างแบบแปลนที่จอดรถอัตโนมัติ',
    autoOptimize: 'ปรับแต่งอัตโนมัติ',
    maxCapacity: 'ความจุสูงสุด',
    easiestToPark: 'จอดง่ายที่สุด',
    applyLayout: 'ใช้รูปแบบนี้',
    spots: 'คัน',
    drawingTools: 'เครื่องมือวาด',
    pan: 'เลื่อน',
    freeform: 'วาดอิสระ',
    rectangle: 'สี่เหลี่ยม',
    measure: 'วัดระยะ',
    panDesc: 'คลิกและลากเพื่อเลื่อน เลื่อนลูกกลิ้งเมาส์เพื่อซูม',
    freeformDesc: 'คลิกเพื่อเพิ่มจุด ดับเบิลคลิกเพื่อเสร็จสิ้น',
    rectDesc: 'คลิกที่ใดก็ได้บนผืนผ้าใบเพื่อวางสี่เหลี่ยม',
    measureDesc: 'คลิกเพื่อวัดระยะ จะดูดติดมุม กด Esc เพื่อยกเลิก',
    config: 'การตั้งค่า',
    angle: 'มุมจอดรถ',
    layoutType: 'รูปแบบการจอด',
    perimeterAisle: 'มีทางเดินรถล้อมรอบ',
    deadEnd: 'เข้า-ออกทางเดียว',
    partialTurnaround: 'มีทางวนรถบางที่',
    spotWidth: 'ความกว้างช่องจอด (ม.)',
    spotLength: 'ความยาวช่องจอด (ม.)',
    aisleWidth: 'ความกว้างทางเดินรถ (ม.)',
    savedVersions: 'เวอร์ชันที่บันทึกไว้',
    versionName: 'ชื่อเวอร์ชัน...',
    totalSpots: 'จำนวนที่จอดรถทั้งหมด:',
    clearCanvas: 'ล้างผืนผ้าใบ',
    readyToDraw: 'พร้อมวาด',
    selectTool: 'เลือกเครื่องมือวาดจากแถบด้านข้างเพื่อเริ่มต้น',
  }
};

interface SavedVersion {
  id: string;
  name: string;
  boundary: [number, number][];
  config: ParkingConfig;
  spotsCount: number;
  area: number;
  efficiency: number;
}

interface Recommendation {
  config: ParkingConfig;
  spotsCount: number;
}

export default function App() {
  const [lang, setLang] = useState<Language>('en');
  const [mode, setMode] = useState<DrawMode>('idle');
  const [points, setPoints] = useState<[number, number][]>([]);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);
  const [boundary, setBoundary] = useState<[number, number][] | null>(null);
  
  const [rectWidth, setRectWidth] = useState(50);
  const [rectLength, setRectLength] = useState(100);

  const [config, setConfig] = useState<ParkingConfig>({
    angle: 90,
    type: 'dead_end',
    spotWidth: 2.5,
    spotLength: 5.0,
    aisleWidth: 6.0,
  });

  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Ruler state
  const [measurements, setMeasurements] = useState<{id: string, start: [number, number], end: [number, number]}[]>([]);
  const [activeRulerStart, setActiveRulerStart] = useState<[number, number] | null>(null);
  const [snapPoint, setSnapPoint] = useState<[number, number] | null>(null);

  // Versioning state
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [versionName, setVersionName] = useState('');

  // Zoom and Pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);

  // Scale factor: 1 meter = 10 pixels for rendering
  const SCALE = 10;

  const getArea = (boundaryPts: [number, number][]) => {
    if (!boundaryPts || boundaryPts.length < 3) return 0;
    let area = 0;
    const pts = boundaryPts.map(p => [p[0] / SCALE, p[1] / SCALE]);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i][0] * pts[j][1];
      area -= pts[j][0] * pts[i][1];
    }
    return Math.abs(area / 2);
  };

  const recommendations = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    const boundaryMeters = boundary.map(p => [p[0] / SCALE, p[1] / SCALE] as [number, number]);
    
    let maxCap: Recommendation | null = null;
    let easiest: Recommendation | null = null;

    const angles = [30, 45, 60, 75, 90];
    const types: ParkingConfig['type'][] = ['perimeter_aisle', 'dead_end', 'partial_turnaround'];

    angles.forEach(angle => {
      types.forEach(type => {
        let aisleWidth = 6.0;
        if (angle === 30) aisleWidth = 3.5;
        if (angle === 45) aisleWidth = 4.0;
        if (angle === 60) aisleWidth = 5.0;
        if (angle === 75) aisleWidth = 5.5;
        if (angle === 90) aisleWidth = 6.0;

        const testConfig: ParkingConfig = {
          angle, type, aisleWidth,
          spotWidth: config.spotWidth,
          spotLength: config.spotLength
        };

        const testSpots = generateParkingLayout(boundaryMeters, testConfig).filter(s => !s.isAisle);
        const count = testSpots.length;

        if (!maxCap || count > maxCap.spotsCount) {
          maxCap = { config: testConfig, spotsCount: count };
        }

        if (angle === 45 || angle === 60) {
          if (!easiest || count > easiest.spotsCount) {
            easiest = { config: testConfig, spotsCount: count };
          }
        }
      });
    });

    return { maxCapacity: maxCap, easiestToPark: easiest };
  }, [boundary, config.spotWidth, config.spotLength]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveRulerStart(null);
        setPoints([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (boundary) {
      const boundaryMeters = boundary.map(p => [p[0] / SCALE, p[1] / SCALE] as [number, number]);
      const generatedSpots = generateParkingLayout(boundaryMeters, config);
      setSpots(generatedSpots);
    } else {
      setSpots([]);
    }
  }, [boundary, config]);

  // Handle Zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleAdjust = e.deltaY > 0 ? 0.9 : 1.1;
      
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform(prev => {
        const newScale = Math.max(0.1, Math.min(prev.scale * scaleAdjust, 10));
        const actualAdjust = newScale / prev.scale;
        const dx = (mouseX - prev.x) * (1 - actualAdjust);
        const dy = (mouseY - prev.y) * (1 - actualAdjust);
        return {
          x: prev.x + dx,
          y: prev.y + dy,
          scale: newScale
        };
      });
    };
    
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  const getSvgCoords = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    return {
      x: (rawX - transform.x) / transform.scale,
      y: (rawY - transform.y) / transform.scale
    };
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === 'pan' || e.button === 1) {
      setIsDragging(true);
      setHasDragged(false);
      setLastPanPos({ x: e.clientX, y: e.clientY });
    } else {
      setHasDragged(false);
    }
  };

  const getSnapPoint = (x: number, y: number) => {
    const snapThreshold = 15 / transform.scale;
    let closestDist = snapThreshold;
    let closestPt: [number, number] | null = null;

    const checkPoint = (px: number, py: number) => {
      const dist = Math.hypot(px - x, py - y);
      if (dist < closestDist) {
        closestDist = dist;
        closestPt = [px, py];
      }
    };

    if (boundary) {
      boundary.forEach(p => checkPoint(p[0], p[1]));
    }
    spots.forEach(spot => {
      spot.corners.forEach(p => checkPoint(p[0] * SCALE, p[1] * SCALE));
    });

    return closestPt;
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging) {
      setHasDragged(true);
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }

    const { x, y } = getSvgCoords(e);

    if (mode === 'ruler') {
      const snapped = getSnapPoint(x, y);
      setSnapPoint(snapped);
      setMousePos(snapped || [x, y]);
    } else if (mode === 'polygon' && points.length > 0) {
      setMousePos([x, y]);
    } else {
      setMousePos(null);
      setSnapPoint(null);
    }
  };

  const handleSvgMouseUp = () => {
    setIsDragging(false);
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === 'idle' || mode === 'pan' || hasDragged) return;

    const { x, y } = getSvgCoords(e);

    if (mode === 'ruler') {
      const pt = snapPoint || [x, y];
      if (!activeRulerStart) {
        setActiveRulerStart(pt);
      } else {
        setMeasurements(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), start: activeRulerStart, end: pt }]);
        setActiveRulerStart(null);
      }
    } else if (mode === 'polygon') {
      setPoints(prev => [...prev, [x, y]]);
    } else if (mode === 'rectangle') {
      const w = rectWidth * SCALE;
      const h = rectLength * SCALE;
      const newBoundary: [number, number][] = [
        [x - w / 2, y - h / 2],
        [x + w / 2, y - h / 2],
        [x + w / 2, y + h / 2],
        [x - w / 2, y + h / 2],
      ];
      setBoundary(newBoundary);
      setMode('idle');
    }
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === 'polygon' && points.length >= 3) {
      setBoundary([...points]);
      setPoints([]);
      setMousePos(null);
      setMode('idle');
    }
  };

  const handleClear = () => {
    setBoundary(null);
    setPoints([]);
    setSpots([]);
    setMeasurements([]);
    setActiveRulerStart(null);
    setMode('idle');
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const handleZoomIn = () => setTransform(p => ({ ...p, scale: Math.min(p.scale * 1.2, 10) }));
  const handleZoomOut = () => setTransform(p => ({ ...p, scale: Math.max(p.scale / 1.2, 0.1) }));

  const removeMeasurement = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMeasurements(prev => prev.filter(m => m.id !== id));
  };

  const handleSaveVersion = () => {
    if (!boundary) return;
    const area = getArea(boundary);
    const spotsCount = spots.filter(s => !s.isAisle).length;
    const eff = area > 0 ? (spotsCount / area) * 1000 : 0;
    
    const newVersion: SavedVersion = {
      id: Math.random().toString(36).substr(2, 9),
      name: versionName || `Option ${versions.length + 1}`,
      boundary: [...boundary],
      config: { ...config },
      spotsCount,
      area,
      efficiency: eff
    };
    setVersions(prev => [...prev, newVersion]);
    setVersionName('');
  };

  const handleRestore = (v: SavedVersion) => {
    setBoundary(v.boundary);
    setConfig(v.config);
  };

  const handleAngleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const angle = parseInt(e.target.value);
    let aisleWidth = 6.0;
    if (angle === 30) aisleWidth = 3.5;
    if (angle === 45) aisleWidth = 4.0;
    if (angle === 60) aisleWidth = 5.0;
    if (angle === 75) aisleWidth = 5.5;
    if (angle === 90) aisleWidth = 6.0;

    setConfig(prev => ({ ...prev, angle, aisleWidth }));
  };

  return (
    <div className="flex h-screen w-full bg-gray-50 font-sans text-gray-900">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100 relative">
          <button 
            onClick={() => setLang(l => l === 'en' ? 'th' : 'en')}
            className="absolute top-6 right-6 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            title="Toggle Language"
          >
            <Globe className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            {t[lang].title}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t[lang].subtitle}</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8">
          {/* Optimization Panel */}
          {boundary && recommendations && (
            <section className="space-y-3 bg-blue-50 p-4 rounded-xl border border-blue-100">
              <h2 className="text-xs font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> {t[lang].autoOptimize}
              </h2>
              
              {recommendations.maxCapacity && (
                <div className="bg-white p-3 rounded-lg shadow-sm border border-blue-100">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{t[lang].maxCapacity}</p>
                      <p className="text-xs text-gray-500">{recommendations.maxCapacity.config.angle}° • {
                        recommendations.maxCapacity.config.type === 'perimeter_aisle' ? t[lang].perimeterAisle :
                        recommendations.maxCapacity.config.type === 'dead_end' ? t[lang].deadEnd : t[lang].partialTurnaround
                      }</p>
                    </div>
                    <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded-full">{recommendations.maxCapacity.spotsCount} {t[lang].spots}</span>
                  </div>
                  <button 
                    onClick={() => setConfig(recommendations.maxCapacity!.config)}
                    className="w-full text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 py-1.5 rounded transition-colors"
                  >
                    {t[lang].applyLayout}
                  </button>
                </div>
              )}

              {recommendations.easiestToPark && (
                <div className="bg-white p-3 rounded-lg shadow-sm border border-blue-100">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{t[lang].easiestToPark}</p>
                      <p className="text-xs text-gray-500">{recommendations.easiestToPark.config.angle}° • {
                        recommendations.easiestToPark.config.type === 'perimeter_aisle' ? t[lang].perimeterAisle :
                        recommendations.easiestToPark.config.type === 'dead_end' ? t[lang].deadEnd : t[lang].partialTurnaround
                      }</p>
                    </div>
                    <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded-full">{recommendations.easiestToPark.spotsCount} {t[lang].spots}</span>
                  </div>
                  <button 
                    onClick={() => setConfig(recommendations.easiestToPark!.config)}
                    className="w-full text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 py-1.5 rounded transition-colors"
                  >
                    {t[lang].applyLayout}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Drawing Tools */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t[lang].drawingTools}</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setMode('pan'); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'pan' ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Hand className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">{t[lang].pan}</span>
              </button>
              <button
                onClick={() => { setMode('polygon'); setPoints([]); setBoundary(null); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'polygon' ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Hexagon className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">{t[lang].freeform}</span>
              </button>
              <button
                onClick={() => { setMode('rectangle'); setBoundary(null); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'rectangle' ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Square className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">{t[lang].rectangle}</span>
              </button>
              <button
                onClick={() => { setMode('ruler'); setActiveRulerStart(null); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'ruler' ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Ruler className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">{t[lang].measure}</span>
              </button>
            </div>
            {mode === 'pan' && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                {t[lang].panDesc}
              </p>
            )}
            {mode === 'polygon' && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                {t[lang].freeformDesc}
              </p>
            )}
            {mode === 'rectangle' && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                {t[lang].rectDesc}
              </p>
            )}
            {mode === 'ruler' && (
              <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                {t[lang].measureDesc}
              </p>
            )}
          </section>

          {/* Rectangle Dimensions */}
          <section className={cn("space-y-3 transition-opacity", mode === 'rectangle' ? "opacity-100" : "opacity-50 pointer-events-none")}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Rectangle Size (m)</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Width</label>
                <input
                  type="number"
                  value={rectWidth}
                  onChange={e => setRectWidth(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Length</label>
                <input
                  type="number"
                  value={rectLength}
                  onChange={e => setRectLength(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* Parking Configuration */}
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t[lang].config}</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t[lang].angle}</label>
              <select
                value={config.angle}
                onChange={handleAngleChange}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value={30}>30°</option>
                <option value={45}>45°</option>
                <option value={60}>60°</option>
                <option value={75}>75°</option>
                <option value={90}>90°</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t[lang].layoutType}</label>
              <select
                value={config.type}
                onChange={e => setConfig(prev => ({ ...prev, type: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="perimeter_aisle">{t[lang].perimeterAisle}</option>
                <option value="dead_end">{t[lang].deadEnd}</option>
                <option value="partial_turnaround">{t[lang].partialTurnaround}</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t[lang].spotWidth}</label>
                <input
                  type="number"
                  step="0.1"
                  value={config.spotWidth}
                  onChange={e => setConfig(prev => ({ ...prev, spotWidth: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t[lang].spotLength}</label>
                <input
                  type="number"
                  step="0.1"
                  value={config.spotLength}
                  onChange={e => setConfig(prev => ({ ...prev, spotLength: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t[lang].aisleWidth}</label>
              <input
                type="number"
                step="0.1"
                value={config.aisleWidth}
                onChange={e => setConfig(prev => ({ ...prev, aisleWidth: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Versioning */}
          {boundary && (
            <section className="space-y-4 pt-4 border-t border-gray-100">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t[lang].savedVersions}</h2>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t[lang].versionName}
                  value={versionName}
                  onChange={e => setVersionName(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSaveVersion}
                  className="px-3 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors flex items-center justify-center"
                  title="Save Version"
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>

              {versions.length > 0 && (
                <div className="space-y-2">
                  {versions.map(v => (
                    <div key={v.id} className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-blue-300 transition-colors cursor-pointer" onClick={() => handleRestore(v)}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-medium text-sm text-gray-900">{v.name}</span>
                        <span className="text-xs font-bold text-blue-600">{v.spotsCount} {t[lang].spots}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{v.config.angle}° {
                          v.config.type === 'perimeter_aisle' ? t[lang].perimeterAisle :
                          v.config.type === 'dead_end' ? t[lang].deadEnd : t[lang].partialTurnaround
                        }</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-gray-600">Total Spots:</span>
            <span className="text-lg font-bold text-blue-600">{spots.filter(s => !s.isAisle).length}</span>
          </div>
          <button
            onClick={handleClear}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear Canvas
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className={cn("flex-1 relative overflow-hidden bg-gray-100", mode === 'pan' ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair")}>
        {/* Grid Background */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #9ca3af 1px, transparent 0)`,
            backgroundSize: `${SCALE * 5 * transform.scale}px ${SCALE * 5 * transform.scale}px`,
            backgroundPosition: `${transform.x}px ${transform.y}px`
          }}
        />

        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onClick={handleSvgClick}
          onDoubleClick={handleSvgDoubleClick}
        >
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
            {/* Draw active polygon */}
            {points.length > 0 && (
              <polyline
                points={[...points, mousePos || points[points.length - 1]].map(p => p.join(',')).join(' ')}
                fill="rgba(59, 130, 246, 0.1)"
                stroke="#3b82f6"
                strokeWidth={2 / transform.scale}
                strokeDasharray={`${4 / transform.scale} ${4 / transform.scale}`}
              />
            )}
            {points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={4 / transform.scale} fill="#2563eb" />
            ))}

            {/* Draw Boundary */}
            {boundary && (
              <polygon
                points={boundary.map(p => p.join(',')).join(' ')}
                fill="rgba(255, 255, 255, 0.8)"
                stroke="#94a3b8"
                strokeWidth={2 / transform.scale}
              />
            )}

            {/* Draw Parking Spots and Aisles */}
            {spots.map(spot => (
              <polygon
                key={spot.id}
                points={spot.corners.map(p => `${p[0] * SCALE},${p[1] * SCALE}`).join(' ')}
                fill={spot.isAisle ? "rgba(148, 163, 184, 0.2)" : "rgba(255, 255, 255, 0.9)"}
                stroke={spot.isAisle ? "none" : "#475569"}
                strokeWidth={spot.isAisle ? "0" : (1.5 / transform.scale)}
                className={spot.isAisle ? "" : "hover:fill-blue-100 transition-colors duration-200"}
              />
            ))}

            {/* Draw Measurements */}
            {measurements.map((m, i) => {
              const dist = (Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]) / SCALE).toFixed(2);
              const midX = (m.start[0] + m.end[0]) / 2;
              const midY = (m.start[1] + m.end[1]) / 2;
              return (
                <g key={m.id}>
                  <line x1={m.start[0]} y1={m.start[1]} x2={m.end[0]} y2={m.end[1]} stroke="#f59e0b" strokeWidth={2 / transform.scale} />
                  <circle cx={m.start[0]} cy={m.start[1]} r={3 / transform.scale} fill="#f59e0b" />
                  <circle cx={m.end[0]} cy={m.end[1]} r={3 / transform.scale} fill="#f59e0b" />
                  
                  {/* Label Background */}
                  <rect x={midX - 24 / transform.scale} y={midY - 10 / transform.scale} width={48 / transform.scale} height={20 / transform.scale} fill="white" rx={4 / transform.scale} stroke="#f59e0b" strokeWidth={1 / transform.scale} />
                  <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={10 / transform.scale} fill="#d97706" fontWeight="bold">
                    {dist}m
                  </text>

                  {/* Delete Button */}
                  <g onClick={(e) => removeMeasurement(m.id, e)} className="cursor-pointer hover:opacity-80" transform={`translate(${midX + 28 / transform.scale}, ${midY - 10 / transform.scale})`}>
                    <circle cx={6 / transform.scale} cy={6 / transform.scale} r={8 / transform.scale} fill="#ef4444" />
                    <line x1={3 / transform.scale} y1={3 / transform.scale} x2={9 / transform.scale} y2={9 / transform.scale} stroke="white" strokeWidth={1.5 / transform.scale} />
                    <line x1={9 / transform.scale} y1={3 / transform.scale} x2={3 / transform.scale} y2={9 / transform.scale} stroke="white" strokeWidth={1.5 / transform.scale} />
                  </g>
                </g>
              );
            })}

            {/* Draw Active Ruler */}
            {mode === 'ruler' && activeRulerStart && mousePos && (
              <g>
                <line x1={activeRulerStart[0]} y1={activeRulerStart[1]} x2={mousePos[0]} y2={mousePos[1]} stroke="#f59e0b" strokeWidth={2 / transform.scale} strokeDasharray={`${4 / transform.scale} ${4 / transform.scale}`} />
                <circle cx={activeRulerStart[0]} cy={activeRulerStart[1]} r={3 / transform.scale} fill="#f59e0b" />
                <circle cx={mousePos[0]} cy={mousePos[1]} r={3 / transform.scale} fill="#f59e0b" />
                {(() => {
                  const dist = (Math.hypot(mousePos[0] - activeRulerStart[0], mousePos[1] - activeRulerStart[1]) / SCALE).toFixed(2);
                  const midX = (activeRulerStart[0] + mousePos[0]) / 2;
                  const midY = (activeRulerStart[1] + mousePos[1]) / 2;
                  return (
                    <g>
                      <rect x={midX - 24 / transform.scale} y={midY - 10 / transform.scale} width={48 / transform.scale} height={20 / transform.scale} fill="white" rx={4 / transform.scale} stroke="#f59e0b" strokeWidth={1 / transform.scale} />
                      <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={10 / transform.scale} fill="#d97706" fontWeight="bold">
                        {dist}m
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* Snap Indicator */}
            {mode === 'ruler' && snapPoint && !isDragging && (
              <circle cx={snapPoint[0]} cy={snapPoint[1]} r={6 / transform.scale} fill="none" stroke="#f59e0b" strokeWidth={2 / transform.scale} />
            )}
          </g>
        </svg>

        {/* Instructions Overlay */}
        {mode === 'idle' && !boundary && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm px-6 py-4 rounded-xl shadow-lg border border-gray-200 text-center">
              <MousePointer2 className="w-8 h-8 text-blue-500 mx-auto mb-2" />
              <h3 className="text-gray-900 font-medium">{t[lang].readyToDraw}</h3>
              <p className="text-gray-500 text-sm mt-1">{t[lang].selectTool}</p>
            </div>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="absolute bottom-6 right-6 flex flex-col gap-2 bg-white p-1 rounded-lg shadow-md border border-gray-200">
          <button onClick={handleZoomIn} className="p-2 hover:bg-gray-100 rounded text-gray-700 transition-colors" title="Zoom In">
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="h-px bg-gray-200 mx-1" />
          <button onClick={handleZoomOut} className="p-2 hover:bg-gray-100 rounded text-gray-700 transition-colors" title="Zoom Out">
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

