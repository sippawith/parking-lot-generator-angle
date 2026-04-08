import * as turf from '@turf/turf';

export interface ParkingConfig {
  angle: number; // 30, 45, 60, 75, 90
  type: 'perimeter_aisle' | 'dead_end' | 'partial_turnaround';
  spotWidth: number;
  spotLength: number;
  aisleWidth: number;
}

export interface ParkingSpot {
  id: string;
  corners: [number, number][]; // 4 corners or more
  isAisle?: boolean;
  isTurnaround?: boolean;
}

function getLongestEdgeAngle(coords: number[][]) {
  let maxLen = 0;
  let angle = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > maxLen) {
      maxLen = len;
      angle = Math.atan2(dy, dx);
    }
  }
  return angle;
}

function rotatePoint(p: [number, number], angle: number, origin: [number, number] = [0, 0]): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p[0] - origin[0];
  const dy = p[1] - origin[1];
  return [
    origin[0] + dx * cos - dy * sin,
    origin[1] + dx * sin + dy * cos,
  ];
}

function rotatePolygon(coords: number[][], angle: number, origin: [number, number] = [0, 0]): number[][] {
  return coords.map(p => rotatePoint([p[0], p[1]], angle, origin));
}

function distToSegment(p: [number, number], v: [number, number], w: [number, number]) {
  const l2 = (w[0] - v[0])**2 + (w[1] - v[1])**2;
  if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
  let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (v[0] + t * (w[0] - v[0])), p[1] - (v[1] + t * (w[1] - v[1])));
}

function distToPolygon(p: [number, number], polygon: [number, number][]) {
  let minD = Infinity;
  for (let i = 0; i < polygon.length - 1; i++) {
    minD = Math.min(minD, distToSegment(p, polygon[i], polygon[i+1]));
  }
  return minD;
}

export function generateParkingLayout(boundary: number[][], config: ParkingConfig): ParkingSpot[] {
  if (boundary.length < 3) return [];

  // Ensure closed polygon
  const coords = [...boundary];
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push([...coords[0]]);
  }

  const poly = turf.polygon([coords]);
  
  // Find orientation
  const alpha = getLongestEdgeAngle(coords);
  
  // Rotate boundary to align longest edge with x-axis
  const rotatedCoords = rotatePolygon(coords, -alpha);
  const rotatedPoly = turf.polygon([rotatedCoords]);
  const bbox = turf.bbox(rotatedPoly); // [minX, minY, maxX, maxY]

  const minX = bbox[0];
  const minY = bbox[1];
  const maxX = bbox[2];
  const maxY = bbox[3];

  const thetaRad = (config.angle * Math.PI) / 180;
  const W = config.spotWidth;
  const L = config.spotLength;
  const Wa = W / Math.sin(thetaRad);
  const L_y = L * Math.sin(thetaRad);
  const L_x = L * Math.cos(thetaRad);

  const moduleHeight = 2 * L_y + config.aisleWidth;

  let bestSpots: ParkingSpot[] = [];
  let maxSpotCount = -1;

  // Test different offsets to find the optimal packing for freeform shapes
  const xOffsets = [0, Wa / 3, (2 * Wa) / 3];
  const yOffsets = [0, moduleHeight / 3, (2 * moduleHeight) / 3];

  for (const offsetX of xOffsets) {
    for (const offsetY of yOffsets) {
      const currentSpots: ParkingSpot[] = [];
      let spotIdCounter = 0;

      // If perimeter aisle, add the whole polygon as the base aisle
      if (config.type === 'perimeter_aisle') {
        currentSpots.push({
          id: `aisle-base`,
          corners: coords,
          isAisle: true,
        });
      }

      const processSpot = (corners: [number, number][]) => {
        let allInside = true;
        for (const pt of corners) {
          if (!turf.booleanPointInPolygon(turf.point(pt), rotatedPoly)) {
            allInside = false;
            break;
          }
          if (config.type === 'perimeter_aisle') {
            if (distToPolygon(pt, rotatedCoords) < config.aisleWidth - 0.1) {
              allInside = false;
              break;
            }
          }
          if (config.type === 'partial_turnaround') {
            if (pt[0] > maxX - config.aisleWidth - 0.1) {
              allInside = false;
              break;
            }
          }
        }
        if (allInside) {
          const finalCorners = corners.map(p => rotatePoint(p, alpha));
          currentSpots.push({
            id: `spot-${spotIdCounter++}`,
            corners: finalCorners,
          });
          return true;
        }
        return false;
      };

      const addAisle = (corners: [number, number][]) => {
        const turfCorners = [...corners, corners[0]];
        const aislePoly = turf.polygon([turfCorners]);
        
        try {
          const intersection = turf.intersect(turf.featureCollection([rotatedPoly, aislePoly]));
          if (intersection && intersection.geometry.type === 'Polygon') {
            const intCoords = intersection.geometry.coordinates[0] as [number, number][];
            const finalAisleCorners = intCoords.map(p => rotatePoint(p, alpha));
            currentSpots.push({
              id: `aisle-${spotIdCounter++}`,
              corners: finalAisleCorners,
              isAisle: true,
            });
          } else if (intersection && intersection.geometry.type === 'MultiPolygon') {
            intersection.geometry.coordinates.forEach((polyCoords) => {
              const intCoords = polyCoords[0] as [number, number][];
              const finalAisleCorners = intCoords.map(p => rotatePoint(p, alpha));
              currentSpots.push({
                id: `aisle-${spotIdCounter++}`,
                corners: finalAisleCorners,
                isAisle: true,
              });
            });
          }
        } catch (e) {
          // Ignore intersection errors
        }
      };

      // Generate grid covering the entire bounding box
      const startY = minY - moduleHeight + offsetY;
      const endY = maxY + moduleHeight;
      const startX = minX - Wa + offsetX;
      const endX = maxX + Wa;

      for (let moduleBaseY = startY; moduleBaseY < endY; moduleBaseY += moduleHeight) {
        const aisleBaseY = moduleBaseY + L_y;

        const aisleCorners: [number, number][] = [
          [minX, aisleBaseY],
          [maxX, aisleBaseY],
          [maxX, aisleBaseY + config.aisleWidth],
          [minX, aisleBaseY + config.aisleWidth],
        ];

        let addedSpotsInModule = false;

        for (let x = startX; x < endX; x += Wa) {
          const bottomCorners: [number, number][] = [
            [x, aisleBaseY],
            [x + Wa, aisleBaseY],
            [x + Wa + L_x, aisleBaseY - L_y],
            [x + L_x, aisleBaseY - L_y],
          ];
          const topCorners: [number, number][] = [
            [x, aisleBaseY + config.aisleWidth],
            [x + Wa, aisleBaseY + config.aisleWidth],
            [x + Wa + L_x, aisleBaseY + config.aisleWidth + L_y],
            [x + L_x, aisleBaseY + config.aisleWidth + L_y],
          ];
          
          const addedBottom = processSpot(bottomCorners);
          const addedTop = processSpot(topCorners);
          if (addedBottom || addedTop) addedSpotsInModule = true;
        }
        
        if (addedSpotsInModule && config.type !== 'perimeter_aisle') {
          addAisle(aisleCorners);
        }
      }

      if (config.type === 'partial_turnaround') {
        const vAisleCorners: [number, number][] = [
          [maxX - config.aisleWidth, minY],
          [maxX, minY],
          [maxX, maxY],
          [maxX - config.aisleWidth, maxY]
        ];
        addAisle(vAisleCorners);
      }

      const spotCount = currentSpots.filter(s => !s.isAisle).length;
      if (spotCount > maxSpotCount) {
        maxSpotCount = spotCount;
        bestSpots = currentSpots;
      }
    }
  }

  return bestSpots;
}
