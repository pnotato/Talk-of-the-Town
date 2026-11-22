package citymap

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"talkofthetown/internal/sim/nav"
)

var svgOut = flag.String("svg", "", "write the city graph as SVG to this path (crops go next to it)")

// svgCrops are close-ups for docs/engine/NAV_GRAPH.md, written next to the
// full picture with these suffixes.
var svgCrops = []struct {
	suffix string
	view   nav.Rect
}{
	{"corner", nav.Rect{MinX: 46, MaxX: 56, MinZ: -39, MaxZ: -29}},   // block [1,-1]'s north-east corner
	{"crosswalk", nav.Rect{MinX: 14, MaxX: 32, MinZ: -24, MaxZ: -6}}, // the kiosk-wedged plaza mouths
	{"doorway", nav.Rect{MinX: -8, MaxX: 11, MinZ: -39, MaxZ: -31}},  // doors on the news tower's north sidewalk
}

// TestSVG draws the real city's walk graph. It only runs with -svg:
//
//	go test ./internal/sim/citymap -run TestSVG -svg ../../../docs/engine/city-graph.svg
func TestSVG(t *testing.T) {
	if *svgOut == "" {
		t.Skip("needs -svg")
	}
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	g, err := Graph()
	if err != nil {
		t.Fatal(err)
	}
	all := m.Areas[0].Rect
	for _, a := range m.Areas {
		all = grow(all, a.Rect)
	}
	for _, c := range m.Crosswalks {
		all = grow(all, c.Rect)
	}
	all = nav.Rect{MinX: all.MinX - 2, MaxX: all.MaxX + 2, MinZ: all.MinZ - 2, MaxZ: all.MaxZ + 2}
	write := func(path string, view nav.Rect, legend bool) {
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		w := bufio.NewWriter(f)
		drawSVG(w, m, g, view, legend)
		if err := w.Flush(); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
		st, _ := os.Stat(path)
		t.Logf("wrote %s (%d bytes)", path, st.Size())
	}
	write(*svgOut, all, true)
	ext := filepath.Ext(*svgOut)
	for _, c := range svgCrops {
		write(strings.TrimSuffix(*svgOut, ext)+"-"+c.suffix+ext, c.view, false)
	}
}

func grow(a, b nav.Rect) nav.Rect {
	return nav.Rect{MinX: min(a.MinX, b.MinX), MaxX: max(a.MaxX, b.MaxX), MinZ: min(a.MinZ, b.MinZ), MaxZ: max(a.MaxZ, b.MaxZ)}
}

// kindStyle is how each node kind is drawn and named in the legend.
var kindStyle = []struct {
	kind  nav.Kind
	name  string
	color string
}{
	{nav.Stand, "Stand (standing spot)", "#3b6fb6"},
	{nav.Fill, "Fill (grid gap, e.g. a door)", "#e08a1e"},
	{nav.Crossing, "Crossing (zebra chain)", "#8a3ffc"},
	{nav.Bridge, "Bridge (corner, gap)", "#d62d20"},
}

// drawSVG renders the map and graph inside view, 1 world unit to 10 px, x
// east and z south (down), as plain SVG with no scripts or fonts to load.
func drawSVG(w io.Writer, m nav.Map, g *nav.Graph, view nav.Rect, legend bool) {
	const scale = 10.0
	width, height := (view.MaxX-view.MinX)*scale, (view.MaxZ-view.MinZ)*scale
	if legend {
		height += 70
	}
	f := func(v float64) string { return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".") }
	x := func(v float64) string { return f((v - view.MinX) * scale) }
	z := func(v float64) string { return f((v - view.MinZ) * scale) }
	inView := func(p nav.Point, pad float64) bool {
		return p.X >= view.MinX-pad && p.X <= view.MaxX+pad && p.Z >= view.MinZ-pad && p.Z <= view.MaxZ+pad
	}
	rect := func(r nav.Rect, attrs string) {
		fmt.Fprintf(w, `<rect x="%s" y="%s" width="%s" height="%s" %s/>`+"\n",
			x(r.MinX), z(r.MinZ), f((r.MaxX-r.MinX)*scale), f((r.MaxZ-r.MinZ)*scale), attrs)
	}

	fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s" font-family="sans-serif">`+"\n",
		f(width), f(height), f(width), f(height))
	fmt.Fprintln(w, `<title>Talk of the Town: the city's walk graph (SIMULATED)</title>`)
	fmt.Fprintf(w, `<rect width="%s" height="%s" fill="#5d6169"/>`+"\n", f(width), f(height))
	for _, a := range m.Areas {
		fill := "#cdc6b8"
		switch a.Name {
		case "plaza":
			fill = "#e6dcc6"
		case "park":
			fill = "#8fae6a"
		}
		rect(a.Rect, `fill="`+fill+`"`)
	}
	for _, c := range m.Crosswalks {
		rect(c.Rect, `fill="#eeeae0" fill-opacity="0.55" stroke="#ffffff" stroke-width="1"`)
	}
	for _, b := range m.Boxes {
		rect(b, `fill="#3a3d44"`)
	}
	for _, d := range m.Discs {
		if inView(nav.Point{X: d.X, Z: d.Z}, d.R) {
			fmt.Fprintf(w, `<circle cx="%s" cy="%s" r="%s" fill="#2f5d2a" fill-opacity="0.75"/>`+"\n", x(d.X), z(d.Z), f(d.R*scale))
		}
	}

	// Edges as one path; nodes as one path of dots per kind, to stay small.
	var sb strings.Builder
	for u := range g.Len() {
		for _, v := range g.Neighbors(u) {
			a, b := g.Nodes[u], g.Nodes[v]
			if int(v) > u && (inView(a, 2) || inView(b, 2)) {
				fmt.Fprintf(&sb, "M%s %sL%s %s", x(a.X), z(a.Z), x(b.X), z(b.Z))
			}
		}
	}
	fmt.Fprintf(w, `<path d="%s" stroke="#222" stroke-width="1.2" fill="none"/>`+"\n", sb.String())
	r := 0.3 * scale
	for _, ks := range kindStyle {
		sb.Reset()
		for u, p := range g.Nodes {
			if g.Kinds[u] == ks.kind && inView(p, 1) {
				// A dot: two half-circle arcs.
				fmt.Fprintf(&sb, "M%s %sa%s %s 0 1 0 %s 0a%s %s 0 1 0 -%s 0",
					f((p.X-view.MinX)*scale-r), z(p.Z), f(r), f(r), f(2*r), f(r), f(r), f(2*r))
			}
		}
		fmt.Fprintf(w, `<path d="%s" fill="%s" stroke="#fff" stroke-width="0.6"/>`+"\n", sb.String(), ks.color)
	}

	if legend {
		y0 := (view.MaxZ - view.MinZ) * scale
		fmt.Fprintf(w, `<rect y="%s" width="%s" height="70" fill="#ffffff"/>`+"\n", f(y0), f(width))
		for i, ks := range kindStyle {
			lx := 20 + float64(i)*260
			fmt.Fprintf(w, `<circle cx="%s" cy="%s" r="6" fill="%s"/><text x="%s" y="%s" font-size="15">%s</text>`+"\n",
				f(lx), f(y0+24), ks.color, f(lx+12), f(y0+29), ks.name)
		}
		fmt.Fprintf(w, `<text x="20" y="%s" font-size="13" fill="#555">SIMULATED. %d nodes, edges in black; dark boxes are buildings and kiosks, green discs lamps and trees; pale strips are crosswalks. North is up.</text>`+"\n",
			f(y0+56), g.Len())
	}
	fmt.Fprintln(w, `</svg>`)
}
