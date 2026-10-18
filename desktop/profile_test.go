package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProfileDirMovesLegacyProfile(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	legacy := filepath.Join(root, "AniLab", "WebView2")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "Local State"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	want := filepath.Join(root, appName, "WebView2")
	if got := profileDir(); got != want {
		t.Fatalf("profileDir() = %s, want %s", got, want)
	}
	if _, err := os.Stat(filepath.Join(want, "Local State")); err != nil {
		t.Fatalf("profile contents not moved: %v", err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy profile still present: %v", err)
	}
	// Later starts keep using the moved profile.
	if got := profileDir(); got != want {
		t.Fatalf("second profileDir() = %s, want %s", got, want)
	}
}

func TestProfileDirFreshInstall(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	want := filepath.Join(root, appName, "WebView2")
	if got := profileDir(); got != want {
		t.Fatalf("profileDir() = %s, want %s", got, want)
	}
}

func TestProfileDirKeepsNewProfileOverLegacy(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	current := filepath.Join(root, appName, "WebView2")
	legacy := filepath.Join(root, "AniLab", "WebView2")
	for _, dir := range []string{current, legacy} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if got := profileDir(); got != current {
		t.Fatalf("profileDir() = %s, want %s", got, current)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatalf("legacy profile should be left alone once a new one exists: %v", err)
	}
}
