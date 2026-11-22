package nav

import (
	"fmt"
	"slices"
)

// A trap entry is a neighbour a of v such that a blob stepping a -> v clashes
// (Swept < MinSep) with every move on out of v, v -> b for b != a. A blob
// dwelling on v can then never be pushed on by a walker arriving from a: the
// walker keeps pushing, the dweller keeps failing, and the walker stalls.
// CheckGraph rule 4 forbids them everywhere but pockets.
//
// In the city they come from two grids meeting at right angles: the park's
// lawn and its sidewalks are on different grids 1.5 apart, so a step off the
// lawn onto the sidewalk is a 90° turn either way along it. A hex area's
// staggered rows make them too: the end of a short row has neighbours west,
// south-west and south-east, and a blob from the south-west must turn 120°
// either way.

// untrapper removes trap entries from a graph given as points and sorted
// adjacency lists, by cutting the edge (a, v) of each one.
type untrapper struct {
	pts    []Point
	kinds  []Kind
	adj    [][]int32
	minSep float64
	// ok vets a cut after the built-in checks, e.g. that every crosswalk is
	// still crossed; nil accepts.
	ok func() bool

	// live marks the nodes that had an edge when untrap began; a cut must
	// not leave one cut off.
	live []bool

	// Scratch for pieces and core.
	seen  []bool
	deg   []int32
	queue []int32
}

// cutLevel is how much a cut may give up, from none to most.
type cutLevel int

const (
	fewerTraps      cutLevel = iota // the traps round it go down, no goal lost
	noMoreTraps                     // the entry goes, the traps round it don't go up, no goal lost
	fewerTrapsLoss                  // as fewerTraps, but a goal may be lost
	noMoreTrapsLoss                 // as noMoreTraps, but a goal may be lost
	cutLevels
)

// untrap cuts trap entries until none are left or none can be cut. For an
// entry (a, v) it tries cutting the edge a-v, then each other edge of v,
// which can leave v a pocket or a dead end. A cut must never split the graph
// and ok must accept it. Within that it prefers, in order: cuts that lower
// the trap entries round them without costing a goal (a Stand node in the
// 2-core with no trap entry); cuts that just move a trap on, which a row's
// end can need; and, only if nothing else is left, cuts that cost a goal.
// After any but the first kind it starts over from the first. Each cut drops
// an edge, so it ends. Entries go in order of v then a, so the result is
// deterministic. It returns the edges cut and the trap entries left, each as
// (a, v), and how many Stand nodes that could be goals before no longer can.
func untrap(pts []Point, kinds []Kind, adj [][]int32, minSep float64, ok func() bool) (cut, left [][2]int32, lost int) {
	u := &untrapper{pts: pts, kinds: kinds, adj: adj, minSep: minSep, ok: ok, live: make([]bool, len(pts))}
	for v := range adj {
		u.live[v] = len(adj[v]) > 0
	}
	start := u.goals()
	for {
		progress := false
		for level := fewerTraps; level < cutLevels && !progress; level++ {
			for _, e := range u.violations() {
				if c, ok := u.fix(e[0], e[1], level); ok {
					cut = append(cut, c)
					progress = true
					if level > fewerTraps {
						break // back to the gentlest cuts
					}
				}
			}
		}
		if !progress {
			break
		}
	}
	end := u.goals()
	for v := range start {
		if start[v] && !end[v] {
			lost++
		}
	}
	return cut, u.violations(), lost
}

// fix tries the cuts for trap entry (a, v) in turn and returns the one it
// kept.
func (u *untrapper) fix(a, v int32, level cutLevel) ([2]int32, bool) {
	if !slices.Contains(u.trapsAt(v), a) {
		return [2]int32{}, false // an earlier cut this round already fixed it
	}
	tries := [][2]int32{{a, v}}
	for _, b := range u.adj[v] {
		if b != a {
			tries = append(tries, [2]int32{v, b})
		}
	}
	for _, c := range tries {
		if u.tryCut(c[0], c[1], a, v, level) {
			return c, true
		}
	}
	return [2]int32{}, false
}

// Untrap returns edges less the ones Build's last stage would cut so that no
// node has a trap entry (CheckGraph rule 4), for graphs put together by hand
// such as test fixtures. kinds says which nodes are Stand, whose goals it
// keeps. It fails, naming one, if trap entries are left.
func Untrap(nodes []Point, kinds []Kind, edges [][2]int, p Params) ([][2]int, error) {
	adj := make([][]int32, len(nodes))
	for _, e := range edges {
		if e[0] < 0 || e[0] >= len(nodes) || e[1] < 0 || e[1] >= len(nodes) || e[0] == e[1] {
			return nil, fmt.Errorf("nav: Untrap: bad edge %v", e)
		}
		adj[e[0]] = append(adj[e[0]], int32(e[1]))
		adj[e[1]] = append(adj[e[1]], int32(e[0]))
	}
	for v := range adj {
		slices.Sort(adj[v])
		adj[v] = slices.Compact(adj[v])
	}
	_, left, _ := untrap(nodes, kinds, adj, p.MinSep, nil)
	if len(left) > 0 {
		return nil, fmt.Errorf("nav: Untrap: %d trap entries left, first %d->%d", len(left), left[0][0], left[0][1])
	}
	var out [][2]int
	for _, e := range edges {
		if u, v := int32(e[0]), int32(e[1]); slices.Contains(adj[u], v) {
			out = append(out, e)
			unlinkLists(adj, u, v) // once, even if listed twice
		}
	}
	return out, nil
}

// violations lists every trap entry CheckGraph would reject, as (a, v),
// ordered by v then a.
func (u *untrapper) violations() [][2]int32 {
	var out [][2]int32
	for v := range u.pts {
		for _, a := range u.trapsAt(int32(v)) {
			out = append(out, [2]int32{a, int32(v)})
		}
	}
	return out
}

// trapsAt lists v's trap entries that CheckGraph rejects: none at a pocket
// or a node with fewer than two neighbours.
func (u *untrapper) trapsAt(v int32) []int32 {
	if len(u.adj[v]) < 2 || u.pocket(v) {
		return nil
	}
	return u.entries(v)
}

// entries lists v's trap entries, pockets included.
func (u *untrapper) entries(v int32) []int32 {
	var out []int32
	for _, a := range u.adj[v] {
		if gap, ok := u.bestExit(a, v); ok && gap < u.minSep {
			out = append(out, a)
		}
	}
	return out
}

// bestExit is the widest swept gap between a -> v and any v -> b, b != a,
// and false if v has no other neighbour.
func (u *untrapper) bestExit(a, v int32) (float64, bool) {
	q := u.pts
	gap, any := 0.0, false
	for _, b := range u.adj[v] {
		if b != a {
			gap, any = max(gap, Swept(q[a], q[v], q[v], q[b])), true
		}
	}
	return gap, any
}

func (u *untrapper) pocket(v int32) bool {
	nb := u.adj[v]
	return len(nb) == 2 && u.linked(nb[0], nb[1])
}

func (u *untrapper) linked(a, b int32) bool {
	_, found := slices.BinarySearch(u.adj[a], b)
	return found
}

// tryCut cuts the edge x-y, meant to remove trap entry (a, v), if that
// passes every check at this level; otherwise it leaves the graph as it was.
func (u *untrapper) tryCut(x, y, a, v int32, level cutLevel) bool {
	// Only x, y and the nodes next to both can change their trap entries:
	// x and y lose a neighbour, and a common neighbour may stop being a
	// pocket.
	near := []int32{x, y}
	for _, w := range u.adj[x] {
		if w != y && u.linked(w, y) {
			near = append(near, w)
		}
	}
	countTraps := func() (n int) {
		for _, w := range near {
			n += len(u.trapsAt(w))
		}
		return n
	}
	keepGoals := level == fewerTraps || level == noMoreTraps
	trapsBefore, pieces := countTraps(), u.pieces()
	var goals []bool
	if keepGoals {
		goals = u.goals()
	}
	unlinkLists(u.adj, x, y)
	traps := countTraps()
	better := traps < trapsBefore
	if level == noMoreTraps || level == noMoreTrapsLoss {
		better = traps <= trapsBefore && !slices.Contains(u.trapsAt(v), a)
	}
	if better && u.pieces() == pieces && (!keepGoals || u.keepsGoals(goals)) && (u.ok == nil || u.ok()) {
		return true
	}
	linkLists(u.adj, x, y)
	return false
}

// goals marks the Stand nodes that may be goals: in the 2-core, with no trap
// entry (as Graph.GoalOK).
func (u *untrapper) goals() []bool {
	core := u.core()
	out := make([]bool, len(u.pts))
	for v, k := range u.kinds {
		out[v] = k == Stand && core[v] && len(u.entries(int32(v))) == 0
	}
	return out
}

func (u *untrapper) keepsGoals(before []bool) bool {
	after := u.goals()
	for v, was := range before {
		if was && !after[v] {
			return false
		}
	}
	return true
}

// core marks the 2-core: what is left after peeling nodes with at most one
// neighbour (as Graph.Core).
func (u *untrapper) core() []bool {
	n := len(u.pts)
	in := make([]bool, n)
	u.deg = slices.Grow(u.deg[:0], n)[:n]
	u.queue = u.queue[:0]
	for v := range n {
		u.deg[v] = int32(len(u.adj[v]))
		in[v] = u.deg[v] > 1
		if !in[v] {
			u.queue = append(u.queue, int32(v))
		}
	}
	for head := 0; head < len(u.queue); head++ {
		for _, w := range u.adj[u.queue[head]] {
			if in[w] {
				if u.deg[w]--; u.deg[w] <= 1 {
					in[w] = false
					u.queue = append(u.queue, w)
				}
			}
		}
	}
	return in
}

// pieces counts the connected pieces among live nodes.
func (u *untrapper) pieces() int {
	n := len(u.pts)
	u.seen = slices.Grow(u.seen[:0], n)[:n]
	clear(u.seen)
	pieces := 0
	for s := range n {
		if u.seen[s] || !u.live[s] {
			continue
		}
		pieces++
		u.seen[s] = true
		u.queue = append(u.queue[:0], int32(s))
		for head := 0; head < len(u.queue); head++ {
			for _, w := range u.adj[u.queue[head]] {
				if !u.seen[w] {
					u.seen[w] = true
					u.queue = append(u.queue, w)
				}
			}
		}
	}
	return pieces
}

func unlinkLists(adj [][]int32, u, v int32) {
	adj[u] = slices.DeleteFunc(adj[u], func(w int32) bool { return w == v })
	adj[v] = slices.DeleteFunc(adj[v], func(w int32) bool { return w == u })
}

func linkLists(adj [][]int32, u, v int32) {
	for _, e := range [2][2]int32{{u, v}, {v, u}} {
		k, _ := slices.BinarySearch(adj[e[0]], e[1])
		adj[e[0]] = slices.Insert(adj[e[0]], k, e[1])
	}
}
