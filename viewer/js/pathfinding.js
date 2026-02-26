// pathfinding.js — A* pathfinding on tile grid

import { MAP_COLS, MAP_ROWS, TILE_SIZE, isWalkable } from './map.js';

// A* pathfinding: returns array of {x, y} tile coords, or null if no path found.
// Uses the full collisionMap from map.js (walls + furniture).
export function findPath(startTileX, startTileY, endTileX, endTileY) {
    // Clamp to grid bounds
    const sx = Math.max(0, Math.min(MAP_COLS - 1, Math.round(startTileX)));
    const sy = Math.max(0, Math.min(MAP_ROWS - 1, Math.round(startTileY)));
    const ex = Math.max(0, Math.min(MAP_COLS - 1, Math.round(endTileX)));
    const ey = Math.max(0, Math.min(MAP_ROWS - 1, Math.round(endTileY)));

    if (!isWalkable(ex, ey)) return null;

    // Already there
    if (sx === ex && sy === ey) return [{ x: sx, y: sy }];

    const key = (x, y) => `${x},${y}`;
    const openSet = new Map(); // key -> node
    const closedSet = new Set();

    const heuristic = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);

    const startNode = { x: sx, y: sy, g: 0, f: heuristic(sx, sy), parent: null };
    openSet.set(key(sx, sy), startNode);

    const dirs = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
    ];

    while (openSet.size > 0) {
        // Find node with lowest f score
        let current = null;
        for (const node of openSet.values()) {
            if (!current || node.f < current.f) current = node;
        }

        if (current.x === ex && current.y === ey) {
            // Reconstruct path from goal back to start
            const path = [];
            let node = current;
            while (node) {
                path.unshift({ x: node.x, y: node.y });
                node = node.parent;
            }
            return path;
        }

        openSet.delete(key(current.x, current.y));
        closedSet.add(key(current.x, current.y));

        for (const dir of dirs) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            const nk = key(nx, ny);

            if (closedSet.has(nk)) continue;
            if (!isWalkable(nx, ny)) continue;

            const g = current.g + 1;
            const existing = openSet.get(nk);
            if (existing && g >= existing.g) continue;

            openSet.set(nk, {
                x: nx, y: ny, g, f: g + heuristic(nx, ny),
                parent: current,
            });
        }
    }

    return null; // no path found
}

// Convert pixel coords to tile coords (floor)
export function pixelToTile(px, py) {
    return {
        x: Math.floor(px / TILE_SIZE),
        y: Math.floor(py / TILE_SIZE),
    };
}

// Convert tile coords to pixel center coords
export function tileToPixel(tx, ty) {
    return {
        x: tx * TILE_SIZE + TILE_SIZE / 2,
        y: ty * TILE_SIZE + TILE_SIZE / 2,
    };
}
