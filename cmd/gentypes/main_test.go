package main

import (
	"reflect"
	"testing"
)

type color string

type inner struct {
	N int `json:"n"`
}

type sample struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Color  color   `json:"color"`
	Colors []color `json:"colors"`
	Items  []inner `json:"items"`
	Ok     bool    `json:"ok"`
	Score  float64 `json:"score"`
	Skip   string  `json:"-"`
	hidden int     //nolint:unused
	Plain  int
}

func TestGenerate(t *testing.T) {
	got, err := generate(
		[]reflect.Type{reflect.TypeFor[sample]()},
		[]enum{{reflect.TypeFor[color](), []string{"red", "green"}}},
	)
	if err != nil {
		t.Fatal(err)
	}
	want := header + `
export type color = "red" | "green";

export interface sample {
  id: number;
  name: string;
  color: color;
  colors: color[];
  items: inner[];
  ok: boolean;
  score: number;
  Plain: number;
}

export interface inner {
  n: number;
}
`
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestLongUnionWraps(t *testing.T) {
	vals := []string{"aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd", "eeeeeeeeee", "ffffffffff", "gggggggggg", "hhhhhhhhhh"}
	got, err := generate(nil, []enum{{reflect.TypeFor[color](), vals}})
	if err != nil {
		t.Fatal(err)
	}
	want := header + `
export type color =
  | "aaaaaaaaaa"
  | "bbbbbbbbbb"
  | "cccccccccc"
  | "dddddddddd"
  | "eeeeeeeeee"
  | "ffffffffff"
  | "gggggggggg"
  | "hhhhhhhhhh";
`
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestUnsupportedKind(t *testing.T) {
	type bad struct {
		M map[string]int `json:"m"`
	}
	if _, err := generate([]reflect.Type{reflect.TypeFor[bad]()}, nil); err == nil {
		t.Fatal("want error for map field")
	}
}

type withPtr struct {
	Next *inner `json:"next"`
}

func TestPointerIsNullable(t *testing.T) {
	got, err := generate([]reflect.Type{reflect.TypeFor[withPtr]()}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := header + `
export interface withPtr {
  next: inner | null;
}

export interface inner {
  n: number;
}
`
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}
