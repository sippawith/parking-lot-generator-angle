/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { generateParkingLayout, ParkingConfig, ParkingSpot } from './lib/parking-algo';
import { MousePointer2, Square, Hexagon, Trash2, Settings, Play, Hand, Ruler } from 'lucide-react';
import { cn } from './lib/utils';

type DrawMode = 'idle' | 'polygon' | 'rectangle' | 'pan' | 'ruler';

export default function App() {
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
  const [measurements, setMeasurements] = useState<{start: [number, number], end: [number, number]}[]>([]);
  const [activeRulerStart, setActiveRulerStart] = useState<[number, number] | null>(null);
  const [snapPoint, setSnapPoint] = useState<[number, number] | null>(null);

  // Zoom and Pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);

  // Scale factor: 1 meter = 10 pixels for rendering
  const SCALE = 10;

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
        setMeasurements(prev => [...prev, { start: activeRulerStart, end: pt }]);
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
        <div className="p-6 border-b border-gray-100">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            TestFit Parking
          </h1>
          <p className="text-sm text-gray-500 mt-1">Generate optimized parking layouts</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8">
          {/* Drawing Tools */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Drawing Tools</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setMode('pan'); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'pan' ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Hand className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">Pan</span>
              </button>
              <button
                onClick={() => { setMode('rectangle'); setBoundary(null); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'rectangle' ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Square className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">Rectangle</span>
              </button>
              <button
                onClick={() => { setMode('ruler'); setActiveRulerStart(null); }}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border transition-all",
                  mode === 'ruler' ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <Ruler className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">Measure</span>
              </button>
            </div>
            {mode === 'rectangle' && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                Click anywhere on canvas to place rectangle.
              </p>
            )}
            {mode === 'pan' && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                Click and drag to pan. Scroll to zoom.
              </p>
            )}
            {mode === 'ruler' && (
              <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                Click to measure. Snaps to corners. Press Esc to cancel.
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
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Parking Configuration</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parking Angle</label>
              <select
                value={config.angle}
                onChange={handleAngleChange}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value={30}>30° (One-way)</option>
                <option value={45}>45° (One-way)</option>
                <option value={60}>60° (One-way)</option>
                <option value={75}>75° (One-way)</option>
                <option value={90}>90° (Two-way)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Layout Type</label>
              <select
                value={config.type}
                onChange={e => setConfig(prev => ({ ...prev, type: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="perimeter_aisle">Perimeter Aisle (ทางเดินรถล้อมรอบ)</option>
                <option value="dead_end">One-way In/Out (เข้า-ออกทางเดียว)</option>
                <option value="partial_turnaround">Partial Turnaround (มีทางวนรถบางที่จอดรถ)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Spot Width (m)</label>
                <input
                  type="number"
                  step="0.1"
                  value={config.spotWidth}
                  onChange={e => setConfig(prev => ({ ...prev, spotWidth: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Spot Length (m)</label>
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
              <label className="block text-xs text-gray-500 mb-1">Aisle Width (m)</label>
              <input
                type="number"
                step="0.1"
                value={config.aisleWidth}
                onChange={e => setConfig(prev => ({ ...prev, aisleWidth: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>
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
                <g key={i}>
                  <line x1={m.start[0]} y1={m.start[1]} x2={m.end[0]} y2={m.end[1]} stroke="#f59e0b" strokeWidth={2 / transform.scale} />
                  <circle cx={m.start[0]} cy={m.start[1]} r={3 / transform.scale} fill="#f59e0b" />
                  <circle cx={m.end[0]} cy={m.end[1]} r={3 / transform.scale} fill="#f59e0b" />
                  <rect x={midX - 24 / transform.scale} y={midY - 10 / transform.scale} width={48 / transform.scale} height={20 / transform.scale} fill="white" rx={4 / transform.scale} stroke="#f59e0b" strokeWidth={1 / transform.scale} />
                  <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={10 / transform.scale} fill="#d97706" fontWeight="bold">
                    {dist}m
                  </text>
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
              <h3 className="text-gray-900 font-medium">Ready to Draw</h3>
              <p className="text-gray-500 text-sm mt-1">Select a drawing tool from the sidebar to begin</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

