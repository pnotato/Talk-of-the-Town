// Package nav moves blobs around a static walk graph without collisions.
//
// Build turns walkable geometry (areas with standing spots, crosswalks and
// obstacles) into a Graph. A Planner then moves every agent at most one edge
// per tick with PIBT, so no two agents share a node, swap, or pass closer
// than Params.MinSep while moving. See docs/engine/.
//
// The package is pure and deterministic: standard library only, no I/O, no
// clock and no global random. It does not import sim.
package nav

// Point is a position on the ground in world units. X points east and Z
// points south, so north is -Z.
type Point struct{ X, Z float64 }

// Rect is an axis-aligned rectangle on the ground.
type Rect struct{ MinX, MaxX, MinZ, MaxZ float64 }

// Disc is a round obstacle such as a lamp post or a tree canopy.
type Disc struct{ X, Z, R float64 }

// Area is one walkable region. Its Spots are the standing spots on its hex
// grid, in order.
type Area struct {
	Name  string
	Rect  Rect
	Spots []Point
}

// Axis is the direction a blob walks to cross a road at a crosswalk.
type Axis uint8

// Crossing directions.
const (
	AxisX Axis = iota
	AxisZ
)

// Crosswalk is a zebra crossing: a walkable strip across a road.
type Crosswalk struct {
	Rect Rect
	Axis Axis
}

// Map is the walkable geometry the graph is built from. Concatenating every
// area's Spots, in order, gives the standing-node ids 0..n-1.
type Map struct {
	Areas      []Area
	Crosswalks []Crosswalk
	// Discs and Boxes block walking. Doorsteps are not here: a blob may walk
	// past a door, it just never stops in front of one.
	Discs []Disc
	Boxes []Rect
	// Spacing is the hex grid's spacing between neighbouring spots.
	Spacing float64
}

// Params tunes graph building and collision checks. All lengths are in world
// units.
type Params struct {
	// Radius is a blob's body radius. Nodes and edges keep at least this much
	// clearance from obstacles and area edges.
	Radius float64
	// MinSep is the closest two blobs may ever be, standing or moving.
	MinSep float64
	// FillGap is the minimum spacing for nodes added on an area's grid.
	FillGap float64
	// BridgeGap is the minimum spacing for nodes added to bridge gaps.
	BridgeGap float64
	// MaxEdge is the longest edge, so the longest step in one tick.
	MaxEdge float64
	// ChainStep is the target spacing of nodes along crosswalks and bridges.
	ChainStep float64
	// Grid is the cell size of the fine grid used to route chains and bridges.
	Grid float64
	// Margin is extra clearance, on top of Radius, for routed chains and
	// bridges, so new nodes don't sit right at the limit.
	Margin float64
}

// DefaultParams returns the parameters used for the city. Radius and MinSep
// match BLOB_RADIUS and 2 * BLOB_RADIUS in web/src/scene/mapLayout.ts.
func DefaultParams() Params {
	return Params{
		Radius:    0.6,
		MinSep:    1.2,
		FillGap:   1.4,
		BridgeGap: 1.25,
		MaxEdge:   1.95,
		ChainStep: 1.75,
		Grid:      0.1,
		Margin:    0.1,
	}
}

// Kind says where a node came from.
type Kind uint8

// Node kinds. Stand nodes always come first, in standing-spot order. Only
// Stand nodes may be goals or spawn points.
const (
	Stand    Kind = iota // a standing spot from the map
	Fill                 // added on an area's grid, e.g. in front of a door
	Crossing             // on a crosswalk chain
	Bridge               // added to join pieces, e.g. round a block corner
)
