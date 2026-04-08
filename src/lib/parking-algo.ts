import * as turf from '@turf/turf';

export interface ParkingConfig {
  angle: number;
  type: 'perimeter_aisle' | 'dead_end' | 'partial_turnaround';
  spotWidth: number;
  spotLength: number;
  aisleWidth: number;
}

export interface ParkingSpot {
  id: string;
  corners: [number, number][];
  isAisle?: boolean;
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

export function generateParkingLayout(boundary: number[][], config: ParkingConfig): ParkingSpot[] {
  if (boundary.length < 4) return [];

  const coords = [...boundary];
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push([...coords[0]]);
  }

  const poly = turf.polygon([coords]);
  if (turf.area(poly) < 50) return [];

  const spots: ParkingSpot[] = [];
  let spotIdCounter = 0;

  const alpha = getLongestEdgeAngle(coords);
  const rotatedCoords = rotatePolygon(coords, -alpha);
  const rotatedPoly = turf.polygon([rotatedCoords]);
  const bbox = turf.bbox(rotatedPoly);

  const minX = bbox[0];
  const minY = bbox[1];
  const maxX = bbox[2];
  const maxY = bbox[3];

  const W = config.spotWidth;
  const L = config.spotLength;
  const A = config.aisleWidth;

  // 1. Generate Perimeter Spots (simplified: just along the bounding box for now, clipped to polygon)
  // To do true perimeter, we'd offset the polygon. For realism in the grid, we fill the bounding box
  // and strictly check if spots are inside.
  
  // Let's do a grid approach but with better clipping
  const thetaRad = (config.angle * Math.PI) / 180;
  const Wa = W / Math.sin(thetaRad);
  const L_y = L * Math.sin(thetaRad);
  const L_x = L * Math.cos(thetaRad);

  const moduleHeight = 2 * L_y + A;
  const numModules = Math.ceil((maxY - minY) / moduleHeight) + 2;
  const numSpots = Math.ceil((maxX - minX) / Wa) + 2;

  const startY = minY - moduleHeight;
  const startX = minX - Wa * 2;

  for (let k = 0; k < numModules; k++) {
    const moduleBaseY = startY + k * moduleHeight;
    const aisleBaseY = moduleBaseY + L_y;

    const aisleCorners: [number, number][] = [
      [startX, aisleBaseY],
      [maxX + Wa * 2, aisleBaseY],
      [maxX + Wa * 2, aisleBaseY + A],
      [startX, aisleBaseY + A],
    ];

    const aislePoly = turf.polygon([[...aisleCorners, aisleCorners[0]]]);
    try {
      const intersection = turf.intersect(turf.featureCollection([rotatedPoly, aislePoly]));
      if (intersection) {
        if (intersection.geometry.type === 'Polygon') {
          spots.push({
            id: `aisle-${k}`,
            corners: (intersection.geometry.coordinates[0] as [number, number][]).map(p => rotatePoint(p, alpha)),
            isAisle: true,
          });
        } else if (intersection.geometry.type === 'MultiPolygon') {
          intersection.geometry.coordinates.forEach((polyCoords, i) => {
            spots.push({
              id: `aisle-${k}-${i}`,
              corners: (polyCoords[0] as [number, number][]).map(p => rotatePoint(p, alpha)),
              isAisle: true,
            });
          });
        }
      }
    } catch (e) {}

    for (let i = 0; i < numSpots; i++) {
      const x = startX + i * Wa;

      const bottomCorners: [number, number][] = [
        [x, aisleBaseY],
        [x + Wa, aisleBaseY],
        [x + Wa + L_x, aisleBaseY - L_y],
        [x + L_x, aisleBaseY - L_y],
      ];

      const topCorners: [number, number][] = [
        [x, aisleBaseY + A],
        [x + Wa, aisleBaseY + A],
        [x + Wa + L_x, aisleBaseY + A + L_y],
        [x + L_x, aisleBaseY + A + L_y],
      ];

      const processSpot = (corners: [number, number][]) => {
        const spotPoly = turf.polygon([[...corners, corners[0]]]);
        try {
          const intersection = turf.intersect(turf.featureCollection([rotatedPoly, spotPoly]));
          if (intersection) {
            const areaInt = turf.area(intersection);
            const areaSpot = turf.area(spotPoly);
            // Only keep spot if it's at least 80% inside the boundary
            if (areaInt / areaSpot > 0.8) {
              spots.push({
                id: `spot-${spotIdCounter++}`,
                corners: corners.map(p => rotatePoint(p, alpha)),
              });
            }
          }
        } catch (e) {}
      };

      processSpot(bottomCorners);
      processSpot(topCorners);
    }
  }

  return spots;
}
