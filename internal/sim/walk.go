package sim

import (
	"fmt"
	"math"
	"math/rand/v2"

	"talkofthetown/internal/sim/nav"
)

// MODEL.md#movement
const (
	TicksPerRound = 10
	WanderMinHops = 3
	WanderMaxHops = 20
	DwellMinTicks = 2
	DwellMaxTicks = 12
	StuckTicks    = 10
)

// moveStream is the second PCG word of the movement RNG ("move"). Like
// rngStream, changing it changes every run's paths. MODEL.md#movement-rng
const moveStream = 0x6d6f7665

// NewMoveRNG returns the movement's own random source for seed. Movement
// never draws from NewRNG's source, so it leaves the social sim's draws alone
// and does not depend on the player's choices. MODEL.md#movement-rng
func NewMoveRNG(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, moveStream))
}

// tieBits is how many low bits of a priority hold the blob's fixed
// tiebreak; the bits above count a walker's ticks since its goal was set.
const tieBits = 16

// mapScale rounds WalkMap coordinates to 0.001, plenty for drawing and a
// third the bytes of full float64s.
const mapScale = 1000

// WalkMap is the walk graph the run's paths index into.
type WalkMap struct {
	Nodes         [][2]float64 `json:"nodes"`         // [x, z] per node, rounded to 0.001
	Stand         int          `json:"stand"`         // nodes[:stand] are the standing spots, in the city's gathering order
	TicksPerRound int          `json:"ticksPerRound"` // paths have this many moves per round
}

func newWalkMap(g *nav.Graph) WalkMap {
	nodes := make([][2]float64, g.Len())
	for i, p := range g.Nodes {
		nodes[i] = [2]float64{roundMap(p.X), roundMap(p.Z)}
	}
	return WalkMap{Nodes: nodes, Stand: g.NumStand, TicksPerRound: TicksPerRound}
}

func roundMap(x float64) float64 {
	r := math.Round(x*mapScale) / mapScale
	if r == 0 {
		return 0 // not -0, which JSON would spell "-0"
	}
	return r
}

// walker moves n blobs round a walk graph per MODEL.md#movement: each walks
// to a goal, dwells, and picks another, with a PIBT planner keeping them
// apart. Blob i is agent i.
type walker struct {
	g     *nav.Graph
	pl    *nav.Planner
	rng   *rand.Rand
	goals []int // nodes GoalOK accepts, ascending

	at, next, goal []int
	prio, tie      []uint64
	since          []int // ticks since a walker's goal was set
	dwell          []int // ticks of dwelling left; 0 while walking
	still          []int // ticks in a row a walker has not moved

	taken []bool // scratch for newGoal: node -> another blob's goal
	pick  []int  // scratch for newGoal: the candidate goals
}

// newWalker spawns n blobs on distinct goal nodes, drawing from rng.
func newWalker(g *nav.Graph, n int, rng *rand.Rand) (*walker, error) {
	var goals []int
	for v := range g.NumStand {
		if g.GoalOK(v) {
			goals = append(goals, v)
		}
	}
	if n < 0 || n > len(goals) || n > 1<<tieBits {
		return nil, fmt.Errorf("walker: %d blobs for %d goal nodes", n, len(goals))
	}
	w := &walker{
		g:     g,
		pl:    nav.NewPlanner(g, n),
		rng:   rng,
		goals: goals,
		at:    make([]int, n),
		next:  make([]int, n),
		goal:  make([]int, n),
		prio:  make([]uint64, n),
		tie:   make([]uint64, n),
		since: make([]int, n),
		dwell: make([]int, n),
		still: make([]int, n),
		taken: make([]bool, g.Len()),
		pick:  make([]int, 0, len(goals)),
	}
	// Each blob stands on its goal, so on tick 0 it arrives and starts
	// dwelling, which staggers the departures.
	for i, k := range rng.Perm(len(goals))[:n] {
		w.at[i], w.goal[i] = goals[k], goals[k]
	}
	for i, k := range rng.Perm(n) {
		w.tie[i] = uint64(k)
	}
	return w, nil
}

// round plays ticks ticks and returns each blob's path: paths[b][k] is
// blob b's node after k ticks, so paths[b][0] is where the round starts.
func (w *walker) round(ticks int) [][]int {
	n, stride := len(w.at), ticks+1
	flat := make([]int, n*stride)
	paths := make([][]int, n)
	for b := range paths {
		paths[b] = flat[b*stride : (b+1)*stride : (b+1)*stride]
		paths[b][0] = w.at[b]
	}
	for k := 1; k <= ticks; k++ {
		w.tick()
		for b, v := range w.at {
			paths[b][k] = v
		}
	}
	return paths
}

// tick is one movement tick: update goals and dwells, then move everyone.
func (w *walker) tick() {
	w.update()
	w.move()
}

// update applies the per-tick rules of MODEL.md#movement in blob-id order
// and sets each blob's priority for the planner.
func (w *walker) update() {
	for i := range w.at {
		switch {
		case w.dwell[i] > 0:
			// Counts down even when pushed off: the dwell is time, not place.
			w.dwell[i]--
			if w.dwell[i] == 0 && !w.newGoal(i) {
				w.dwell[i] = 1 // nothing free in reach: try again next tick
			}
		case w.at[i] == w.goal[i]:
			w.dwell[i] = DwellMinTicks + w.rng.IntN(DwellMaxTicks-DwellMinTicks+1)
		case w.still[i] >= StuckTicks:
			// Wedged behind a blob it can never push out of the way (see
			// MODEL.md#each-tick). A new goal drops its priority to the
			// bottom, so the blobs round it can clear the way.
			if !w.newGoal(i) {
				w.since[i]++
			}
		default:
			w.since[i]++
		}
		if w.dwell[i] > 0 {
			w.prio[i] = w.tie[i]
		} else {
			// Grows every tick until the walker arrives, which PIBT needs
			// so that everyone keeps reaching their goals.
			w.prio[i] = uint64(w.since[i])<<tieBits | w.tie[i]
		}
	}
}

// move runs one planner step. A dweller's goal is still its dwell node, so
// it heads back there if it was pushed off.
func (w *walker) move() {
	w.pl.Step(w.at, w.goal, w.prio, w.rng, w.next)
	for i := range w.at {
		if w.dwell[i] == 0 && w.next[i] == w.at[i] {
			w.still[i]++
		} else {
			w.still[i] = 0
		}
	}
	w.at, w.next = w.next, w.at
}

// newGoal gives blob i a goal WanderMinHops..WanderMaxHops hops from where
// it stands that no other blob holds, uniformly, and reports whether there
// was one. If not, blob i is left as it was.
func (w *walker) newGoal(i int) bool {
	for j, v := range w.goal {
		if j != i {
			w.taken[v] = true
		}
	}
	w.pick = w.pick[:0]
	for _, v := range w.goals {
		if h := w.g.Hops(w.at[i], v); !w.taken[v] && h >= WanderMinHops && h <= WanderMaxHops {
			w.pick = append(w.pick, v)
		}
	}
	for _, v := range w.goal {
		w.taken[v] = false
	}
	if len(w.pick) == 0 {
		return false
	}
	w.goal[i] = w.pick[w.rng.IntN(len(w.pick))]
	w.since[i], w.still[i] = 0, 0
	return true
}
