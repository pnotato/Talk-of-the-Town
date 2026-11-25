// Package citymap embeds the walkable geometry of the game's maps, exported
// from the TypeScript scenes (make citymap, make townmap, make harbourmap),
// and builds their walk graphs.
//
// Standard library only. Loading and building are pure and deterministic.
package citymap

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sync"

	"talkofthetown/internal/sim/nav"
)

//go:embed city.json
var cityJSON []byte

//go:embed town.json
var townJSON []byte

//go:embed harbour.json
var harbourJSON []byte

// Version is the map file format this package reads.
const Version = 1

// SpotSpacing is the standing grid's spacing, SPOT_SPACING in
// web/src/scene/mapLayout.ts.
const SpotSpacing = 1.8

// gridTol is how far a spot may sit off its area's grid: the exporter rounds
// coordinates to 1e-6, and a spot and the grid's origin can each be off by
// half of that.
const gridTol = 1e-6 + 1e-9

type rectJSON struct {
	MinX float64 `json:"minX"`
	MaxX float64 `json:"maxX"`
	MinZ float64 `json:"minZ"`
	MaxZ float64 `json:"maxZ"`
}

func (r rectJSON) rect() nav.Rect {
	return nav.Rect{MinX: r.MinX, MaxX: r.MaxX, MinZ: r.MinZ, MaxZ: r.MaxZ}
}

type fileJSON struct {
	Version int `json:"version"`
	Layout  struct {
		HomeCount          int `json:"homeCount"`
		NeighbourhoodCount int `json:"neighbourhoodCount"`
	} `json:"layout"`
	BlobRadius  float64 `json:"blobRadius"`
	SpotSpacing float64 `json:"spotSpacing"`
	Areas       []struct {
		Name  string      `json:"name"`
		Rect  rectJSON    `json:"rect"`
		Spots [][]float64 `json:"spots"`
	} `json:"areas"`
	Crosswalks []struct {
		Rect rectJSON `json:"rect"`
		Axis string   `json:"axis"`
	} `json:"crosswalks"`
	Discs []struct {
		Kind string  `json:"kind"`
		X    float64 `json:"x"`
		Z    float64 `json:"z"`
		R    float64 `json:"r"`
	} `json:"discs"`
	Boxes []struct {
		Kind string   `json:"kind"`
		Rect rectJSON `json:"rect"`
	} `json:"boxes"`
}

// Load decodes the embedded city.json into a nav.Map.
func Load() (nav.Map, error) { return parse("city", cityJSON) }

// LoadTown decodes the embedded town.json into a nav.Map.
func LoadTown() (nav.Map, error) { return parse("town", townJSON) }

// LoadHarbour decodes the embedded harbour.json into a nav.Map.
func LoadHarbour() (nav.Map, error) { return parse("harbour", harbourJSON) }

// parse decodes and validates city.json strictly: unknown fields, trailing
// data, a different version or radius, and spots off their area's grid are
// all errors, so a stale or hand-edited file can't slip through.
func parse(name string, data []byte) (nav.Map, error) {
	var f fileJSON
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nav.Map{}, fmt.Errorf("%smap: %w", name, err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nav.Map{}, fmt.Errorf("%smap: trailing data after the map", name)
	}
	radius := nav.DefaultParams().Radius
	switch {
	case f.Version != Version:
		return nav.Map{}, fmt.Errorf("%smap: version %d, want %d", name, f.Version, Version)
	case f.BlobRadius != radius:
		return nav.Map{}, fmt.Errorf("%smap: blobRadius %v, want %v (nav.DefaultParams)", name, f.BlobRadius, radius)
	case f.SpotSpacing != SpotSpacing:
		return nav.Map{}, fmt.Errorf("%smap: spotSpacing %v, want %v", name, f.SpotSpacing, SpotSpacing)
	case len(f.Areas) == 0:
		return nav.Map{}, fmt.Errorf("%smap: no areas", name)
	}

	m := nav.Map{Spacing: f.SpotSpacing}
	for ai, a := range f.Areas {
		r := a.Rect.rect()
		if !(r.MinX < r.MaxX && r.MinZ < r.MaxZ) {
			return nav.Map{}, fmt.Errorf("citymap: area %d (%s) has an empty rect", ai, a.Name)
		}
		area := nav.Area{Name: a.Name, Rect: r}
		for si, s := range a.Spots {
			if len(s) != 2 {
				return nav.Map{}, fmt.Errorf("citymap: area %d spot %d has %d coordinates, want 2", ai, si, len(s))
			}
			p := nav.Point{X: s[0], Z: s[1]}
			edge := min(p.X-r.MinX, r.MaxX-p.X, p.Z-r.MinZ, r.MaxZ-p.Z)
			if edge < radius-gridTol {
				return nav.Map{}, fmt.Errorf("citymap: area %d spot %d at %v is %.6f from the area's edge, want >= %v",
					ai, si, p, edge, radius)
			}
			if len(area.Spots) > 0 && !onGrid(area.Spots[0], p, f.SpotSpacing) {
				return nav.Map{}, fmt.Errorf("citymap: area %d spot %d at %v is off the grid through spot 0 at %v",
					ai, si, p, area.Spots[0])
			}
			area.Spots = append(area.Spots, p)
		}
		m.Areas = append(m.Areas, area)
	}
	for ci, c := range f.Crosswalks {
		r := c.Rect.rect()
		if !(r.MinX < r.MaxX && r.MinZ < r.MaxZ) {
			return nav.Map{}, fmt.Errorf("citymap: crosswalk %d has an empty rect", ci)
		}
		var axis nav.Axis
		switch c.Axis {
		case "x":
			axis = nav.AxisX
		case "z":
			axis = nav.AxisZ
		default:
			return nav.Map{}, fmt.Errorf("citymap: crosswalk %d axis %q, want \"x\" or \"z\"", ci, c.Axis)
		}
		m.Crosswalks = append(m.Crosswalks, nav.Crosswalk{Rect: r, Axis: axis})
	}
	for di, d := range f.Discs {
		if !(d.R > 0) {
			return nav.Map{}, fmt.Errorf("citymap: disc %d (%s) radius %v, want > 0", di, d.Kind, d.R)
		}
		m.Discs = append(m.Discs, nav.Disc{X: d.X, Z: d.Z, R: d.R})
	}
	for bi, b := range f.Boxes {
		r := b.Rect.rect()
		if !(r.MinX < r.MaxX && r.MinZ < r.MaxZ) {
			return nav.Map{}, fmt.Errorf("citymap: box %d (%s) has an empty rect", bi, b.Kind)
		}
		m.Boxes = append(m.Boxes, r)
	}
	return m, nil
}

// onGrid reports whether p is on the hex grid through o: rows a spacing
// times sqrt(3)/2 apart, every other row shifted half a spacing.
func onGrid(o, p nav.Point, spacing float64) bool {
	row := spacing * math.Sqrt(3) / 2
	r := math.Round((p.Z - o.Z) / row)
	if math.Abs(p.Z-(o.Z+r*row)) > gridTol {
		return false
	}
	shift := 0.0
	if math.Mod(math.Abs(r), 2) == 1 {
		shift = spacing / 2
	}
	c := math.Round((p.X - o.X - shift) / spacing)
	return math.Abs(p.X-(o.X+c*spacing+shift)) <= gridTol
}

var cityGraph struct {
	once sync.Once
	g    *nav.Graph
	err  error
}

// Graph builds the city's walk graph with nav.DefaultParams on first use
// and returns the same graph (or error) every time after.
func Graph() (*nav.Graph, error) {
	cityGraph.once.Do(func() {
		m, err := Load()
		if err != nil {
			cityGraph.err = err
			return
		}
		cityGraph.g, cityGraph.err = nav.Build(m, nav.DefaultParams())
	})
	return cityGraph.g, cityGraph.err
}

var townGraph struct {
	once sync.Once
	g    *nav.Graph
	err  error
}

// TownGraph builds the town's walk graph with nav.DefaultParams on first use
// and returns the same graph (or error) every time after.
func TownGraph() (*nav.Graph, error) {
	townGraph.once.Do(func() {
		m, err := LoadTown()
		if err != nil {
			townGraph.err = err
			return
		}
		townGraph.g, townGraph.err = nav.Build(m, nav.DefaultParams())
	})
	return townGraph.g, townGraph.err
}

var harbourGraph struct {
	once sync.Once
	g    *nav.Graph
	err  error
}

// HarbourGraph builds the harbour's walk graph with nav.DefaultParams on first
// use and returns the same graph (or error) every time after.
func HarbourGraph() (*nav.Graph, error) {
	harbourGraph.once.Do(func() {
		m, err := LoadHarbour()
		if err != nil {
			harbourGraph.err = err
			return
		}
		harbourGraph.g, harbourGraph.err = nav.Build(m, nav.DefaultParams())
	})
	return harbourGraph.g, harbourGraph.err
}
